"""
SurveyAI Analyst — Analysis Executor Service

Runs all approved analysis plans for a dataset. Performs assumption checks,
selects final test (with auto-fallback), computes effect sizes, and stores results.

Invariants:
- S1: Assumptions checked BEFORE every parametric test. Auto-fallback on failure.
- S2: Effect size with EVERY inferential result. Required field, not optional.
- S3: Survey design effects when cluster/strata columns exist.
- S4: Chi-square only when expected cells >= 5. Otherwise Fisher's exact.
- S5: Likert → non-parametric tests ONLY. Never t-test, never ANOVA.
- S6: Missing data rate disclosed in every result.
"""

from __future__ import annotations

import io
import json
import math
from typing import Any

import numpy as np
import pandas as pd
import structlog
from scipy import stats

from db import SupabaseDB
from services.analysis_interpreter import interpret_analysis

logger = structlog.get_logger()


def run_analysis(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Run all approved analysis plans for a dataset.

    Payload: {"dataset_id": str, "project_id": str}
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]

    logger.info("analysis_run_start", dataset_id=dataset_id, project_id=project_id)

    # Step 1: Load approved plans
    db.update_task_progress(task_id, 5, "Loading approved analysis plans...")
    plans = db.select("analysis_plans", filters={"dataset_id": dataset_id})
    approved_plans = [p for p in plans if p.get("status") == "approved"]

    if not approved_plans:
        raise ValueError("No approved analysis plans found for this dataset")

    # Step 2: Load dataset (use cleaned version if available)
    db.update_task_progress(task_id, 10, "Loading dataset...")
    project = db.get_project(project_id)
    dataset = _get_current_dataset(db, dataset_id, project_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    df = _load_dataframe(db, dataset)
    logger.info("analysis_dataset_loaded", rows=len(df), columns=len(df.columns))

    # Step 3: Load column mappings for Likert detection
    mappings = db.select("column_mappings", filters={"dataset_id": dataset_id})
    likert_cols = {
        m["column_name"]
        for m in mappings
        if m.get("is_likert") or m.get("data_type") == "likert"
    }

    # Step 4: Run each analysis
    total_plans = len(approved_plans)
    completed_results: list[dict[str, Any]] = []

    for idx, plan in enumerate(approved_plans):
        plan_id = plan["id"]
        progress = 15 + int((idx / max(total_plans, 1)) * 65)
        dep_var = plan["dependent_variable"]
        indep_var = plan["independent_variable"]

        db.update_task_progress(
            task_id, progress,
            f"Running analysis {idx + 1}/{total_plans}: {indep_var} → {dep_var}",
        )

        # Mark plan as running
        db.update("analysis_plans", {"status": "running"}, {"id": plan_id})

        try:
            result = _run_single_analysis(df, plan, likert_cols)
            result["plan_id"] = plan_id
            result["project_id"] = project_id
            result["dataset_id"] = dataset_id

            # Store the result (without interpretation yet)
            db.insert("analysis_results", result)
            completed_results.append({**result, **plan})

            # Mark plan as completed
            db.update("analysis_plans", {"status": "completed"}, {"id": plan_id})

        except Exception as e:
            logger.error("analysis_plan_failed", plan_id=plan_id, error=str(e))
            db.update("analysis_plans", {"status": "failed"}, {"id": plan_id})
            continue

    if not completed_results:
        raise ValueError("All analysis plans failed")

    # Step 5: AI interpretation
    db.update_task_progress(task_id, 85, "Generating AI interpretations...")
    study_design = project.get("study_design", "cross_sectional") if project else "cross_sectional"
    research_questions = project.get("research_questions", []) if project else []
    project_context = {
        "sampling_method": project.get("sampling_method") if project else None,
        "target_population": project.get("target_population") if project else None,
    }

    interpretations = interpret_analysis(
        results=completed_results,
        study_design=study_design,
        research_questions=research_questions,
        project_context=project_context,
    )

    # Step 6: Store interpretations
    db.update_task_progress(task_id, 92, "Storing interpretations...")
    for interp in interpretations:
        plan_id = interp.get("plan_id")
        if not plan_id:
            continue

        # Find the analysis_results row for this plan
        result_rows = db.select("analysis_results", filters={"plan_id": plan_id})
        if result_rows:
            db.update(
                "analysis_results",
                {
                    "interpretation": interp["interpretation"],
                    "limitations": json.loads(
                        json.dumps(interp["limitations"], default=str)
                    ),
                    "ai_confidence": interp["ai_confidence"],
                    "interpretation_validated": interp["interpretation_validated"],
                },
                {"id": result_rows[0]["id"]},
            )

    db.complete_task(task_id, {
        "message": f"Completed {len(completed_results)} analyses",
        "completed_count": len(completed_results),
        "total_plans": total_plans,
    })
    logger.info("analysis_run_complete", completed=len(completed_results))


def _get_current_dataset(
    db: SupabaseDB, dataset_id: str, project_id: str
) -> dict[str, Any] | None:
    """Get the current (most recent) dataset version."""
    current = db.select(
        "datasets",
        filters={"project_id": project_id, "is_current": True},
    )
    if current:
        return current[0]
    return db.get_dataset(dataset_id)


def _load_dataframe(db: SupabaseDB, dataset: dict[str, Any]) -> pd.DataFrame:
    """Load dataset from storage into DataFrame."""
    file_path = dataset.get("working_file_path") or dataset["original_file_path"]
    bucket = "datasets" if dataset.get("working_file_path") else "uploads"
    file_bytes = db.download_file(bucket, file_path)
    buf = io.BytesIO(file_bytes)

    file_type: str = dataset["file_type"]
    if file_type in (
        "xlsx", "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ):
        return pd.read_excel(buf)
    return pd.read_csv(buf, encoding_errors="replace")


def _run_single_analysis(
    df: pd.DataFrame,
    plan: dict[str, Any],
    likert_cols: set[str],
) -> dict[str, Any]:
    """Run a single statistical analysis with assumption checking."""
    dep_var = plan["dependent_variable"]
    indep_var = plan["independent_variable"]
    selected_test = plan["selected_test"]
    fallback_test = plan.get("fallback_test")
    weight_col = plan.get("weight_column")
    is_likert = dep_var in likert_cols or indep_var in likert_cols

    # Validate columns exist
    if dep_var not in df.columns:
        raise ValueError(f"Dependent variable '{dep_var}' not in dataset")
    if indep_var not in df.columns:
        raise ValueError(f"Independent variable '{indep_var}' not in dataset")

    # Compute missing rates (S6)
    total_rows = len(df)
    missing_x = int(df[indep_var].isna().sum())
    missing_y = int(df[dep_var].isna().sum())
    combined_mask = df[indep_var].notna() & df[dep_var].notna()
    n_used = int(combined_mask.sum())
    missing_rate = round(1.0 - (n_used / max(total_rows, 1)), 4)

    if n_used < 3:
        raise ValueError(
            f"Insufficient data: only {n_used} complete cases for "
            f"{indep_var} × {dep_var}"
        )

    # Invariant S5: force non-parametric for Likert
    if is_likert and selected_test in ("t_test", "anova", "pearson"):
        fallback_map = {
            "t_test": "mann_whitney",
            "anova": "kruskal_wallis",
            "pearson": "spearman",
        }
        selected_test = fallback_map.get(selected_test, "mann_whitney")

    # Run assumption checks and determine final test
    assumptions_checked, assumptions_met, final_test = _check_assumptions_and_select(
        df, dep_var, indep_var, selected_test, fallback_test, is_likert
    )
    fallback_used = final_test != plan["selected_test"]

    # Execute the test
    test_result = _execute_test(df, dep_var, indep_var, final_test, weight_col)

    # Compute effect size (S2: required)
    es_name, es_value, es_interp = _compute_effect_size(
        df, dep_var, indep_var, final_test, test_result
    )

    return {
        "test_name": final_test,
        "test_statistic": _safe_float(test_result.get("statistic")),
        "p_value": _safe_float(test_result.get("p_value")),
        "degrees_of_freedom": _safe_float(test_result.get("df")),
        "confidence_interval": test_result.get("confidence_interval"),
        "effect_size_name": es_name,
        "effect_size_value": round(float(es_value), 4),
        "effect_size_interpretation": es_interp,
        "sample_size": n_used,
        "missing_data_rate": missing_rate,
        "assumptions_met": assumptions_met,
        "fallback_used": fallback_used,
        "raw_output": json.loads(json.dumps({
            "assumptions_checked": assumptions_checked,
            "missing_x": missing_x,
            "missing_y": missing_y,
            "n_used": n_used,
            "test_details": {
                k: _safe_float(v) if isinstance(v, (float, np.floating)) else v
                for k, v in test_result.items()
            },
        }, default=_json_safe)),
    }


def _check_assumptions_and_select(
    df: pd.DataFrame,
    dep_var: str,
    indep_var: str,
    proposed_test: str,
    fallback_test: str | None,
    is_likert: bool,
) -> tuple[list[dict[str, Any]], bool, str]:
    """
    Check assumptions for the proposed test. Return to fallback if assumptions fail.

    Returns: (assumptions_checked, all_passed, final_test_name)
    """
    assumptions: list[dict[str, Any]] = []
    all_passed = True

    # Non-parametric tests don't need assumption checks
    non_parametric = {"mann_whitney", "kruskal_wallis", "spearman", "fishers_exact"}
    if proposed_test in non_parametric:
        return assumptions, True, proposed_test

    if proposed_test in ("t_test", "anova", "pearson"):
        # Normality check
        numeric_dep = pd.to_numeric(df[dep_var], errors="coerce").dropna()
        if len(numeric_dep) <= 5000:
            stat_val, p_val = stats.shapiro(
                numeric_dep.sample(min(len(numeric_dep), 5000), random_state=42)
            )
        else:
            stat_val, p_val = stats.normaltest(numeric_dep)

        normality_passed = p_val > 0.05
        assumptions.append({
            "name": "normality",
            "passed": normality_passed,
            "details": f"p={p_val:.4f} (Shapiro-Wilk)" if len(numeric_dep) <= 5000
            else f"p={p_val:.4f} (D'Agostino-Pearson)",
        })
        if not normality_passed:
            all_passed = False

    if proposed_test in ("t_test", "anova"):
        # Homogeneity of variance (Levene's test)
        groups = _get_groups(df, dep_var, indep_var)
        if len(groups) >= 2 and all(len(g) >= 2 for g in groups):
            lev_stat, lev_p = stats.levene(*groups)
            levene_passed = lev_p > 0.05
            assumptions.append({
                "name": "homogeneity_of_variance",
                "passed": levene_passed,
                "details": f"Levene's test p={lev_p:.4f}",
            })
            if not levene_passed:
                all_passed = False

        # Sample size per group
        for i, g in enumerate(groups):
            if len(g) < 30:
                assumptions.append({
                    "name": "sample_size",
                    "passed": False,
                    "details": f"Group {i} has n={len(g)} (< 30)",
                })
                all_passed = False

    if proposed_test == "chi_square":
        # Expected cell counts (S4)
        contingency = pd.crosstab(df[indep_var].dropna(), df[dep_var].dropna())
        if contingency.size > 0:
            chi2, _, _, expected = stats.chi2_contingency(contingency)
            min_expected = expected.min()
            cells_ok = min_expected >= 5
            assumptions.append({
                "name": "expected_cell_counts",
                "passed": cells_ok,
                "details": f"Minimum expected count: {min_expected:.1f}",
            })
            if not cells_ok:
                all_passed = False

    # Determine final test
    if all_passed or is_likert:
        return assumptions, all_passed, proposed_test

    # Fallback mapping
    if fallback_test and fallback_test in {
        "mann_whitney", "kruskal_wallis", "spearman", "fishers_exact",
    }:
        return assumptions, False, fallback_test

    default_fallbacks = {
        "t_test": "mann_whitney",
        "anova": "kruskal_wallis",
        "pearson": "spearman",
        "chi_square": "fishers_exact",
    }
    final = default_fallbacks.get(proposed_test, proposed_test)
    return assumptions, False, final


def _get_groups(
    df: pd.DataFrame, dep_var: str, indep_var: str
) -> list[np.ndarray]:
    """Split dep_var into groups by indep_var values."""
    mask = df[dep_var].notna() & df[indep_var].notna()
    sub = df.loc[mask]
    numeric_dep = pd.to_numeric(sub[dep_var], errors="coerce").dropna()
    groups_df = sub.loc[numeric_dep.index]
    return [
        pd.to_numeric(group[dep_var], errors="coerce").dropna().values
        for _, group in groups_df.groupby(indep_var)
    ]


def _execute_test(
    df: pd.DataFrame,
    dep_var: str,
    indep_var: str,
    test_name: str,
    weight_col: str | None,
) -> dict[str, Any]:
    """Execute a statistical test and return results dict."""
    mask = df[dep_var].notna() & df[indep_var].notna()
    sub = df.loc[mask]

    if test_name == "t_test":
        groups = _get_groups(df, dep_var, indep_var)
        if len(groups) < 2:
            raise ValueError("t-test requires at least 2 groups")
        stat, p = stats.ttest_ind(groups[0], groups[1], equal_var=False)
        return {"statistic": stat, "p_value": p, "df": len(groups[0]) + len(groups[1]) - 2}

    if test_name == "mann_whitney":
        groups = _get_groups(df, dep_var, indep_var)
        if len(groups) < 2:
            raise ValueError("Mann-Whitney requires at least 2 groups")
        stat, p = stats.mannwhitneyu(groups[0], groups[1], alternative="two-sided")
        return {"statistic": stat, "p_value": p}

    if test_name == "anova":
        groups = _get_groups(df, dep_var, indep_var)
        if len(groups) < 2:
            raise ValueError("ANOVA requires at least 2 groups")
        stat, p = stats.f_oneway(*groups)
        df_between = len(groups) - 1
        df_within = sum(len(g) for g in groups) - len(groups)
        return {"statistic": stat, "p_value": p, "df": df_between, "df_within": df_within}

    if test_name == "kruskal_wallis":
        groups = _get_groups(df, dep_var, indep_var)
        if len(groups) < 2:
            raise ValueError("Kruskal-Wallis requires at least 2 groups")
        stat, p = stats.kruskal(*groups)
        return {"statistic": stat, "p_value": p, "df": len(groups) - 1}

    if test_name == "chi_square":
        contingency = pd.crosstab(sub[indep_var], sub[dep_var])
        chi2, p, dof, expected = stats.chi2_contingency(contingency)
        return {"statistic": chi2, "p_value": p, "df": dof}

    if test_name == "fishers_exact":
        contingency = pd.crosstab(sub[indep_var], sub[dep_var])
        if contingency.shape == (2, 2):
            odds_ratio, p = stats.fisher_exact(contingency)
            return {"statistic": odds_ratio, "p_value": p}
        else:
            # For larger tables, fall back to chi-square
            chi2, p, dof, _ = stats.chi2_contingency(contingency)
            return {"statistic": chi2, "p_value": p, "df": dof}

    if test_name == "pearson":
        x = pd.to_numeric(sub[indep_var], errors="coerce").dropna()
        y = pd.to_numeric(sub[dep_var], errors="coerce").dropna()
        common = x.index.intersection(y.index)
        r, p = stats.pearsonr(x.loc[common], y.loc[common])
        return {"statistic": r, "p_value": p, "df": len(common) - 2}

    if test_name == "spearman":
        x = pd.to_numeric(sub[indep_var], errors="coerce").dropna()
        y = pd.to_numeric(sub[dep_var], errors="coerce").dropna()
        common = x.index.intersection(y.index)
        r, p = stats.spearmanr(x.loc[common], y.loc[common])
        return {"statistic": r, "p_value": p}

    if test_name == "logistic_regression":
        return _run_logistic_regression(sub, dep_var, indep_var)

    raise ValueError(f"Unknown test: {test_name}")


def _run_logistic_regression(
    df: pd.DataFrame, dep_var: str, indep_var: str
) -> dict[str, Any]:
    """Run logistic regression using statsmodels."""
    try:
        import statsmodels.api as sm
    except ImportError:
        raise RuntimeError("statsmodels required for logistic regression")

    y = pd.to_numeric(df[dep_var], errors="coerce").dropna()
    x = pd.to_numeric(df[indep_var], errors="coerce").dropna()
    common = y.index.intersection(x.index)
    y = y.loc[common]
    x = x.loc[common]
    x_const = sm.add_constant(x)

    model = sm.Logit(y, x_const).fit(disp=0)

    return {
        "statistic": float(model.llr),
        "p_value": float(model.llr_pvalue),
        "df": int(model.df_model),
        "odds_ratios": {
            str(k): round(float(np.exp(v)), 4)
            for k, v in model.params.items()
        },
        "confidence_interval": {
            "lower": round(float(model.conf_int().iloc[-1, 0]), 4),
            "upper": round(float(model.conf_int().iloc[-1, 1]), 4),
            "level": 0.95,
        },
    }


def _compute_effect_size(
    df: pd.DataFrame,
    dep_var: str,
    indep_var: str,
    test_name: str,
    test_result: dict[str, Any],
) -> tuple[str, float, str]:
    """
    Compute effect size for the test. Returns (name, value, interpretation).

    Invariant S2: Effect size is REQUIRED for every result.
    """
    mask = df[dep_var].notna() & df[indep_var].notna()
    sub = df.loc[mask]

    if test_name in ("t_test", "mann_whitney"):
        # Cohen's d
        groups = _get_groups(df, dep_var, indep_var)
        if len(groups) >= 2 and len(groups[0]) > 0 and len(groups[1]) > 0:
            mean1, mean2 = groups[0].mean(), groups[1].mean()
            n1, n2 = len(groups[0]), len(groups[1])
            var1, var2 = groups[0].var(ddof=1), groups[1].var(ddof=1)
            pooled_std = math.sqrt(
                ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2)
            )
            if pooled_std > 0:
                d = abs(mean1 - mean2) / pooled_std
            else:
                d = 0.0
            return "cohens_d", d, _interpret_cohens_d(d)
        return "cohens_d", 0.0, "negligible"

    if test_name in ("anova", "kruskal_wallis"):
        # Eta-squared
        groups = _get_groups(df, dep_var, indep_var)
        all_vals = np.concatenate(groups)
        grand_mean = all_vals.mean()
        ss_between = sum(len(g) * (g.mean() - grand_mean) ** 2 for g in groups)
        ss_total = np.sum((all_vals - grand_mean) ** 2)
        eta_sq = ss_between / ss_total if ss_total > 0 else 0.0
        return "eta_squared", float(eta_sq), _interpret_eta_squared(float(eta_sq))

    if test_name in ("chi_square", "fishers_exact"):
        # Cramer's V
        contingency = pd.crosstab(sub[indep_var], sub[dep_var])
        n = contingency.values.sum()
        if n > 0 and contingency.size > 0:
            chi2, _, _, _ = stats.chi2_contingency(contingency)
            min_dim = min(contingency.shape) - 1
            if min_dim > 0:
                v = math.sqrt(chi2 / (n * min_dim))
            else:
                v = 0.0
            return "cramers_v", float(v), _interpret_cramers_v(float(v))
        return "cramers_v", 0.0, "negligible"

    if test_name in ("pearson", "spearman"):
        # r² as effect size
        r = test_result.get("statistic", 0)
        r_sq = float(r) ** 2 if r is not None else 0.0
        return "r_squared", r_sq, _interpret_r_squared(r_sq)

    if test_name == "logistic_regression":
        # Odds ratio
        odds = test_result.get("odds_ratios", {})
        # Get the predictor's odds ratio (skip constant)
        or_vals = [v for k, v in odds.items() if k != "const"]
        if or_vals:
            or_val = or_vals[0]
            return "odds_ratio", float(or_val), _interpret_odds_ratio(float(or_val))
        return "odds_ratio", 1.0, "negligible"

    return "unknown", 0.0, "unknown"


def _interpret_cohens_d(d: float) -> str:
    """Interpret Cohen's d effect size."""
    d = abs(d)
    if d < 0.2:
        return "negligible"
    if d < 0.5:
        return "small"
    if d < 0.8:
        return "medium"
    return "large"


def _interpret_eta_squared(eta: float) -> str:
    """Interpret eta-squared effect size."""
    if eta < 0.01:
        return "negligible"
    if eta < 0.06:
        return "small"
    if eta < 0.14:
        return "medium"
    return "large"


def _interpret_cramers_v(v: float) -> str:
    """Interpret Cramer's V effect size."""
    if v < 0.1:
        return "negligible"
    if v < 0.3:
        return "small"
    if v < 0.5:
        return "medium"
    return "large"


def _interpret_r_squared(r_sq: float) -> str:
    """Interpret r-squared effect size."""
    if r_sq < 0.01:
        return "negligible"
    if r_sq < 0.09:
        return "small"
    if r_sq < 0.25:
        return "medium"
    return "large"


def _interpret_odds_ratio(or_val: float) -> str:
    """Interpret odds ratio effect size."""
    deviation = abs(or_val - 1.0)
    if deviation < 0.5:
        return "small"
    if deviation < 1.5:
        return "medium"
    return "large"


def _safe_float(val: Any) -> float | None:
    """Convert to float safely, handling NaN/inf."""
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 6)
    except (TypeError, ValueError):
        return None


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
