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
import re
import zipfile
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
            "description": "Project name (<=80 chars, specific and informative)",
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

# Encodings to try in order
ENCODINGS_TO_TRY = ["utf-8", "utf-8-sig", "latin-1", "cp1252", "iso-8859-1"]


def safe_str(val: Any) -> str:
    """Safely convert any value to string, handling slices, NaN, and other edge cases."""
    if isinstance(val, slice):
        return ""
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except (TypeError, ValueError):
        pass
    try:
        return str(val).strip()
    except Exception:
        return ""


def clean_column_names(columns: list[Any]) -> list[str]:
    """Clean column names: strip, remove special chars, deduplicate."""
    seen: dict[str, int] = {}
    result: list[str] = []

    for i, col in enumerate(columns):
        # Handle multi-index tuples and slice objects
        if isinstance(col, slice):
            clean = f"Column_{i}"
        elif isinstance(col, tuple):
            clean = " ".join(safe_str(part) for part in col).strip()
        else:
            clean = safe_str(col)

        # Remove non-printable characters
        clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', clean)
        # Replace newlines with space
        clean = re.sub(r'[\r\n]+', ' ', clean)
        # Collapse multiple spaces
        clean = re.sub(r'\s+', ' ', clean).strip()
        # Truncate to 100 chars
        clean = clean[:100]

        if not clean:
            clean = f"unnamed_column_{i}"

        # Deduplicate
        if clean in seen:
            seen[clean] += 1
            clean = f"{clean}_{seen[clean]}"
        else:
            seen[clean] = 1

        result.append(clean)

    return result


def flatten_multiindex_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten multi-level column headers into single-level strings."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [
            " ".join(safe_str(part) for part in col).strip()
            for col in df.columns
        ]
    else:
        # Handle any slice objects or weird types in regular columns
        df.columns = [
            f"Column_{i}" if isinstance(col, slice) else safe_str(col)
            for i, col in enumerate(df.columns)
        ]
    return df


def detect_header_row(file_bytes: bytes, file_type: str) -> int:
    """
    Detect the actual header row in Excel files.
    Returns the row index to use as header (0-indexed).
    """
    if file_type not in ("xls", "xlsx"):
        return 0

    try:
        # Read first 10 rows without header
        df_test = pd.read_excel(io.BytesIO(file_bytes), header=None, nrows=10)

        # Count non-null values per row
        row_fill_counts = df_test.notna().sum(axis=1)

        if len(row_fill_counts) < 3:
            return 0

        # If row 0 has significantly fewer values than rows 2-5, skip to first full row
        row0_count = row_fill_counts.iloc[0]
        later_avg = row_fill_counts.iloc[2:6].mean() if len(row_fill_counts) > 2 else row0_count

        if row0_count < later_avg * 0.5:
            # Find first row with decent fill
            for i in range(len(row_fill_counts)):
                if row_fill_counts.iloc[i] >= later_avg * 0.7:
                    return i

        return 0
    except Exception:
        return 0


def load_csv_robust(file_bytes: bytes) -> pd.DataFrame:
    """Load CSV with robust encoding and delimiter detection."""
    last_error: Exception | None = None

    # Try auto-detection first
    for encoding in ENCODINGS_TO_TRY:
        try:
            df = pd.read_csv(
                io.BytesIO(file_bytes),
                sep=None,
                engine="python",
                encoding=encoding,
                on_bad_lines="skip",
            )
            return df
        except UnicodeDecodeError:
            continue
        except pd.errors.ParserError as e:
            last_error = e
            continue
        except Exception as e:
            last_error = e
            continue

    # Fallback: try explicit separators with latin-1 (never fails on encoding)
    for sep in [",", ";", "\t", "|"]:
        try:
            df = pd.read_csv(
                io.BytesIO(file_bytes),
                sep=sep,
                encoding="latin-1",
                on_bad_lines="skip",
            )
            if len(df.columns) > 1:
                return df
        except Exception:
            continue

    # Last resort: single column with all content
    try:
        df = pd.read_csv(
            io.BytesIO(file_bytes),
            encoding="latin-1",
            on_bad_lines="skip",
        )
        return df
    except Exception as e:
        raise pd.errors.ParserError(f"Could not parse CSV: {last_error or e}") from e


def load_excel_robust(file_bytes: bytes, file_type: str) -> pd.DataFrame:
    """Load Excel with robust header detection and multi-level column handling."""
    # Detect header row
    header_row = detect_header_row(file_bytes, file_type)

    try:
        # Try reading with openpyxl for xlsx, xlrd for xls
        engine = "openpyxl" if file_type == "xlsx" else None
        df = pd.read_excel(
            io.BytesIO(file_bytes),
            header=header_row,
            engine=engine,
        )
    except Exception:
        # Fallback without specifying engine
        df = pd.read_excel(io.BytesIO(file_bytes), header=header_row)

    # Handle multi-level columns
    df = flatten_multiindex_columns(df)

    return df


def load_dataset_file(
    file_bytes: bytes,
    file_type: str,
    nrows: int | None = None,
) -> tuple[pd.DataFrame, str | None]:
    """
    Load a dataset file with robust handling for all formats.
    Returns (dataframe, error_message) — error_message is None on success.
    """
    try:
        if file_type in ("xls", "xlsx"):
            df = load_excel_robust(file_bytes, file_type)
        else:
            df = load_csv_robust(file_bytes)

        # Limit rows if requested
        if nrows is not None and len(df) > nrows:
            df = df.head(nrows)

        # Clean column names
        df.columns = clean_column_names(list(df.columns))

        return df, None

    except pd.errors.EmptyDataError:
        return pd.DataFrame(), "File appears to be empty"
    except pd.errors.ParserError as e:
        logger.warning("file_parse_error", error=str(e), file_type=file_type)
        return pd.DataFrame(), f"Could not parse file: {e}"
    except Exception as e:
        logger.warning("file_load_failed", error=str(e), file_type=file_type)
        return pd.DataFrame(), f"Failed to load file: {e}"


def estimate_row_count(file_bytes: bytes, file_type: str) -> int:
    """Estimate row count without loading entire file."""
    try:
        if file_type in ("xls", "xlsx"):
            # For Excel, read just first column
            df_count = pd.read_excel(io.BytesIO(file_bytes), usecols=[0])
            return len(df_count)
        else:
            # For CSV, count newlines (fast approximation)
            newline_count = file_bytes.count(b"\n")
            # Subtract 1 for header
            return max(0, newline_count - 1)
    except Exception:
        return 0


def extract_instrument_text(file_bytes: bytes, file_type: str) -> str:
    """Extract text from instrument files (DOCX, PDF, Excel, CSV)."""
    file_type = file_type.lower()

    try:
        # Excel/CSV: join all cell values
        if file_type in ("csv", "xls", "xlsx"):
            df, _ = load_dataset_file(file_bytes, file_type)
            if df.empty:
                return ""
            # Join all non-empty cell values
            all_values = []
            for col in df.columns:
                all_values.append(safe_str(col))
            for _, row in df.iterrows():
                for val in row:
                    text = safe_str(val)
                    if text:
                        all_values.append(text)
            return " ".join(all_values[:1000])  # Limit to first 1000 values

        # DOCX: extract from word/document.xml
        if file_type == "docx":
            try:
                with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as zf:
                    if "word/document.xml" in zf.namelist():
                        xml_content = zf.read("word/document.xml").decode("utf-8", errors="replace")
                        # Strip XML tags
                        text = re.sub(r'<[^>]+>', ' ', xml_content)
                        text = re.sub(r'\s+', ' ', text).strip()
                        return text
            except (zipfile.BadZipFile, KeyError):
                pass
            return ""

        # PDF or other binary: extract printable ASCII sequences >= 4 chars
        printable_sequences = []
        current_seq = []
        for byte in file_bytes:
            if 32 <= byte <= 126:  # Printable ASCII
                current_seq.append(chr(byte))
            else:
                if len(current_seq) >= 4:
                    printable_sequences.append("".join(current_seq))
                current_seq = []
        if len(current_seq) >= 4:
            printable_sequences.append("".join(current_seq))

        return " ".join(printable_sequences[:500])  # Limit sequences

    except Exception as e:
        logger.warning("instrument_extract_failed", error=str(e), file_type=file_type)
        return ""


def analyze_uploads(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Main entry point — called by worker main.py.
    """
    project_id: str = payload["project_id"]
    dataset_id: str = payload.get("dataset_id", "")

    db.update_task_progress(task_id, 10, "Loading dataset...")

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

    # --- Load instrument file if available ---
    instrument_text = ""
    instrument_path = payload.get("instrument_path")
    instrument_file_type = payload.get("instrument_file_type", "")
    if instrument_path:
        try:
            inst_bytes = db.download_file("uploads", instrument_path)
            instrument_text = extract_instrument_text(inst_bytes, instrument_file_type)[:5000]
            logger.info("instrument_loaded", chars=len(instrument_text))
        except Exception as e:
            logger.warning("instrument_load_failed", error=str(e))

    # --- Download and parse dataset ---
    headers: list[str] = []
    sample_rows: list[list[str]] = []
    row_count: int = 0
    filename: str = "dataset.csv"
    load_warning: str | None = None

    if dataset_row and dataset_row.get("original_file_path"):
        db.update_task_progress(task_id, 20, "Parsing file headers...")

        try:
            file_bytes = db.download_file("uploads", dataset_row["original_file_path"])
            filename = dataset_row.get("name", "dataset.csv")
            file_type = (dataset_row.get("file_type") or "csv").lower()

            # Load with robust parsing
            df, error_msg = load_dataset_file(file_bytes, file_type, nrows=6)

            if error_msg:
                load_warning = error_msg
                logger.warning("dataset_load_warning", warning=error_msg, project_id=project_id)

            if not df.empty:
                headers = list(df.columns)
                # Convert sample rows to safe strings
                sample_rows = [
                    [safe_str(val) for val in row]
                    for row in df.head(5).values.tolist()
                ]

                # Estimate row count
                row_count = estimate_row_count(file_bytes, file_type)

        except Exception as e:
            logger.warning("dataset_parse_failed", error=str(e), project_id=project_id)
            load_warning = f"Could not parse dataset: {e}"

    # If we couldn't load headers, still proceed with just filename
    if not headers and load_warning:
        logger.info("proceeding_without_headers", warning=load_warning)

    # --- Build prompt ---
    db.update_task_progress(task_id, 40, "Asking AI to fill form fields...")

    # Build sample CSV safely
    sample_csv_lines = []
    if headers:
        sample_csv_lines.append(", ".join(safe_str(h) for h in headers))
    for row in sample_rows:
        sample_csv_lines.append(", ".join(safe_str(v) for v in row))
    sample_csv = "\n".join(sample_csv_lines)

    # Include instrument text if available
    instrument_section = ""
    if instrument_text:
        instrument_section = f"""
## Survey Instrument (questionnaire text)
{instrument_text[:3000]}
"""

    prompt = f"""You are a survey data analyst for humanitarian NGOs. Analyze the dataset below and fill ALL fields in the provided JSON schema.

## Dataset File: {filename}
## Columns ({len(headers)} total)
{", ".join(headers) if headers else "Not available"}

## Sample Data (first 5 rows)
{sample_csv if sample_csv.strip() else "Not available"}

## Total Rows (approx): {row_count}
{instrument_section}
---

## Form Schema — fill every field with your best inference

{json.dumps(FORM_SCHEMA, indent=2)}

---

## Instructions
1. Fill ALL fields. Do not leave any field empty if you can reasonably infer it.
2. For "sampling_method": choose from allowed_values ONLY. Default to "cluster" for household surveys, "convenience" if no structure is evident.
3. For "objective_tags": pick 1–3 tags that best match. "Baseline" if first data collection, "Endline" if outcome evaluation.
4. For "research_questions": generate 3–5 specific, measurable questions the data could answer based on the column names.
5. For "audience": infer from context — NGO/field data -> "donor" or "internal", academic -> "academic", government -> "government". Default: "donor".
6. For "country" and "regions": look for geographic column names (region, district, wilaya, governorate, state, province, country) and their sample values.
7. Return ONLY a valid JSON object with exactly the field names above. No markdown, no explanation, no extra fields.
"""

    raw = generate(prompt)

    # --- Normalise and validate ---
    db.update_task_progress(task_id, 80, "Processing AI suggestions...")

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
