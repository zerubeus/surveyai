"""
Chisquare — Bias Detection Service

Detects bias types in survey data using rule-based statistical tests.
AI explains the implications — never decides the flag.

All bias flags are computed deterministically with scipy.stats.
Each check runs only if required columns exist. Missing required
columns → check silently absent from results (not shown as N/A).
"""

from __future__ import annotations

import io
import json
from typing import Any

import numpy as np
import pandas as pd
import structlog
from scipy import stats

from db import SupabaseDB

logger = structlog.get_logger()

# Significance threshold
ALPHA = 0.05

# Keywords for enumerator column detection
ENUMERATOR_KEYWORDS = frozenset({
    "enumerator", "enum", "interviewer", "collector",
})


def run_bias_detection(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Detect bias types in survey data.

    Payload: {"dataset_id": str, "project_id": str}
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]

    logger.info("bias_detection_start", dataset_id=dataset_id, project_id=project_id)

    # Load dataset
    db.update_task_progress(task_id, 5, "Loading dataset...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    df = _load_dataframe(db, dataset)
    logger.info("bias_loaded", rows=len(df), columns=len(df.columns))

    # Load column mappings
    db.update_task_progress(task_id, 10, "Loading column mappings...")
    mappings = db.select("column_mappings", filters={"dataset_id": dataset_id})
    mapping_by_name = {m["column_name"]: m for m in mappings}

    bias_flags: list[dict[str, Any]] = []

    # Bias 1: Non-response bias (requires demographic + outcome columns)
    db.update_task_progress(task_id, 20, "Checking non-response bias...")
    nr_flags = _check_non_response_bias(df, mapping_by_name)
    bias_flags.extend(nr_flags)
    logger.info("non_response_checked", flags=len(nr_flags))

    # Bias 2: Acquiescence bias (requires Likert columns)
    db.update_task_progress(task_id, 35, "Checking acquiescence bias...")
    acq_flags = _check_acquiescence_bias(df, mapping_by_name)
    bias_flags.extend(acq_flags)
    logger.info("acquiescence_checked", flags=len(acq_flags))

    # Bias 3: Social desirability bias (requires outcome columns)
    db.update_task_progress(task_id, 50, "Checking social desirability bias...")
    sd_flags = _check_social_desirability_bias(df, mapping_by_name)
    bias_flags.extend(sd_flags)
    logger.info("social_desirability_checked", flags=len(sd_flags))

    # Bias 4: Enumerator bias (requires metadata column with enumerator-like name)
    db.update_task_progress(task_id, 65, "Checking enumerator bias...")
    enum_flags = _check_enumerator_bias(df, mapping_by_name)
    bias_flags.extend(enum_flags)
    logger.info("enumerator_bias_checked", flags=len(enum_flags))

    # Bias 5: Selection bias (always runs)
    db.update_task_progress(task_id, 80, "Checking selection bias...")
    sel_flags = _check_selection_bias(df, mapping_by_name)
    bias_flags.extend(sel_flags)
    logger.info("selection_bias_checked", flags=len(sel_flags))

    # Store bias flags
    db.update_task_progress(task_id, 90, "Storing bias detection results...")
    for flag in bias_flags:
        bias_type = flag.get("bias_type", "measurement_bias")
        db.insert("eda_results", {
            "dataset_id": dataset_id,
            "column_name": None,
            "result_type": "bias_check",
            "profile": None,
            "quality_score": None,
            "issues": [],
            "bias_type": bias_type,
            "bias_severity": flag.get("severity", "warning"),
            "bias_evidence": json.loads(json.dumps({
                "affected_columns": flag.get("affected_columns", []),
                "statistic_name": flag.get("statistic_name"),
                "statistic_value": flag.get("statistic_value"),
                "p_value": flag.get("p_value"),
                "description": flag.get("description"),
            }, default=_json_safe)),
            "bias_recommendation": flag.get("recommendation"),
        })

    db.complete_task(task_id, {
        "message": "Bias detection complete",
        "total_flags": len(bias_flags),
        "bias_types_found": list({f["bias_type"] for f in bias_flags}),
    })
    logger.info("bias_detection_complete", total_flags=len(bias_flags))


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


def _check_non_response_bias(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Chi-square test: are missing values correlated with demographic columns?
    Requires: demographic columns AND outcome columns with missing values.
    """
    flags: list[dict[str, Any]] = []

    demo_cols = [
        col for col, m in mapping_by_name.items()
        if m.get("role") == "demographic" and col in df.columns
    ]
    outcome_cols = [
        col for col, m in mapping_by_name.items()
        if m.get("role") in ("outcome", "covariate")
        and col in df.columns
        and 0 < df[col].isna().sum() < len(df) * 0.95
    ]

    if not demo_cols or not outcome_cols:
        return flags

    affected: list[str] = []
    min_p = 1.0

    for outcome_col in outcome_cols[:10]:
        missing_indicator = df[outcome_col].isna().astype(int)
        for demo_col in demo_cols[:5]:
            demo_data = df[demo_col].dropna()
            if demo_data.nunique() < 2 or demo_data.nunique() > 20:
                continue

            try:
                contingency = pd.crosstab(df[demo_col], missing_indicator)
                if contingency.shape[0] < 2 or contingency.shape[1] < 2:
                    continue
                chi2, p, _, _ = stats.chi2_contingency(contingency)
                if p < ALPHA:
                    affected.append(f"{outcome_col} x {demo_col}")
                    min_p = min(min_p, p)
            except (ValueError, np.linalg.LinAlgError):
                continue

    if affected:
        flags.append({
            "bias_type": "non_response_bias",
            "severity": "warning" if min_p > 0.01 else "critical",
            "affected_columns": affected[:10],
            "statistic_name": "chi_square",
            "statistic_value": None,
            "p_value": round(min_p, 6),
            "description": (
                f"Missing values are significantly correlated with demographic variables "
                f"in {len(affected)} column pair(s) (min p={min_p:.4f})"
            ),
            "recommendation": (
                "Consider non-response weighting or multiple imputation. "
                "Report non-response patterns in methodology section."
            ),
        })

    return flags


def _check_acquiescence_bias(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Detect acquiescence: >75% of responses on ALL Likert columns are
    >=4 (on 1-5 scale) or top 60% of scale.
    Requires: Likert columns.
    """
    flags: list[dict[str, Any]] = []

    likert_cols: list[str] = []
    high_agree_cols: list[str] = []

    for col_name, m in mapping_by_name.items():
        if col_name not in df.columns:
            continue
        if m.get("data_type") not in ("likert", "ordinal") and not m.get("is_likert"):
            continue

        series = pd.to_numeric(df[col_name], errors="coerce").dropna()
        if len(series) < 10:
            continue

        likert_cols.append(col_name)

        unique_vals = sorted(series.unique())
        if len(unique_vals) < 3:
            continue

        scale_max = max(unique_vals)
        scale_min = min(unique_vals)
        scale_range = scale_max - scale_min
        if scale_range <= 0:
            continue

        # Top 60% of scale = agree threshold
        agree_threshold = scale_min + scale_range * 0.6
        agree_rate = (series >= agree_threshold).sum() / len(series)

        if agree_rate > 0.75:
            high_agree_cols.append(col_name)

    # Flag only if >75% agreement on ALL Likert columns (or nearly all)
    if len(likert_cols) >= 3 and len(high_agree_cols) == len(likert_cols):
        flags.append({
            "bias_type": "acquiescence_bias",
            "severity": "warning",
            "affected_columns": high_agree_cols[:10],
            "statistic_name": "agree_rate",
            "statistic_value": round(len(high_agree_cols) / max(len(likert_cols), 1), 3),
            "p_value": None,
            "description": (
                f"All {len(likert_cols)} Likert columns have >75% responses in top 60% of scale, "
                f"suggesting acquiescence bias"
            ),
            "recommendation": (
                "Consider reverse-coded items to detect straight-lining. "
                "Flag respondents with zero variance across Likert items."
            ),
        })

    return flags


def _check_social_desirability_bias(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Detect suspiciously low variance on outcome columns.
    Flag outcome columns with std < 0.3 * scale_range.
    Requires: outcome columns.
    """
    flags: list[dict[str, Any]] = []

    outcome_cols = [
        col for col, m in mapping_by_name.items()
        if m.get("role") == "outcome"
        and m.get("data_type") in ("continuous", "likert", "ordinal")
        and col in df.columns
    ]

    if not outcome_cols:
        return flags

    low_var_cols: list[str] = []

    for col in outcome_cols:
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) < 10:
            continue

        scale_range = float(series.max() - series.min())
        if scale_range <= 0:
            continue

        std_val = float(series.std())

        if std_val < 0.3 * scale_range:
            low_var_cols.append(col)

    if low_var_cols:
        flags.append({
            "bias_type": "social_desirability_bias",
            "severity": "warning",
            "affected_columns": low_var_cols[:10],
            "statistic_name": "std_vs_range",
            "statistic_value": None,
            "p_value": None,
            "description": (
                f"{len(low_var_cols)} outcome column(s) have suspiciously low variance "
                f"(std < 0.3 * scale range): {', '.join(low_var_cols[:5])}"
            ),
            "recommendation": (
                "Consider whether social desirability may affect responses. "
                "Use indirect questioning or list experiments for validation."
            ),
        })

    return flags


def _check_enumerator_bias(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    ANOVA: is there significant variance between enumerators on outcome variables?
    Requires: a column with role=metadata AND name containing
    "enumerator"/"enum"/"interviewer"/"collector".
    """
    flags: list[dict[str, Any]] = []

    # Find enumerator column: must have role=metadata AND matching name
    enum_col = None
    for col_name, m in mapping_by_name.items():
        if col_name not in df.columns:
            continue
        name_lower = col_name.lower()
        is_enum_name = any(kw in name_lower for kw in ENUMERATOR_KEYWORDS)

        if is_enum_name and m.get("role") == "metadata":
            enum_col = col_name
            break
        # Fallback: any column with enumerator-like name
        if is_enum_name and enum_col is None:
            enum_col = col_name

    if enum_col is None:
        return flags

    enumerators = df[enum_col].dropna().unique()
    if len(enumerators) < 2:
        return flags

    # Test outcome columns
    outcome_cols = [
        col for col, m in mapping_by_name.items()
        if m.get("role") in ("outcome", "covariate")
        and m.get("data_type") == "continuous"
        and col in df.columns
    ]

    if not outcome_cols:
        return flags

    affected: list[str] = []
    min_p = 1.0

    for col in outcome_cols[:10]:
        groups = []
        for enum_id in enumerators:
            group_data = pd.to_numeric(
                df.loc[df[enum_col] == enum_id, col], errors="coerce"
            ).dropna()
            if len(group_data) >= 3:
                groups.append(group_data.values)

        if len(groups) < 2:
            continue

        try:
            f_stat, p = stats.f_oneway(*groups)
            if p < ALPHA and not np.isnan(f_stat):
                affected.append(col)
                min_p = min(min_p, p)
        except (ValueError, ZeroDivisionError):
            continue

    if affected:
        flags.append({
            "bias_type": "enumerator_bias",
            "severity": "warning" if min_p > 0.01 else "critical",
            "affected_columns": affected[:10],
            "statistic_name": "f_oneway",
            "statistic_value": None,
            "p_value": round(min_p, 6),
            "description": (
                f"Significant variance between enumerators detected in "
                f"{len(affected)} outcome variable(s) (ANOVA, min p={min_p:.4f})"
            ),
            "recommendation": (
                "Investigate enumerator effects. Consider including enumerator "
                "as a fixed effect or using enumerator-level random effects."
            ),
        })

    return flags


def _check_selection_bias(
    df: pd.DataFrame,
    mapping_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Compare demographic distributions in sample vs expected uniform distribution.
    Flag if any category >60% dominant.
    Always runs (no required columns — checks whatever demographics exist).
    """
    flags: list[dict[str, Any]] = []

    # Find demographic columns
    demo_cols = [
        col for col, m in mapping_by_name.items()
        if m.get("role") == "demographic"
        and m.get("data_type") in ("categorical", "binary")
        and col in df.columns
    ]

    if not demo_cols:
        return flags

    skewed_cols: list[str] = []
    for col in demo_cols[:10]:
        freq = df[col].value_counts(normalize=True)
        if len(freq) >= 2 and freq.iloc[0] > 0.60:
            skewed_cols.append(col)

    if skewed_cols:
        flags.append({
            "bias_type": "selection_bias",
            "severity": "warning",
            "affected_columns": skewed_cols,
            "statistic_name": "max_category_proportion",
            "statistic_value": None,
            "p_value": None,
            "description": (
                f"Demographic column(s) {', '.join(skewed_cols[:5])} show highly skewed distributions "
                f"(dominant category >60%). Compare against target population."
            ),
            "recommendation": (
                "Compare sample demographics against known population parameters. "
                "Apply post-stratification weights if significant differences exist."
            ),
        })

    return flags


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
