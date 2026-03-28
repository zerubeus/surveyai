"""
Chisquare — Consistency Check Service

Detects logical contradictions, skip logic violations, constraint violations,
enumerator entropy anomalies, duplicate rows, identifier duplicates,
and high-missing columns.

All checks are deterministic rule-based. AI is never called here.
"""

from __future__ import annotations

import io
import json
import re
from typing import Any

import numpy as np
import pandas as pd
import structlog

from db import SupabaseDB

logger = structlog.get_logger()


def run_consistency_checks(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Check for logical contradictions, skip violations, constraint violations.

    Payload: {"dataset_id": str, "project_id": str}
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]

    logger.info("consistency_start", dataset_id=dataset_id, project_id=project_id)

    # Load dataset
    db.update_task_progress(task_id, 5, "Loading dataset...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    df = _load_dataframe(db, dataset)
    logger.info("consistency_loaded", rows=len(df), columns=len(df.columns))

    # Load column mappings
    db.update_task_progress(task_id, 10, "Loading column mappings...")
    mappings = db.select("column_mappings", filters={"dataset_id": dataset_id})
    mapping_by_name = {m["column_name"]: m for m in mappings}

    # Load instrument for skip logic and constraints
    instruments = db.select("instruments", filters={"project_id": project_id})
    instrument = instruments[0] if instruments and instruments[0].get("parse_status") == "parsed" else None

    all_issues: list[dict[str, Any]] = []

    # Check 1: Duplicate rows (exact duplicates across all non-identifier columns)
    db.update_task_progress(task_id, 15, "Checking for duplicate rows...")
    dup_issues = _check_duplicate_rows(df, mapping_by_name)
    all_issues.extend(dup_issues)
    logger.info("duplicates_checked", issues=len(dup_issues))

    # Check 2: Identifier duplicates
    db.update_task_progress(task_id, 25, "Checking identifier duplicates...")
    id_dup_issues = _check_identifier_duplicates(df, mapping_by_name)
    all_issues.extend(id_dup_issues)
    logger.info("identifier_duplicates_checked", issues=len(id_dup_issues))

    # Check 3: Constraint violations
    db.update_task_progress(task_id, 40, "Checking constraint violations...")
    if instrument:
        constraint_issues = _check_constraint_violations(df, instrument)
        all_issues.extend(constraint_issues)
        logger.info("constraints_checked", issues=len(constraint_issues))

    # Check 4: Skip logic violations
    db.update_task_progress(task_id, 55, "Checking skip logic violations...")
    if instrument:
        skip_issues = _check_skip_logic_violations(df, instrument)
        all_issues.extend(skip_issues)
        logger.info("skip_logic_checked", issues=len(skip_issues))

    # Check 5: High missing columns (>50%)
    db.update_task_progress(task_id, 70, "Checking high-missing columns...")
    missing_issues = _check_high_missing_columns(df, mapping_by_name)
    all_issues.extend(missing_issues)
    logger.info("high_missing_checked", issues=len(missing_issues))

    # Check 6: Enumerator entropy
    db.update_task_progress(task_id, 85, "Checking enumerator entropy...")
    enum_issues = _check_enumerator_entropy(df, mapping_by_name)
    all_issues.extend(enum_issues)
    logger.info("enumerator_entropy_checked", issues=len(enum_issues))

    # Store results
    db.update_task_progress(task_id, 90, "Storing consistency results...")
    if all_issues:
        db.insert("eda_results", {
            "dataset_id": dataset_id,
            "column_name": None,
            "result_type": "consistency_check",
            "profile": json.loads(json.dumps({
                "total_checks": 6,
                "total_issues": len(all_issues),
                "critical_count": sum(1 for i in all_issues if i.get("severity") == "critical"),
                "warning_count": sum(1 for i in all_issues if i.get("severity") == "warning"),
            }, default=_json_safe)),
            "quality_score": None,
            "issues": json.loads(json.dumps(all_issues, default=_json_safe)),
        })

    db.complete_task(task_id, {
        "message": "Consistency checks complete",
        "total_issues": len(all_issues),
        "critical_count": sum(1 for i in all_issues if i.get("severity") == "critical"),
    })
    logger.info("consistency_complete", total_issues=len(all_issues))


def _load_dataframe(db: SupabaseDB, dataset: dict[str, Any]) -> pd.DataFrame:
    """Load dataset from storage into DataFrame."""
    file_path: str = dataset["original_file_path"]
    file_type: str = dataset["file_type"]
    file_bytes = db.download_file("uploads", file_path)
    buf = io.BytesIO(file_bytes)
    if file_type in ("xlsx", "xls",
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      "application/vnd.ms-excel"):
        return pd.read_excel(buf)
    return pd.read_csv(buf, encoding_errors="replace")


def _check_duplicate_rows(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Detect exact duplicate rows across all non-identifier columns."""
    issues: list[dict[str, Any]] = []

    # Exclude identifier columns from duplicate check
    non_id_cols = [
        col for col in df.columns
        if mapping_by_name.get(col, {}).get("role") != "identifier"
    ]

    if not non_id_cols:
        non_id_cols = list(df.columns)

    dup_mask = df[non_id_cols].duplicated(keep="first")
    dup_count = int(dup_mask.sum())

    if dup_count > 0:
        issues.append({
            "check_type": "duplicate_rows",
            "severity": "critical",
            "description": f"Dataset contains {dup_count} exact duplicate row(s)",
            "affected_rows_count": dup_count,
            "recommendation": "Remove duplicate rows before analysis to prevent bias",
        })

    return issues


def _check_identifier_duplicates(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Check if identifier columns have duplicate values."""
    issues: list[dict[str, Any]] = []

    id_cols = [
        col for col, m in mapping_by_name.items()
        if m.get("role") == "identifier" and col in df.columns
    ]

    for col in id_cols:
        non_null = df[col].dropna()
        dup_count = len(non_null) - int(non_null.nunique())
        if dup_count > 0:
            issues.append({
                "check_type": "identifier_duplicates",
                "severity": "critical",
                "description": f"Identifier column '{col}' has {dup_count} duplicate value(s)",
                "affected_rows_count": dup_count,
                "recommendation": "Investigate duplicate identifiers — may indicate data entry errors or merged datasets",
            })

    return issues


def _check_skip_logic_violations(
    df: pd.DataFrame,
    instrument: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Detect skip logic violations: column should be null (per instrument skip logic)
    but has a value.
    """
    issues: list[dict[str, Any]] = []
    questions = instrument.get("questions") or []

    for q in questions:
        if not isinstance(q, dict):
            continue
        col_name = q.get("name")
        relevant = q.get("relevant")
        if not col_name or not relevant or col_name not in df.columns:
            continue

        non_null_count = int(df[col_name].notna().sum())
        total = len(df)
        if non_null_count == total:
            # Column with skip logic but ALL values present — possible violation
            issues.append({
                "check_type": "skip_logic_violation",
                "severity": "warning",
                "description": (
                    f"Column '{col_name}' has skip logic (relevant: {relevant[:80]}) "
                    f"but all {total} rows have values"
                ),
                "affected_rows_count": total,
                "recommendation": "Verify skip logic was correctly applied during data collection",
            })

    return issues


def _check_constraint_violations(
    df: pd.DataFrame,
    instrument: dict[str, Any],
) -> list[dict[str, Any]]:
    """Check values outside declared min/max range from instrument."""
    issues: list[dict[str, Any]] = []
    questions = instrument.get("questions") or []

    for q in questions:
        if not isinstance(q, dict):
            continue
        col_name = q.get("name")
        constraint = q.get("constraint")
        if not col_name or not constraint or col_name not in df.columns:
            continue

        series = pd.to_numeric(df[col_name], errors="coerce").dropna()
        if len(series) == 0:
            continue

        min_val = _extract_constraint_bound(constraint, ">=")
        max_val = _extract_constraint_bound(constraint, "<=")

        violation_count = 0
        if min_val is not None:
            violation_count += int((series < min_val).sum())
        if max_val is not None:
            violation_count += int((series > max_val).sum())

        if violation_count > 0:
            issues.append({
                "check_type": "constraint_violation",
                "severity": "warning" if violation_count < 10 else "critical",
                "description": (
                    f"Column '{col_name}' has {violation_count} value(s) outside "
                    f"constraint: {constraint[:80]}"
                ),
                "affected_rows_count": violation_count,
                "recommendation": "Review out-of-range values for data entry errors",
            })

    return issues


def _extract_constraint_bound(constraint: str, operator: str) -> float | None:
    """Extract a numeric bound from a constraint expression."""
    # Match patterns like ". >= 0" or ". <= 120"
    pattern = rf"\.\s*{re.escape(operator)}\s*([\d.]+)"
    match = re.search(pattern, constraint)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    # Also check reversed: "0 <= ." → means ". >= 0"
    reverse_op = "<=" if operator == ">=" else ">="
    pattern_rev = rf"([\d.]+)\s*{re.escape(reverse_op)}\s*\."
    match_rev = re.search(pattern_rev, constraint)
    if match_rev:
        try:
            return float(match_rev.group(1))
        except ValueError:
            pass
    return None


def _check_high_missing_columns(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Flag columns with >50% missing values."""
    issues: list[dict[str, Any]] = []

    for col in df.columns:
        if col not in mapping_by_name:
            continue
        role = mapping_by_name[col].get("role", "ignore")
        if role == "ignore":
            continue

        missing_pct = df[col].isna().sum() / max(len(df), 1) * 100
        if missing_pct > 50:
            issues.append({
                "check_type": "high_missing_column",
                "severity": "warning",
                "description": (
                    f"Column '{col}' (role: {role}) has {missing_pct:.1f}% missing values"
                ),
                "affected_rows_count": int(df[col].isna().sum()),
                "recommendation": "Consider dropping this column or using imputation before analysis",
            })

    return issues


def _check_enumerator_entropy(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Flag enumerators whose data has suspiciously low variance (possible fabrication).
    """
    issues: list[dict[str, Any]] = []

    # Find enumerator column
    enum_col = None
    for col_name, m in mapping_by_name.items():
        name_lower = col_name.lower()
        if "enumerator" in name_lower or "interviewer" in name_lower:
            enum_col = col_name
            break
        if m.get("role") == "metadata" and ("enum" in name_lower or "interviewer" in name_lower):
            enum_col = col_name
            break

    if enum_col is None or enum_col not in df.columns:
        return issues

    # Find outcome/covariate continuous columns to check variance
    check_cols: list[str] = []
    for col_name, m in mapping_by_name.items():
        if m.get("role") in ("outcome", "covariate") and m.get("data_type") == "continuous":
            if col_name in df.columns:
                check_cols.append(col_name)

    if not check_cols:
        return issues

    enumerators = df[enum_col].dropna().unique()
    if len(enumerators) < 2:
        return issues

    for enum_id in enumerators:
        enum_data = df[df[enum_col] == enum_id]
        if len(enum_data) < 5:
            continue

        low_var_cols = 0
        for col in check_cols:
            col_data = pd.to_numeric(enum_data[col], errors="coerce").dropna()
            if len(col_data) < 3:
                continue
            if col_data.std() == 0:
                low_var_cols += 1

        if low_var_cols >= max(1, len(check_cols) // 2):
            issues.append({
                "check_type": "enumerator_entropy",
                "severity": "warning",
                "description": (
                    f"Enumerator '{enum_id}' has zero variance in {low_var_cols} of "
                    f"{len(check_cols)} numeric columns ({len(enum_data)} rows) — "
                    f"possible data fabrication"
                ),
                "affected_rows_count": len(enum_data),
                "recommendation": "Review this enumerator's data for potential fabrication patterns",
            })

    return issues


def _json_safe(obj: Any) -> Any:
    """Convert numpy/pandas types to JSON-safe Python types."""
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj) if not np.isnan(obj) else None
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return str(obj)
