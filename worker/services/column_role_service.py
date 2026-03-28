"""
Chisquare — Column Role Detection Service

AI-primary approach: sends ALL columns in ONE batch call to Gemini,
then runs heuristic validation to boost confidence on obvious matches.

Invariants:
- A4: Every AI suggestion includes confidence (0.0-1.0)
- A7: Every AI suggestion includes reasoning
- A1: AI never auto-applies — user must confirm via approved_by
"""

from __future__ import annotations

import io
import re
from typing import Any

import pandas as pd
import structlog

from db import SupabaseDB
from services import ai_service

logger = structlog.get_logger()

# Valid roles and data types (must match DB enums)
VALID_ROLES = frozenset({
    "identifier", "weight", "cluster_id", "stratum", "demographic",
    "outcome", "covariate", "skip_logic", "metadata", "open_text", "ignore",
})
VALID_DATA_TYPES = frozenset({
    "continuous", "categorical", "binary", "ordinal", "likert",
    "date", "text", "identifier",
})

# Heuristic patterns: regex → (role, data_type)
# These boost confidence to 1.0 AFTER AI, never replace AI judgment
HEURISTIC_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    # Weight columns
    (re.compile(r"^(wgt|weight|wt|sampling_weight|pweight|fweight|iweight).*$", re.I), "weight", "continuous"),
    (re.compile(r"^.*_(wgt|weight|wt)$", re.I), "weight", "continuous"),
    # Cluster columns
    (re.compile(r"^(cluster|clus|psu|ea_id|enumeration_area).*$", re.I), "cluster_id", "identifier"),
    (re.compile(r"^.*_(cluster|clus|psu)$", re.I), "cluster_id", "identifier"),
    # Stratum columns
    (re.compile(r"^(stratum|strata|strat).*$", re.I), "stratum", "identifier"),
    (re.compile(r"^.*_(stratum|strata|strat)$", re.I), "stratum", "identifier"),
    # Identifier columns
    (re.compile(r"^(id|_id|uuid|respondent_id|hh_id|hhid|resp_id|case_id)$", re.I), "identifier", "identifier"),
    (re.compile(r"^.*_(id|uuid)$", re.I), "identifier", "identifier"),
    # Metadata: timestamps, GPS, device
    (re.compile(r"^(start|end|today|starttime|endtime|submission_time|deviceid|phonenumber|simserial|subscriberid|username|audit)$", re.I), "metadata", "text"),
    (re.compile(r"^(gps|latitude|longitude|altitude|accuracy|geopoint|geotrace|geoshape).*$", re.I), "metadata", "continuous"),
]


def detect_column_roles(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Detect column roles using AI-primary approach.

    Payload: {
        "dataset_id": str,
        "project_id": str,
        "instrument_id": str | None
    }
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]
    instrument_id: str | None = payload.get("instrument_id")

    logger.info(
        "column_role_detection_start",
        dataset_id=dataset_id,
        project_id=project_id,
        instrument_id=instrument_id,
    )

    # Step 1: Load dataset from storage
    db.update_task_progress(task_id, 5, "Loading dataset...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    file_path: str = dataset["original_file_path"]
    file_type: str = dataset["file_type"]

    file_bytes = db.download_file("uploads", file_path)
    df = _read_dataframe(file_bytes, file_type)
    logger.info("dataset_loaded", rows=len(df), columns=len(df.columns))

    # Step 2: Extract column info (name, sample values, dtype)
    db.update_task_progress(task_id, 15, "Extracting column profiles...")
    columns_info = _extract_column_info(df)

    # Step 3: Load project context
    db.update_task_progress(task_id, 20, "Loading project context...")
    project = db.get_project(project_id)
    if not project:
        raise ValueError(f"Project {project_id} not found")

    project_context = {
        "research_questions": project.get("research_questions"),
        "sampling_method": project.get("sampling_method"),
        "target_population": project.get("target_population"),
        "geographic_scope": project.get("geographic_scope"),
    }

    # Step 4: Load instrument context (if available)
    instrument_questions: list[dict[str, Any]] | None = None
    if instrument_id:
        db.update_task_progress(task_id, 25, "Loading instrument context...")
        instruments = db.select("instruments", filters={"id": instrument_id})
        if instruments and instruments[0].get("parse_status") == "parsed":
            raw_questions = instruments[0].get("questions", [])
            if isinstance(raw_questions, list):
                instrument_questions = [
                    {
                        "name": q.get("name", ""),
                        "label": q.get("label", ""),
                        "type": q.get("question_type", q.get("type", "")),
                    }
                    for q in raw_questions
                ]

    # Step 5: Build prompt and call AI
    db.update_task_progress(task_id, 30, "Detecting column roles with AI...")
    prompt = ai_service.build_column_role_prompt(
        columns=columns_info,
        project_context=project_context,
        instrument_questions=instrument_questions,
    )
    logger.info("ai_prompt_built", prompt_len=len(prompt))

    ai_result = ai_service.generate(prompt)
    logger.info("ai_response_received", result_count=len(ai_result) if isinstance(ai_result, list) else 0)

    # Step 6: Normalize AI response
    db.update_task_progress(task_id, 60, "Validating AI suggestions...")
    ai_mappings = _normalize_ai_response(ai_result, columns_info)

    # Step 7: Run heuristic validation pass
    db.update_task_progress(task_id, 70, "Running heuristic validation...")
    final_mappings = _apply_heuristic_boost(ai_mappings)

    # Step 8: Save to column_mappings table
    db.update_task_progress(task_id, 80, "Saving column mappings...")
    _save_column_mappings(db, dataset_id, final_mappings)

    # Step 9: Update dataset status
    db.update_task_progress(task_id, 90, "Updating dataset status...")
    db.update("datasets", {"status": "profiled"}, {"id": dataset_id})

    # Step 10: Complete task
    weight_detected = any(m["role"] == "weight" for m in final_mappings)
    result_summary = {
        "message": "Column roles detected successfully",
        "total_columns": len(final_mappings),
        "weight_detected": weight_detected,
        "role_counts": _count_roles(final_mappings),
    }
    db.complete_task(task_id, result_summary)
    logger.info("column_role_detection_complete", **result_summary)


def _read_dataframe(file_bytes: bytes, file_type: str) -> pd.DataFrame:
    """Read uploaded file into a DataFrame."""
    buf = io.BytesIO(file_bytes)
    if file_type in (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ):
        return pd.read_excel(buf, nrows=200)
    # Default: CSV
    return pd.read_csv(buf, nrows=200, encoding_errors="replace")


def _extract_column_info(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Extract column name, sample values, and dtype for each column."""
    columns_info: list[dict[str, Any]] = []
    for col in df.columns:
        non_null = df[col].dropna()
        samples = non_null.head(5).tolist() if len(non_null) > 0 else []
        # Convert to strings for JSON safety
        samples = [str(s) for s in samples]
        dtype = str(df[col].dtype)
        columns_info.append({
            "name": str(col),
            "sample_values": samples,
            "dtype": dtype,
        })
    return columns_info


def _normalize_ai_response(
    ai_result: Any,
    columns_info: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Normalize and validate AI response, filling gaps for missing columns."""
    # Build lookup of AI suggestions by column name
    ai_by_name: dict[str, dict[str, Any]] = {}
    if isinstance(ai_result, list):
        for item in ai_result:
            if isinstance(item, dict) and "column_name" in item:
                ai_by_name[item["column_name"]] = item

    mappings: list[dict[str, Any]] = []
    for idx, col_info in enumerate(columns_info):
        col_name = col_info["name"]
        ai_item = ai_by_name.get(col_name)

        if ai_item:
            role = ai_item.get("role", "ignore")
            if role not in VALID_ROLES:
                role = "ignore"
            data_type = ai_item.get("data_type", "text")
            if data_type not in VALID_DATA_TYPES:
                data_type = "text"
            confidence = float(ai_item.get("confidence", 0.5))
            confidence = max(0.0, min(1.0, confidence))
            reasoning = str(ai_item.get("reasoning", "AI-suggested role"))
        else:
            # AI missed this column — assign default
            role = "ignore"
            data_type = "text"
            confidence = 0.3
            reasoning = "Column not analyzed by AI — needs manual review"

        mappings.append({
            "column_name": col_name,
            "column_index": idx,
            "role": role,
            "data_type": data_type,
            "confidence": confidence,
            "reasoning": reasoning,
            "sample_values": col_info.get("sample_values", []),
        })

    return mappings


def _apply_heuristic_boost(mappings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Run heuristic regex patterns AFTER AI to boost confidence on obvious matches.
    Never replaces AI judgment — only increases confidence to 1.0 when patterns match
    and AI agrees on the role.
    """
    for mapping in mappings:
        col_name = mapping["column_name"]
        for pattern, heuristic_role, heuristic_dtype in HEURISTIC_PATTERNS:
            if pattern.match(col_name):
                if mapping["role"] == heuristic_role:
                    # AI agrees with heuristic — boost to 1.0
                    mapping["confidence"] = 1.0
                    mapping["reasoning"] += " [heuristic-confirmed]"
                elif mapping["confidence"] < 0.5:
                    # AI was unsure and heuristic suggests differently — override
                    mapping["role"] = heuristic_role
                    mapping["data_type"] = heuristic_dtype
                    mapping["confidence"] = 0.95
                    mapping["reasoning"] = (
                        f"Heuristic override: column name matches pattern for {heuristic_role}"
                    )
                break  # Only apply first matching pattern
    return mappings


def _save_column_mappings(
    db: SupabaseDB,
    dataset_id: str,
    mappings: list[dict[str, Any]],
) -> None:
    """Save column mappings to the database (one row per column)."""
    # Delete any existing mappings for this dataset (re-detection)
    db.delete("column_mappings", {"dataset_id": dataset_id})

    for mapping in mappings:
        db.insert("column_mappings", {
            "dataset_id": dataset_id,
            "column_name": mapping["column_name"],
            "column_index": mapping["column_index"],
            "role": mapping["role"],
            "data_type": mapping["data_type"],
            "detection_method": "ai_suggestion",
            "detection_confidence": mapping["confidence"],
            "ai_reasoning": mapping["reasoning"],
        })


def _count_roles(mappings: list[dict[str, Any]]) -> dict[str, int]:
    """Count columns per role."""
    counts: dict[str, int] = {}
    for m in mappings:
        role = m["role"]
        counts[role] = counts.get(role, 0) + 1
    return counts
