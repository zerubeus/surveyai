"""
SurveyAI Analyst — Cleaning Suggestion Generator

Generates deterministic cleaning suggestions based on EDA results,
then enriches them with AI reasoning and priority ranking.

Invariants:
- D1: Original file NEVER modified (read-only)
- D2: Every transformation has audit record
- A1: AI never auto-applies (approved_by required)
"""

from __future__ import annotations

import io
import json
from typing import Any

import numpy as np
import pandas as pd
import structlog

from db import SupabaseDB
from services import ai_service

logger = structlog.get_logger()

# Common missing value codes to detect
MISSING_VALUE_CODES: list[Any] = [
    999, -99, -999, -9, 99, 98,
    "N/A", "NA", "n/a", "#N/A", ".",
    "na", "None", "none", "null", "NULL",
    "missing", "MISSING",
]


def generate_cleaning_suggestions(
    db: SupabaseDB, task_id: str, payload: dict[str, Any]
) -> None:
    """
    Generate cleaning suggestions for a dataset.

    Payload: {"dataset_id": str, "project_id": str}
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]

    logger.info("cleaning_suggestions_start", dataset_id=dataset_id, project_id=project_id)

    # Step 1: Load dataset
    db.update_task_progress(task_id, 5, "Loading dataset...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    df = _load_dataframe(db, dataset)
    logger.info("cleaning_data_loaded", rows=len(df), columns=len(df.columns))

    # Step 2: Load column mappings + EDA results
    db.update_task_progress(task_id, 10, "Loading analysis results...")
    mappings = db.select("column_mappings", filters={"dataset_id": dataset_id})
    eda_results = db.select("eda_results", filters={"dataset_id": dataset_id})
    mapping_by_name: dict[str, dict[str, Any]] = {
        m["column_name"]: m for m in mappings
    }

    # Index EDA profiles by column name
    eda_by_col: dict[str, dict[str, Any]] = {}
    consistency_issues: list[dict[str, Any]] = []
    for r in eda_results:
        if r.get("result_type") == "column_profile" and r.get("column_name"):
            eda_by_col[r["column_name"]] = r
        if r.get("result_type") == "consistency_check":
            for issue in r.get("issues") or []:
                if isinstance(issue, dict):
                    consistency_issues.append(issue)

    # Step 3: Generate deterministic suggestions
    db.update_task_progress(task_id, 15, "Generating cleaning suggestions...")
    suggestions: list[dict[str, Any]] = []

    # Check 1: Duplicate rows
    dup_suggestions = _check_duplicate_rows(df, mapping_by_name, consistency_issues)
    suggestions.extend(dup_suggestions)

    # Per-column checks
    for col_name, mapping in mapping_by_name.items():
        if col_name not in df.columns:
            continue
        role: str = mapping.get("role") or "ignore"
        if role == "ignore":
            continue
        data_type: str = mapping.get("data_type") or "text"
        is_likert: bool = mapping.get("is_likert", False) or data_type == "likert"
        series = df[col_name]
        eda = eda_by_col.get(col_name, {})
        profile: dict[str, Any] = eda.get("profile") or {}

        # Check 2: Standardize missing values
        missing_sugs = _check_missing_values(series, col_name)
        suggestions.extend(missing_sugs)

        # Check 3: Outlier review (continuous, non-Likert)
        if data_type == "continuous" and not is_likert:
            outlier_sugs = _check_outliers(series, col_name, profile)
            suggestions.extend(outlier_sugs)

        # Check 4: Value standardization (categorical/demographic)
        if data_type in ("categorical", "binary") or role == "demographic":
            std_sugs = _check_value_standardization(series, col_name)
            suggestions.extend(std_sugs)

        # Check 5: Invalid type for numeric columns
        if data_type in ("continuous", "ordinal"):
            type_sugs = _check_invalid_type(series, col_name)
            suggestions.extend(type_sugs)

        # Check 6: Scale check for Likert columns
        if is_likert:
            scale_sugs = _check_likert_scale(series, col_name, mapping)
            suggestions.extend(scale_sugs)

    db.update_task_progress(
        task_id, 50, f"Found {len(suggestions)} suggestions. Enriching with AI..."
    )

    if not suggestions:
        db.update_task_progress(task_id, 90, "No cleaning suggestions needed")
        db.complete_task(
            task_id,
            {"message": "No cleaning issues found", "suggestions_count": 0},
        )
        return

    # Step 4: AI enrichment
    project = db.get_project(project_id)
    project_context: dict[str, Any] = {
        "research_questions": project.get("research_questions") if project else None,
        "sampling_method": project.get("sampling_method") if project else None,
        "target_population": project.get("target_population") if project else None,
    }

    enriched = _enrich_with_ai(suggestions, mapping_by_name, project_context)

    # Step 5: Store suggestions in cleaning_operations
    db.update_task_progress(task_id, 75, "Storing suggestions...")

    # Clear previous pending suggestions for this dataset
    existing = db.select("cleaning_operations", filters={"dataset_id": dataset_id})
    for op in existing:
        if op.get("status") == "pending":
            db.delete("cleaning_operations", {"id": op["id"]})

    stored_count = 0
    for sug in enriched:
        db.insert(
            "cleaning_operations",
            {
                "dataset_id": dataset_id,
                "column_name": sug.get("column_name"),
                "operation_type": sug["operation_type"],
                "status": "pending",
                "severity": sug.get("severity", "info"),
                "priority": sug.get("priority_rank", stored_count),
                "description": sug["description"],
                "reasoning": sug.get(
                    "reasoning",
                    "Deterministic rule detected this issue.",
                ),
                "confidence": min(1.0, max(0.0, float(sug.get("confidence", 0.5)))),
                "parameters": json.loads(
                    json.dumps(sug.get("parameters", {}), default=_json_safe)
                ),
                "affected_rows_estimate": sug.get("affected_rows_count"),
                "impact_preview": json.loads(
                    json.dumps(sug.get("impact_preview"), default=_json_safe)
                ),
            },
        )
        stored_count += 1

    # Update dataset status to 'cleaning'
    db.update("datasets", {"status": "cleaning"}, {"id": dataset_id})

    db.complete_task(
        task_id,
        {
            "message": f"Generated {stored_count} cleaning suggestions",
            "suggestions_count": stored_count,
        },
    )
    logger.info("cleaning_suggestions_complete", suggestions=stored_count)


# ---------------------------------------------------------------------------
# Deterministic rule checks
# ---------------------------------------------------------------------------


def _load_dataframe(db: SupabaseDB, dataset: dict[str, Any]) -> pd.DataFrame:
    """Load dataset from storage into DataFrame."""
    file_path: str = dataset.get("working_file_path") or dataset["original_file_path"]
    bucket = "datasets" if dataset.get("working_file_path") else "uploads"
    file_type: str = dataset["file_type"]
    file_bytes = db.download_file(bucket, file_path)
    buf = io.BytesIO(file_bytes)
    if file_type in (
        "xlsx",
        "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ):
        return pd.read_excel(buf)
    return pd.read_csv(buf, encoding_errors="replace")


def _check_duplicate_rows(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
    consistency_issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Check for exact duplicate rows."""
    suggestions: list[dict[str, Any]] = []

    non_id_cols = [
        col
        for col in df.columns
        if mapping_by_name.get(col, {}).get("role") != "identifier"
    ]
    if not non_id_cols:
        non_id_cols = list(df.columns)

    dup_mask = df[non_id_cols].duplicated(keep="first")
    dup_count = int(dup_mask.sum())

    # Also check consistency results for duplicate flag
    has_dup_issue = any(
        i.get("check_type") == "duplicate_rows" for i in consistency_issues
    )

    if dup_count > 0 or has_dup_issue:
        actual_count = max(dup_count, 1)
        sample_indices = (
            df[dup_mask].head(3).index.tolist() if dup_count > 0 else []
        )
        sample_before = (
            df.iloc[sample_indices].head(3).to_dict("records")
            if sample_indices
            else []
        )

        suggestions.append(
            {
                "operation_type": "remove_duplicates",
                "column_name": None,
                "description": f"Remove {actual_count} duplicate row(s) from the dataset",
                "severity": "critical" if actual_count > 10 else "warning",
                "affected_rows_count": actual_count,
                "parameters": {"keep": "first"},
                "impact_preview": {
                    "sample_before": sample_before[:3],
                    "action": "Remove exact duplicate rows, keeping first occurrence",
                },
            }
        )

    return suggestions


def _check_missing_values(
    series: pd.Series, col_name: str
) -> list[dict[str, Any]]:
    """Scan for common missing value codes."""
    suggestions: list[dict[str, Any]] = []
    found_codes: list[str] = []
    affected_count = 0

    str_series = series.astype(str).str.strip()
    for code in MISSING_VALUE_CODES:
        mask = str_series == str(code)
        count = int(mask.sum())
        if count > 0:
            found_codes.append(str(code))
            affected_count += count

    if found_codes:
        sample_vals = (
            series[str_series.isin(found_codes)].head(3).tolist()
        )
        suggestions.append(
            {
                "operation_type": "standardize_missing",
                "column_name": col_name,
                "description": (
                    f"Standardize missing value codes "
                    f"({', '.join(found_codes[:5])}) to null in '{col_name}'"
                ),
                "severity": "warning",
                "affected_rows_count": affected_count,
                "parameters": {
                    "missing_codes": found_codes,
                    "replace_with": None,
                },
                "impact_preview": {
                    "sample_before": [str(v) for v in sample_vals],
                    "sample_after": [None] * len(sample_vals),
                    "action": f"Replace {', '.join(found_codes[:5])} with null",
                },
            }
        )

    return suggestions


def _check_outliers(
    series: pd.Series,
    col_name: str,
    profile: dict[str, Any],
) -> list[dict[str, Any]]:
    """Check for outliers based on EDA results."""
    suggestions: list[dict[str, Any]] = []
    outlier_count = profile.get("outlier_count", 0)

    if not outlier_count or outlier_count <= 0:
        return suggestions

    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if len(numeric) == 0:
        return suggestions

    q1 = float(numeric.quantile(0.25))
    q3 = float(numeric.quantile(0.75))
    iqr = q3 - q1
    if iqr <= 0:
        return suggestions

    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr

    outlier_mask = (numeric < lower) | (numeric > upper)
    outlier_vals = numeric[outlier_mask].head(3).tolist()
    capped_vals = [max(lower, min(upper, v)) for v in outlier_vals]

    suggestions.append(
        {
            "operation_type": "fix_outlier",
            "column_name": col_name,
            "description": (
                f"Review {outlier_count} outlier(s) in '{col_name}' "
                f"(cap to IQR bounds)"
            ),
            "severity": "warning",
            "affected_rows_count": outlier_count,
            "parameters": {
                "method": "iqr_cap",
                "lower_bound": round(lower, 4),
                "upper_bound": round(upper, 4),
                "q1": round(q1, 4),
                "q3": round(q3, 4),
                "iqr": round(iqr, 4),
            },
            "impact_preview": {
                "sample_before": [round(v, 4) for v in outlier_vals],
                "sample_after": [round(v, 4) for v in capped_vals],
                "action": f"Cap values to [{round(lower, 2)}, {round(upper, 2)}]",
            },
        }
    )

    return suggestions


def _check_value_standardization(
    series: pd.Series, col_name: str
) -> list[dict[str, Any]]:
    """Find case variants in categorical columns."""
    suggestions: list[dict[str, Any]] = []
    non_null = series.dropna().astype(str).str.strip()

    if len(non_null) == 0:
        return suggestions

    # Group values by lowercase version
    lower_groups: dict[str, list[str]] = {}
    for val in non_null.unique():
        key = val.lower()
        if key not in lower_groups:
            lower_groups[key] = []
        if val not in lower_groups[key]:
            lower_groups[key].append(val)

    # Find groups with multiple variants
    variant_groups = {k: v for k, v in lower_groups.items() if len(v) > 1}

    if not variant_groups:
        return suggestions

    affected_count = 0
    sample_mappings: dict[str, str] = {}
    for _key, variants in list(variant_groups.items())[:5]:
        standard = variants[0].strip().title()
        for v in variants:
            if v != standard:
                count = int((non_null == v).sum())
                affected_count += count
                sample_mappings[v] = standard

    if affected_count > 0:
        sample_before = list(sample_mappings.keys())[:3]
        sample_after = [sample_mappings[k] for k in sample_before]

        suggestions.append(
            {
                "operation_type": "recode_values",
                "column_name": col_name,
                "description": (
                    f"Standardize {len(variant_groups)} category variant "
                    f"group(s) in '{col_name}'"
                ),
                "severity": "info",
                "affected_rows_count": affected_count,
                "parameters": {
                    "method": "title_case",
                    "variant_groups": {
                        k: v
                        for k, v in list(variant_groups.items())[:10]
                    },
                },
                "impact_preview": {
                    "sample_before": sample_before,
                    "sample_after": sample_after,
                    "action": "Standardize case variants to title case",
                },
            }
        )

    return suggestions


def _check_invalid_type(
    series: pd.Series, col_name: str
) -> list[dict[str, Any]]:
    """Find non-numeric values in numeric columns."""
    suggestions: list[dict[str, Any]] = []

    numeric = pd.to_numeric(series, errors="coerce")
    non_numeric_mask = series.notna() & numeric.isna()
    non_numeric_count = int(non_numeric_mask.sum())

    if non_numeric_count > 0:
        sample_vals = series[non_numeric_mask].head(3).tolist()
        suggestions.append(
            {
                "operation_type": "fix_data_type",
                "column_name": col_name,
                "description": (
                    f"Fix {non_numeric_count} non-numeric value(s) in "
                    f"numeric column '{col_name}'"
                ),
                "severity": "warning",
                "affected_rows_count": non_numeric_count,
                "parameters": {"target_type": "numeric", "errors": "coerce"},
                "impact_preview": {
                    "sample_before": [str(v) for v in sample_vals],
                    "sample_after": [None] * len(sample_vals),
                    "action": "Coerce non-numeric values to null",
                },
            }
        )

    return suggestions


def _check_likert_scale(
    series: pd.Series,
    col_name: str,
    mapping: dict[str, Any],
) -> list[dict[str, Any]]:
    """Check Likert column values against expected scale."""
    suggestions: list[dict[str, Any]] = []

    scale_min = mapping.get("likert_scale_min")
    scale_max = mapping.get("likert_scale_max")

    # Detect from data if not in mapping
    if scale_min is None or scale_max is None:
        numeric = pd.to_numeric(series.dropna(), errors="coerce").dropna()
        if len(numeric) == 0:
            return suggestions
        unique_vals = sorted(int(v) for v in numeric.unique())
        if len(unique_vals) >= 3:
            scale_min = unique_vals[0]
            scale_max = unique_vals[-1]
        else:
            return suggestions

    valid_values = set(range(int(scale_min), int(scale_max) + 1))
    numeric = pd.to_numeric(series, errors="coerce")
    out_of_range = series.notna() & numeric.notna() & ~numeric.isin(valid_values)
    oor_count = int(out_of_range.sum())

    if oor_count > 0:
        sample_vals = series[out_of_range].head(3).tolist()
        suggestions.append(
            {
                "operation_type": "recode_values",
                "column_name": col_name,
                "description": (
                    f"Remove {oor_count} out-of-range value(s) in Likert "
                    f"column '{col_name}' (expected {scale_min}-{scale_max})"
                ),
                "severity": "warning",
                "affected_rows_count": oor_count,
                "parameters": {
                    "method": "set_null_out_of_range",
                    "scale_min": scale_min,
                    "scale_max": scale_max,
                    "valid_values": sorted(valid_values),
                },
                "impact_preview": {
                    "sample_before": [str(v) for v in sample_vals],
                    "sample_after": [None] * len(sample_vals),
                    "action": f"Set values outside {scale_min}-{scale_max} to null",
                },
            }
        )

    return suggestions


# ---------------------------------------------------------------------------
# AI enrichment
# ---------------------------------------------------------------------------


def _enrich_with_ai(
    suggestions: list[dict[str, Any]],
    mapping_by_name: dict[str, dict[str, Any]],
    project_context: dict[str, Any],
) -> list[dict[str, Any]]:
    """Enrich suggestions with AI reasoning, confidence, and priority."""
    try:
        prompt = _build_ai_prompt(suggestions, mapping_by_name, project_context)
        ai_response = ai_service.generate(prompt)

        # Parse response — expect list of dicts
        if isinstance(ai_response, list):
            ai_by_index: dict[int, dict[str, Any]] = {
                item.get("index", i): item for i, item in enumerate(ai_response)
            }
        elif isinstance(ai_response, dict) and "suggestions" in ai_response:
            ai_by_index = {
                item.get("index", i): item
                for i, item in enumerate(ai_response["suggestions"])
            }
        else:
            ai_by_index = {}

        for i, sug in enumerate(suggestions):
            ai_data = ai_by_index.get(i, {})
            if ai_data:
                sug["reasoning"] = ai_data.get("reasoning", sug.get("reasoning", ""))
                confidence = ai_data.get("confidence", 0.5)
                sug["confidence"] = min(1.0, max(0.0, float(confidence)))
                sug.setdefault("parameters", {})
                sug["parameters"]["impact_on_analysis"] = ai_data.get(
                    "impact_on_analysis", ""
                )
                sug["priority_rank"] = ai_data.get("priority_rank", i)

        # Sort by priority_rank
        suggestions.sort(key=lambda s: s.get("priority_rank", 999))

    except Exception as e:
        logger.warning("ai_enrichment_failed", error=str(e))
        # Fallback: use deterministic defaults
        for i, sug in enumerate(suggestions):
            sug.setdefault(
                "reasoning",
                f"Detected by automated rule: {sug['operation_type']}",
            )
            sug.setdefault("confidence", 0.5)
            sug.setdefault("priority_rank", i)

    return suggestions


def _build_ai_prompt(
    suggestions: list[dict[str, Any]],
    mapping_by_name: dict[str, dict[str, Any]],
    project_context: dict[str, Any],
) -> str:
    """Build the AI prompt for cleaning suggestion enrichment."""
    parts: list[str] = []

    rq = project_context.get("research_questions") or []
    rq_text = (
        "; ".join(
            q.get("text", str(q)) if isinstance(q, dict) else str(q) for q in rq
        )
        if rq
        else "not specified"
    )
    sampling = project_context.get("sampling_method") or "not specified"
    population = project_context.get("target_population") or "not specified"

    parts.append(
        "## Project Context\n"
        f"Sampling method: {sampling}\n"
        f"Target population: {population}\n"
        f"Research questions: {rq_text}\n"
    )

    parts.append("## Column Roles")
    for col_name, mapping in list(mapping_by_name.items())[:50]:
        role = mapping.get("role", "unknown")
        dtype = mapping.get("data_type", "unknown")
        parts.append(f"- {col_name}: role={role}, type={dtype}")
    parts.append("")

    parts.append("## Cleaning Suggestions to Evaluate")
    for i, sug in enumerate(suggestions):
        col = sug.get("column_name") or "dataset-level"
        parts.append(
            f"{i}. [{sug['operation_type']}] {col}: {sug['description']} "
            f"(affected rows: {sug.get('affected_rows_count', '?')})"
        )
    parts.append("")

    parts.append(
        "## Task\n"
        "For each suggestion above, provide:\n"
        "- reasoning: 1-2 sentences explaining WHY this cleaning step matters "
        "for analysis quality\n"
        "- confidence: 0.0-1.0 how certain you are this should be applied\n"
        "- impact_on_analysis: brief description of how this affects downstream "
        "analysis\n"
        "- priority_rank: integer ranking (1 = highest priority)\n"
        "\n"
        "Return a JSON array where each element has:\n"
        "{ index: number, reasoning: string, confidence: number, "
        "impact_on_analysis: string, priority_rank: number }\n"
        "\n"
        "Important:\n"
        "- Higher confidence for issues that could bias results "
        "(duplicates, outliers in outcome variables)\n"
        "- Lower confidence for cosmetic changes (case standardization "
        "on metadata)\n"
        "- Priority: data integrity first, then analytical impact, "
        "then formatting\n"
        "- Return the array directly, not wrapped in an object\n"
    )

    return "\n".join(parts)


def _json_safe(obj: Any) -> Any:
    """Convert numpy/pandas types to JSON-safe Python types."""
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj) if not np.isnan(obj) else None
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if isinstance(obj, np.bool_):
        return bool(obj)
    return str(obj)
