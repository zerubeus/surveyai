"""
Chisquare — EDA Service

Survey-aware Exploratory Data Analysis engine.
Profiles every column respecting confirmed column roles and data types.

Core principle: ALL statistical computation is deterministic Python.
AI is called separately (eda_interpreter) to explain results.

Invariants:
- S5: Likert columns → NEVER compute mean (raises TypeError)
- D1: Original uploads never modified (read-only)
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


def run_eda(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Profile every column in the dataset, respecting survey structure.

    Payload: {"dataset_id": str, "project_id": str}
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]

    logger.info("eda_start", dataset_id=dataset_id, project_id=project_id)

    # Step 1: Load dataset
    db.update_task_progress(task_id, 5, "Loading dataset...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    df = _load_dataframe(db, dataset)
    logger.info("eda_dataset_loaded", rows=len(df), columns=len(df.columns))

    # Step 2: Load column mappings
    db.update_task_progress(task_id, 10, "Loading column mappings...")
    mappings = db.select("column_mappings", filters={"dataset_id": dataset_id})
    if not mappings:
        raise ValueError(f"No column mappings found for dataset {dataset_id}")

    mapping_by_name = {m["column_name"]: m for m in mappings}

    # Step 3: Load instrument for Likert detection + skip logic
    instruments = db.select("instruments", filters={"project_id": project_id})
    instrument_likert_cols: set[str] = set()
    skip_logic_columns: set[str] = set()
    if instruments:
        inst = instruments[0]
        if inst.get("parse_status") == "parsed":
            # Detect Likert from instrument: select_one with numeric consecutive choices
            choice_lists = inst.get("choice_lists") or {}
            for q in (inst.get("questions") or []):
                if not isinstance(q, dict):
                    continue
                qname = q.get("name")
                qtype = q.get("type", "")
                if qname and "select_one" in str(qtype):
                    list_name = q.get("choice_list") or q.get("list_name") or ""
                    choices = choice_lists.get(list_name, [])
                    if _is_likert_choice_list(choices):
                        instrument_likert_cols.add(qname)
            # Skip logic columns
            for q in (inst.get("skip_logic") or []):
                if isinstance(q, dict) and q.get("name"):
                    skip_logic_columns.add(q["name"])
            for q in (inst.get("questions") or []):
                if isinstance(q, dict) and q.get("relevant") and q.get("name"):
                    skip_logic_columns.add(q["name"])

    # Step 4: Find weight column if exists
    weight_col: str | None = None
    for m in mappings:
        if m.get("role") == "weight" and m["column_name"] in df.columns:
            weight_col = m["column_name"]
            break

    # Step 5: Clear previous EDA results for this dataset
    db.update_task_progress(task_id, 15, "Clearing previous results...")
    db.delete("eda_results", {"dataset_id": dataset_id})

    # Step 6: Profile each column
    total_cols = len(mappings)
    results: list[dict[str, Any]] = []

    for idx, mapping in enumerate(mappings):
        col_name = mapping["column_name"]
        if col_name not in df.columns:
            continue

        progress = 15 + int((idx / max(total_cols, 1)) * 70)
        db.update_task_progress(task_id, progress, f"Profiling column: {col_name}")

        role = mapping.get("role") or "ignore"
        data_type = mapping.get("data_type") or "text"
        is_likert = (
            mapping.get("is_likert", False)
            or data_type == "likert"
            or col_name in instrument_likert_cols
        )
        has_skip_logic = col_name in skip_logic_columns

        series = df[col_name]

        # Likert fallback: detect from data if not already flagged
        if not is_likert and role not in ("identifier", "metadata", "ignore"):
            is_likert = _detect_likert_from_data(series)
            if is_likert:
                data_type = "likert"

        profile, issues, quality = _profile_column(
            series=series,
            role=role,
            data_type=data_type,
            is_likert=is_likert,
            has_skip_logic=has_skip_logic,
            weight_col=df[weight_col] if weight_col and weight_col in df.columns else None,
        )

        row = {
            "dataset_id": dataset_id,
            "column_name": col_name,
            "result_type": "column_profile",
            "column_role": role if role != "ignore" else None,
            "data_type": data_type if data_type != "text" else None,
            "profile": json.loads(json.dumps(profile, default=_json_safe)),
            "quality_score": quality,
            "issues": json.loads(json.dumps(issues, default=_json_safe)),
        }
        db.insert("eda_results", row)
        results.append(row)

    # Step 7: Store dataset summary
    db.update_task_progress(task_id, 90, "Generating dataset summary...")
    summary = _build_dataset_summary(df, results, mappings)
    db.insert("eda_results", {
        "dataset_id": dataset_id,
        "column_name": None,
        "result_type": "dataset_summary",
        "profile": json.loads(json.dumps(summary, default=_json_safe)),
        "quality_score": summary.get("overall_quality"),
        "issues": [],
    })

    # Step 8: Complete
    db.complete_task(task_id, {
        "message": "EDA profiling complete",
        "columns_profiled": len(results),
        "overall_quality": summary.get("overall_quality"),
    })
    logger.info("eda_complete", columns_profiled=len(results))


def _is_likert_choice_list(choices: list[Any]) -> bool:
    """Check if a choice list represents a Likert scale (numeric consecutive values)."""
    if not choices or len(choices) < 3:
        return False
    try:
        values = []
        for c in choices:
            if isinstance(c, dict):
                val = c.get("value") or c.get("name")
            else:
                val = c
            values.append(int(val))
        values.sort()
        # Check consecutive: 1-3, 1-5, 1-7, 0-10, etc.
        if values == list(range(values[0], values[-1] + 1)):
            return len(values) >= 3 and values[-1] <= 10
    except (ValueError, TypeError):
        pass
    return False


def _detect_likert_from_data(series: pd.Series) -> bool:
    """Detect Likert from data: integer column with 3-10 distinct consecutive values."""
    numeric = pd.to_numeric(series.dropna(), errors="coerce").dropna()
    if len(numeric) < 10:
        return False

    # Check if all values are integers
    if not (numeric == numeric.astype(int)).all():
        return False

    unique_vals = sorted(numeric.astype(int).unique())
    n_unique = len(unique_vals)

    # 3-10 distinct consecutive integer values
    if n_unique < 3 or n_unique > 10:
        return False

    return unique_vals == list(range(unique_vals[0], unique_vals[-1] + 1))


def _load_dataframe(db: SupabaseDB, dataset: dict[str, Any]) -> pd.DataFrame:
    """Load dataset from storage into DataFrame."""
    file_path: str = dataset["original_file_path"]
    file_type: str = dataset["file_type"]
    file_bytes = db.download_file("uploads", file_path)
    buf = io.BytesIO(file_bytes)

    if file_type in (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "xlsx",
        "xls",
    ):
        return pd.read_excel(buf)
    return pd.read_csv(buf, encoding_errors="replace")


def _profile_column(
    series: pd.Series,
    role: str,
    data_type: str,
    is_likert: bool,
    has_skip_logic: bool,
    weight_col: pd.Series | None,
) -> tuple[dict[str, Any], list[dict[str, Any]], float]:
    """
    Profile a single column based on its role and data type.

    Returns: (profile_dict, issues_list, quality_score)
    """
    issues: list[dict[str, Any]] = []
    total = len(series)
    null_mask = series.isna()
    missing_count = int(null_mask.sum())

    # Split missing: truly missing vs. skipped
    skipped_count = missing_count if has_skip_logic else 0
    true_missing = 0 if has_skip_logic else missing_count

    base_profile: dict[str, Any] = {
        "total_count": total,
        "missing_count": true_missing,
        "skipped_count": skipped_count,
        "missing_pct": round(true_missing / max(total, 1) * 100, 2),
    }

    # High missing rate issue
    missing_rate = true_missing / max(total, 1)
    if missing_rate > 0.3:
        issues.append({
            "type": "high_missing_rate",
            "severity": "warning",
            "description": f"Column has {true_missing} missing values ({missing_rate:.0%})",
            "details": {"missing_count": true_missing, "missing_pct": round(missing_rate * 100, 2)},
        })
    if missing_rate > 0.7 and issues:
        issues[-1]["severity"] = "critical"

    if role == "identifier":
        profile, id_issues = _profile_identifier(series)
        base_profile.update(profile)
        issues.extend(id_issues)
    elif data_type in ("continuous",) and not is_likert:
        profile, cont_issues = _profile_continuous(series, weight_col)
        base_profile.update(profile)
        issues.extend(cont_issues)
    elif is_likert or data_type in ("likert", "ordinal"):
        profile, likert_issues = _profile_likert_ordinal(series, is_likert)
        base_profile.update(profile)
        issues.extend(likert_issues)
    elif data_type == "categorical" or data_type == "binary":
        profile, cat_issues = _profile_categorical(series)
        base_profile.update(profile)
        issues.extend(cat_issues)
    elif role == "metadata" or data_type == "date":
        profile = _profile_metadata(series)
        base_profile.update(profile)
    elif data_type == "text" or role == "open_text":
        profile = _profile_text(series)
        base_profile.update(profile)
    else:
        # Fallback: basic categorical profiling
        profile, cat_issues = _profile_categorical(series)
        base_profile.update(profile)
        issues.extend(cat_issues)

    quality = _compute_quality_score(base_profile, issues, role, data_type)
    return base_profile, issues, quality


def _profile_continuous(
    series: pd.Series,
    weight_col: pd.Series | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Profile a continuous numeric column."""
    issues: list[dict[str, Any]] = []
    numeric = pd.to_numeric(series, errors="coerce").dropna()

    if len(numeric) == 0:
        return {"numeric_count": 0}, issues

    mean_val = float(numeric.mean())
    std_val = float(numeric.std())
    q1 = float(numeric.quantile(0.25))
    q3 = float(numeric.quantile(0.75))
    iqr = q3 - q1

    profile: dict[str, Any] = {
        "numeric_count": len(numeric),
        "mean": round(mean_val, 4),
        "median": round(float(numeric.median()), 4),
        "std": round(std_val, 4),
        "min": round(float(numeric.min()), 4),
        "max": round(float(numeric.max()), 4),
        "p25": round(q1, 4),
        "p75": round(q3, 4),
        "p95": round(float(numeric.quantile(0.95)), 4),
    }

    # Weighted stats
    if weight_col is not None:
        valid_mask = numeric.index
        weights = pd.to_numeric(weight_col.loc[valid_mask], errors="coerce").fillna(0)
        if weights.sum() > 0:
            profile["weighted_mean"] = round(float(np.average(numeric, weights=weights)), 4)

    # Outliers: > 3*IQR beyond Q1/Q3
    if iqr > 0:
        lower_bound = q1 - 3 * iqr
        upper_bound = q3 + 3 * iqr
        outlier_mask = (numeric < lower_bound) | (numeric > upper_bound)
        outlier_count = int(outlier_mask.sum())
        profile["outlier_count"] = outlier_count
        if outlier_count > 0:
            outlier_pct = outlier_count / len(numeric)
            issues.append({
                "type": "outliers_detected",
                "severity": "warning" if outlier_pct < 0.05 else "critical",
                "description": f"{outlier_count} outlier(s) detected (beyond 3*IQR from quartiles)",
                "details": {"outlier_count": outlier_count},
            })
    else:
        profile["outlier_count"] = 0

    # Distribution shape
    if len(numeric) >= 8:
        skewness = float(stats.skew(numeric, nan_policy="omit"))
        profile["skewness"] = round(skewness, 4)
        if abs(skewness) < 0.5:
            profile["distribution"] = "normal"
        elif skewness < -0.5:
            profile["distribution"] = "left_skewed"
        elif skewness > 0.5:
            profile["distribution"] = "right_skewed"
    else:
        profile["distribution"] = "insufficient_data"

    return profile, issues


def _profile_likert_ordinal(
    series: pd.Series,
    is_likert: bool,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Profile a Likert or ordinal column.
    INVARIANT S5: NEVER compute mean for Likert columns.
    """
    issues: list[dict[str, Any]] = []
    non_null = series.dropna()

    if len(non_null) == 0:
        return {"non_null_count": 0}, issues

    freq = non_null.value_counts()
    freq_table = {str(k): {"count": int(v), "pct": round(v / len(non_null) * 100, 2)} for k, v in freq.items()}

    profile: dict[str, Any] = {
        "non_null_count": len(non_null),
        "frequency_table": freq_table,
        "mode": str(freq.index[0]) if len(freq) > 0 else None,
        "n_unique": int(non_null.nunique()),
    }

    # Median is acceptable for ordinal/Likert
    numeric = pd.to_numeric(non_null, errors="coerce").dropna()
    if len(numeric) > 0:
        profile["median"] = round(float(numeric.median()), 2)
        profile["missing_count"] = int(series.isna().sum())
        profile["missing_pct"] = round(int(series.isna().sum()) / max(len(series), 1) * 100, 2)

        # Ordered values as a list
        unique_sorted = sorted(int(v) for v in numeric.unique())
        profile["ordered_values"] = unique_sorted

    return profile, issues


def _profile_categorical(
    series: pd.Series,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Profile a categorical column."""
    issues: list[dict[str, Any]] = []
    non_null = series.dropna()

    if len(non_null) == 0:
        return {"non_null_count": 0}, issues

    n_unique = int(non_null.nunique())
    freq = non_null.value_counts()

    # Top 10 frequency table
    top10 = freq.head(10)
    freq_table = {str(k): {"count": int(v), "pct": round(v / len(non_null) * 100, 2)} for k, v in top10.items()}

    # Rare values (< 1% frequency)
    rare_threshold = len(non_null) * 0.01
    rare_count = int((freq < rare_threshold).sum())

    profile: dict[str, Any] = {
        "non_null_count": len(non_null),
        "n_unique": n_unique,
        "frequency_table_top10": freq_table,
        "rare_count": rare_count,
    }

    if rare_count > n_unique * 0.5 and n_unique > 10:
        issues.append({
            "type": "many_rare_categories",
            "severity": "info",
            "description": f"{rare_count} of {n_unique} categories have <1% frequency",
            "details": {"rare_count": rare_count, "n_unique": n_unique},
        })

    return profile, issues


def _profile_identifier(
    series: pd.Series,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Profile an identifier column."""
    issues: list[dict[str, Any]] = []
    non_null = series.dropna()
    unique_count = int(non_null.nunique())
    duplicate_count = len(non_null) - unique_count

    profile: dict[str, Any] = {
        "unique_count": unique_count,
        "duplicate_count": duplicate_count,
        "missing_count": int(series.isna().sum()),
    }

    if duplicate_count > 0:
        issues.append({
            "type": "duplicate_identifiers",
            "severity": "critical",
            "description": f"Identifier column has {duplicate_count} duplicate value(s)",
            "details": {"duplicate_count": duplicate_count, "unique_count": unique_count},
        })

    return profile, issues


def _profile_metadata(series: pd.Series) -> dict[str, Any]:
    """Profile a metadata/date column."""
    non_null = series.dropna()
    profile: dict[str, Any] = {
        "non_null_count": len(non_null),
        "n_unique": int(non_null.nunique()),
        "missing_count": int(series.isna().sum()),
    }
    # Try to parse as dates
    try:
        dates = pd.to_datetime(non_null, errors="coerce").dropna()
        if len(dates) > 0:
            profile["min_date"] = str(dates.min().date())
            profile["max_date"] = str(dates.max().date())
    except (ValueError, TypeError):
        pass

    return profile


def _profile_text(series: pd.Series) -> dict[str, Any]:
    """Profile a free-text column."""
    non_null = series.dropna().astype(str)
    if len(non_null) == 0:
        return {"non_null_count": 0}
    lengths = non_null.str.len()
    return {
        "non_null_count": len(non_null),
        "avg_length": round(float(lengths.mean()), 1),
        "max_length": int(lengths.max()),
        "min_length": int(lengths.min()),
        "n_unique": int(non_null.nunique()),
    }


def _compute_quality_score(
    profile: dict[str, Any],
    issues: list[dict[str, Any]],
    role: str,
    data_type: str,
) -> float:
    """
    Compute a quality score (0-100) for a column.
    Scoring per spec:
    - Start at 100
    - -20 if missing_pct > 20%
    - -10 if missing_pct > 5%
    - -15 if duplicate_count > 0 (identifier columns)
    - -10 if outlier_count > 5% of rows (continuous columns)
    - -5 if rare_count > 20% of unique values (categorical)
    """
    score = 100.0

    missing_pct = profile.get("missing_pct", 0)
    if missing_pct > 20:
        score -= 20
    elif missing_pct > 5:
        score -= 10

    # Identifier duplicates
    if role == "identifier" and profile.get("duplicate_count", 0) > 0:
        score -= 15

    # Outliers (continuous)
    total = profile.get("total_count", 0) or profile.get("numeric_count", 0)
    outlier_count = profile.get("outlier_count", 0)
    if total > 0 and outlier_count > total * 0.05:
        score -= 10

    # Rare categories
    n_unique = profile.get("n_unique", 0)
    rare_count = profile.get("rare_count", 0)
    if n_unique > 0 and rare_count > n_unique * 0.2:
        score -= 5

    return round(max(0.0, min(100.0, score)), 1)


def _build_dataset_summary(
    df: pd.DataFrame,
    results: list[dict[str, Any]],
    mappings: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build overall dataset summary from column profiles."""
    quality_scores = [r.get("quality_score", 0) for r in results if r.get("quality_score") is not None]
    overall_quality = round(sum(quality_scores) / max(len(quality_scores), 1), 1)

    all_issues: list[dict[str, Any]] = []
    for r in results:
        for issue in (r.get("issues") or []):
            all_issues.append({**issue, "column_name": r.get("column_name")})

    role_counts: dict[str, int] = {}
    for m in mappings:
        role = m.get("role", "unknown")
        role_counts[role] = role_counts.get(role, 0) + 1

    return {
        "row_count": len(df),
        "column_count": len(df.columns),
        "overall_quality": overall_quality,
        "columns_profiled": len(results),
        "role_distribution": role_counts,
        "critical_issues": [i for i in all_issues if i.get("severity") == "critical"],
        "warning_count": sum(1 for i in all_issues if i.get("severity") == "warning"),
        "critical_count": sum(1 for i in all_issues if i.get("severity") == "critical"),
    }


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
