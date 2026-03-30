"""
Chisquare — Analyze Uploads Service

Reads an uploaded CSV dataset (and optional instrument document) from Supabase Storage,
extracts headers and sample rows, calls Gemini to suggest project brief fields,
and writes the suggestions to projects.additional_context.ai_prefill.

Payload: {"project_id": str, "dataset_id": str}
Result is written directly to the project row — no task result blob needed.
"""

from __future__ import annotations

import io
import json
from typing import Any

import pandas as pd
import structlog

from db import SupabaseDB
from services.ai_service import generate

logger = structlog.get_logger()

# Exact form field definitions — must stay in sync with frontend Step1Form.tsx
FORM_SCHEMA = {
    "fields": {
        "name": {
            "type": "string",
            "description": "Project name (≤80 chars, specific and informative)",
            "example": "WASH Baseline Survey — Northern Region 2025",
        },
        "objective_text": {
            "type": "string",
            "description": "2–3 sentence objective describing what this survey measures and why",
        },
        "objective_tags": {
            "type": "array of strings",
            "description": "Pick up to 3 tags that best describe the survey type",
            "allowed_values": [
                "Baseline",
                "Endline",
                "Midline",
                "Needs Assessment",
                "Post-Distribution",
                "KAP Study",
                "Satisfaction Survey",
                "Other",
            ],
        },
        "research_questions": {
            "type": "array of objects",
            "description": "3–5 specific, measurable research questions derived from the data/instrument",
            "item_shape": {"text": "string", "priority": "integer starting at 1"},
        },
        "target_population": {
            "type": "string",
            "description": "Who the survey respondents are",
        },
        "sampling_method": {
            "type": "string",
            "description": "How respondents were selected",
            "allowed_values": [
                "simple_random",
                "stratified",
                "cluster",
                "multi_stage",
                "convenience",
                "purposive",
                "snowball",
            ],
        },
        "country": {
            "type": "string",
            "description": "Country name if detectable from data or instrument, else empty string",
        },
        "regions": {
            "type": "string",
            "description": "Regions/states/districts if detectable, else empty string",
        },
        "audience": {
            "type": "string",
            "description": "Primary intended audience for the final report",
            "allowed_values": ["donor", "internal", "academic", "government", "public"],
        },
    }
}

VALID_SAMPLING = {
    "simple_random", "stratified", "cluster", "multi_stage",
    "convenience", "purposive", "snowball",
}
VALID_TAGS = {
    "Baseline", "Endline", "Midline", "Needs Assessment",
    "Post-Distribution", "KAP Study", "Satisfaction Survey", "Other",
}
VALID_AUDIENCES = {"donor", "internal", "academic", "government", "public"}


def analyze_uploads(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Main entry point — called by worker main.py.
    """
    project_id: str = payload["project_id"]
    dataset_id: str = payload.get("dataset_id", "")

    db.update_task_progress(task_id, 10, "Loading dataset…")

    # --- Load dataset record ---
    dataset_row = None
    if dataset_id:
        ds_result = (
            db.client.table("datasets")
            .select("original_file_path, name, file_type")
            .eq("id", dataset_id)
            .single()
            .execute()
        )
        dataset_row = ds_result.data

    # --- Load project record (for instrument path if stored separately) ---
    project_result = (
        db.client.table("projects")
        .select("name, research_questions, additional_context")
        .eq("id", project_id)
        .single()
        .execute()
    )
    project = project_result.data or {}

    # --- Download and parse CSV ---
    headers: list[str] = []
    sample_rows: list[list[str]] = []
    row_count: int = 0
    filename: str = "dataset.csv"

    if dataset_row and dataset_row.get("original_file_path"):
        db.update_task_progress(task_id, 20, "Parsing CSV headers…")
        try:
            file_bytes = db.download_file("uploads", dataset_row["original_file_path"])
            filename = dataset_row.get("name", "dataset.csv")
            file_type = (dataset_row.get("file_type") or "csv").lower()

            if file_type in ("xls", "xlsx"):
                df = pd.read_excel(io.BytesIO(file_bytes), nrows=6)
            else:
                df = pd.read_csv(io.BytesIO(file_bytes), nrows=6)

            headers = list(df.columns)
            sample_rows = df.head(5).astype(str).values.tolist()

            # Count rows in full file
            if file_type in ("xls", "xlsx"):
                df_count = pd.read_excel(io.BytesIO(file_bytes), usecols=[0])
            else:
                df_count = pd.read_csv(io.BytesIO(file_bytes), usecols=[0])
            row_count = len(df_count)

        except Exception as e:
            logger.warning("csv_parse_failed", error=str(e), project_id=project_id)

    # --- Build prompt ---
    db.update_task_progress(task_id, 40, "Asking AI to fill form fields…")

    sample_csv = "\n".join(
        [", ".join(str(h) for h in headers)]
        + [", ".join(str(v) for v in row) for row in sample_rows]
    )

    prompt = f"""You are a survey data analyst for humanitarian NGOs. Analyze the dataset below and fill ALL fields in the provided JSON schema.

## Dataset File: {filename}
## Columns ({len(headers)} total)
{", ".join(headers) if headers else "Not available"}

## Sample Data (first 5 rows)
{sample_csv if sample_csv.strip() else "Not available"}

## Total Rows (approx): {row_count}

---

## Form Schema — fill every field with your best inference

{json.dumps(FORM_SCHEMA, indent=2)}

---

## Instructions
1. Fill ALL fields. Do not leave any field empty if you can reasonably infer it.
2. For "sampling_method": choose from allowed_values ONLY. Default to "cluster" for household surveys, "convenience" if no structure is evident.
3. For "objective_tags": pick 1–3 tags that best match. "Baseline" if first data collection, "Endline" if outcome evaluation.
4. For "research_questions": generate 3–5 specific, measurable questions the data could answer based on the column names.
5. For "audience": infer from context — NGO/field data → "donor" or "internal", academic → "academic", government → "government". Default: "donor".
6. For "country" and "regions": look for geographic column names (region, district, wilaya, governorate, state, province, country) and their sample values.
7. Return ONLY a valid JSON object with exactly the field names above. No markdown, no explanation, no extra fields.
"""

    raw = generate(prompt)

    # --- Normalise and validate ---
    db.update_task_progress(task_id, 80, "Processing AI suggestions…")

    sampling_raw = str(raw.get("sampling_method", "")).lower().replace("-", "_").replace(" ", "_")
    sampling_method = sampling_raw if sampling_raw in VALID_SAMPLING else "cluster"

    tags_raw = raw.get("objective_tags", [])
    tags = [str(t).strip() for t in tags_raw if str(t).strip() in VALID_TAGS][:3]

    audience_raw = str(raw.get("audience", "")).lower()
    audience = audience_raw if audience_raw in VALID_AUDIENCES else "donor"

    rqs_raw = raw.get("research_questions", [])
    research_questions = []
    for i, rq in enumerate(rqs_raw[:5]):
        if isinstance(rq, str):
            text = rq.strip()
        else:
            text = str(rq.get("text", "")).strip()
        if text:
            research_questions.append({"text": text, "priority": i + 1})

    ai_prefill = {
        "name": str(raw.get("name", "")).strip()[:80],
        "objective_text": str(raw.get("objective_text", "")).strip(),
        "objective_tags": tags,
        "research_questions": research_questions,
        "target_population": str(raw.get("target_population", "")).strip(),
        "sampling_method": sampling_method,
        "country": str(raw.get("country", "")).strip(),
        "regions": str(raw.get("regions", "")).strip(),
        "audience": audience,
    }

    ai_prefill_fields = [
        k for k, v in ai_prefill.items()
        if v != "" and not (isinstance(v, list) and len(v) == 0)
    ]

    # --- Write to projects.additional_context ---
    existing_ctx_raw = project.get("additional_context") or "{}"
    try:
        existing_ctx = json.loads(existing_ctx_raw) if isinstance(existing_ctx_raw, str) else existing_ctx_raw
    except Exception:
        existing_ctx = {}

    existing_ctx["ai_prefill"] = ai_prefill
    existing_ctx["ai_prefill_fields"] = ai_prefill_fields
    existing_ctx["audience"] = audience  # Step1Form parseAudience reads this

    # Also pre-fill top-level project fields if they're still empty
    update_fields: dict[str, Any] = {
        "additional_context": json.dumps(existing_ctx),
    }
    if not project.get("name") or project["name"] in ("New Project", ""):
        update_fields["name"] = ai_prefill["name"] or project.get("name", "New Project")

    if ai_prefill["sampling_method"]:
        update_fields["sampling_method"] = ai_prefill["sampling_method"]

    if ai_prefill["target_population"]:
        update_fields["target_population"] = ai_prefill["target_population"]

    if ai_prefill["objective_text"] or ai_prefill["objective_tags"]:
        update_fields["description"] = json.dumps({
            "text": ai_prefill["objective_text"],
            "tags": ai_prefill["objective_tags"],
        })

    if ai_prefill["research_questions"]:
        update_fields["research_questions"] = ai_prefill["research_questions"]

    if ai_prefill["country"]:
        update_fields["geographic_scope"] = json.dumps({
            "country": ai_prefill["country"],
            "regions": ai_prefill["regions"],
            "urban": False,
            "rural": False,
        })

    db.client.table("projects").update(update_fields).eq("id", project_id).execute()

    db.complete_task(task_id, {
        "status": "ok",
        "ai_prefill_fields": ai_prefill_fields,
        "project_id": project_id,
    })

    logger.info("analyze_uploads_complete", project_id=project_id, fields_filled=len(ai_prefill_fields))
