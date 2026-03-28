"""
Chisquare — Analysis Planner Service

Reads project research questions + column roles, calls Gemini to propose
analysis pairs (variable X × variable Y + test type). User reviews before running.

Invariants:
- S5: Likert → non-parametric only. Never t-test, never ANOVA.
- A7: All AI outputs include reasoning field.
"""

from __future__ import annotations

import json
from typing import Any

import structlog

from db import SupabaseDB
from services.ai_service import generate

logger = structlog.get_logger()

# Allowed test types for AI proposals
VALID_TEST_TYPES = {
    "t_test",
    "mann_whitney",
    "anova",
    "kruskal_wallis",
    "chi_square",
    "fishers_exact",
    "pearson",
    "spearman",
    "logistic_regression",
    # Advanced analytics (added Sprint 11)
    "linear_regression",
    "welchs_t",
    "kendall_tau",
    "point_biserial",
    "moderation_analysis",
    "mediation_analysis",
}

# Non-parametric tests (safe for Likert/ordinal)
NON_PARAMETRIC_TESTS = {
    "mann_whitney",
    "kruskal_wallis",
    "chi_square",
    "fishers_exact",
    "spearman",
    "kendall_tau",
    "point_biserial",
}


def generate_analysis_plan(
    db: SupabaseDB, task_id: str, payload: dict[str, Any]
) -> None:
    """
    Read project research questions + column roles → propose analysis pairs.

    Payload: {"dataset_id": str, "project_id": str}
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]

    logger.info("analysis_plan_start", dataset_id=dataset_id, project_id=project_id)

    # Step 1: Load project context
    db.update_task_progress(task_id, 5, "Loading project context...")
    project = db.get_project(project_id)
    if not project:
        raise ValueError(f"Project {project_id} not found")

    research_questions = project.get("research_questions") or []
    if not research_questions:
        raise ValueError(
            "No research questions found. Add research questions in project setup."
        )

    sampling_method = project.get("sampling_method") or "not specified"
    study_design = project.get("study_design") or "cross_sectional"

    # Step 2: Load column mappings with roles
    db.update_task_progress(task_id, 15, "Loading column mappings...")
    mappings = db.select("column_mappings", filters={"dataset_id": dataset_id})
    if not mappings:
        raise ValueError(f"No column mappings found for dataset {dataset_id}")

    # Build column info for prompt
    columns_info: list[dict[str, str]] = []
    likert_columns: set[str] = set()
    weight_column: str | None = None
    cluster_column: str | None = None
    stratum_column: str | None = None

    for m in mappings:
        role = m.get("role") or "ignore"
        if role == "ignore":
            continue

        col_name = m["column_name"]
        data_type = m.get("data_type") or "text"
        is_likert = m.get("is_likert", False) or data_type == "likert"

        if is_likert:
            likert_columns.add(col_name)
        if role == "weight":
            weight_column = col_name
        elif role == "cluster_id":
            cluster_column = col_name
        elif role == "stratum":
            stratum_column = col_name

        columns_info.append({
            "name": col_name,
            "role": role,
            "data_type": data_type,
            "is_likert": str(is_likert),
        })

    # Step 3: Build Gemini prompt
    db.update_task_progress(task_id, 30, "Generating analysis proposals with AI...")
    prompt = _build_planner_prompt(
        research_questions=research_questions,
        columns_info=columns_info,
        sampling_method=sampling_method,
        study_design=study_design,
    )

    response = generate(prompt)

    # Step 4: Parse and validate proposals
    db.update_task_progress(task_id, 60, "Validating proposals...")
    proposals = _parse_proposals(response, likert_columns)

    if not proposals:
        raise ValueError("AI returned no valid analysis proposals")

    # Step 5: Clear previous plans for this dataset
    db.update_task_progress(task_id, 70, "Storing analysis plans...")
    existing = db.select(
        "analysis_plans",
        filters={"dataset_id": dataset_id},
    )
    planned_ids = [p["id"] for p in existing if p.get("status") == "planned"]
    for plan_id in planned_ids:
        db.delete("analysis_plans", {"id": plan_id})

    # Step 6: Insert proposals as analysis_plans rows
    # created_by is injected by main.py from the task record (always a valid UUID)
    created_by = payload.get("created_by")
    if not created_by:
        raise ValueError("created_by is required in payload — must be a valid user UUID")
    inserted = 0

    for proposal in proposals:
        rq_id = proposal.get("research_question_id")
        rq_text = proposal.get("research_question_text", "")

        db.insert("analysis_plans", {
            "project_id": project_id,
            "dataset_id": dataset_id,
            "created_by": created_by,
            "research_question_id": rq_id,
            "research_question_text": rq_text,
            "dependent_variable": proposal["dependent_variable"],
            "independent_variable": proposal["independent_variable"],
            "control_variables": proposal.get("control_variables", []),
            "selected_test": proposal["selected_test"],
            "test_rationale": proposal["rationale"],
            "fallback_test": proposal.get("fallback_test"),
            "is_weighted": weight_column is not None,
            "weight_column": weight_column,
            "cluster_column": cluster_column,
            "stratum_column": stratum_column,
            "status": "planned",
        })
        inserted += 1

    db.complete_task(task_id, {
        "message": f"Generated {inserted} analysis proposals",
        "proposals_count": inserted,
    })
    logger.info("analysis_plan_complete", proposals=inserted)


def _build_planner_prompt(
    research_questions: list[Any],
    columns_info: list[dict[str, str]],
    sampling_method: str,
    study_design: str,
) -> str:
    """Build the Gemini prompt for analysis plan generation."""
    parts: list[str] = []

    parts.append("## Study Context")
    parts.append(f"Study design: {study_design}")
    parts.append(f"Sampling method: {sampling_method}")
    parts.append("")

    parts.append("## Research Questions")
    for i, rq in enumerate(research_questions):
        if isinstance(rq, dict):
            rq_id = rq.get("id", str(i + 1))
            rq_text = rq.get("text", str(rq))
        else:
            rq_id = str(i + 1)
            rq_text = str(rq)
        parts.append(f"{rq_id}. {rq_text}")
    parts.append("")

    parts.append("## Available Columns")
    parts.append("| column_name | role | data_type | is_likert |")
    parts.append("|---|---|---|---|")
    for col in columns_info:
        parts.append(
            f"| {col['name']} | {col['role']} | {col['data_type']} "
            f"| {col['is_likert']} |"
        )
    parts.append("")

    valid_tests = ", ".join(sorted(VALID_TEST_TYPES))

    parts.append(
        "## Task\n"
        "For each research question, propose 1-3 analysis pairs.\n\n"
        "Return a JSON array where each element has:\n"
        '- "research_question_id": string (the question ID from above)\n'
        '- "research_question_text": string (the question text)\n'
        '- "dependent_variable": string (exact column name — the outcome)\n'
        '- "independent_variable": string (exact column name — the predictor)\n'
        '- "selected_test": string (one of: ' + valid_tests + ')\n'
        '- "rationale": string (1-2 sentences explaining the test choice)\n'
        '- "fallback_test": string or null (test to use if assumptions fail)\n'
        '- "control_variables": array of column name strings (optional covariates)\n'
        "\n"
        "CRITICAL RULES:\n"
        "- For Likert columns (is_likert=True): ONLY use non-parametric tests "
        "(mann_whitney, kruskal_wallis, spearman, chi_square, fishers_exact). "
        "NEVER use t_test, anova, or pearson for Likert columns.\n"
        "- Use column names EXACTLY as listed above.\n"
        "- Only propose tests that make sense for the data types involved.\n"
        "- For continuous outcome + 2-group predictor: t_test (fallback: mann_whitney)\n"
        "- For continuous outcome + 3+ group predictor: anova (fallback: kruskal_wallis)\n"
        "- For categorical outcome + categorical predictor: chi_square (fallback: fishers_exact)\n"
        "- For continuous × continuous: pearson (fallback: spearman)\n"
        "- For binary outcome + multiple predictors: logistic_regression\n"
        "- For continuous outcome + multiple continuous predictors: linear_regression\n"
        "  (put primary predictor in independent_variable, covariates in control_variables)\n"
        "- For testing if Z moderates X→Y relationship: moderation_analysis\n"
        "  (put moderator in control_variables[0])\n"
        "- For testing X→M→Y indirect effect: mediation_analysis\n"
        "  (put mediator in control_variables[0])\n"
        "- For binary + continuous correlation: point_biserial\n"
        "- For rank correlation (robust to outliers): kendall_tau or spearman\n"
        "- For unequal variance two-group comparison: welchs_t\n"
        "- Return the array directly, not wrapped in an object.\n"
    )

    return "\n".join(parts)


def _parse_proposals(
    response: Any,
    likert_columns: set[str],
) -> list[dict[str, Any]]:
    """Parse and validate AI response into proposal dicts."""
    if isinstance(response, dict):
        # Handle wrapped response
        proposals = response.get("proposals") or response.get("analyses") or []
        if not proposals and isinstance(response, dict):
            proposals = [response]
    elif isinstance(response, list):
        proposals = response
    else:
        logger.error("invalid_ai_response_type", response_type=type(response).__name__)
        return []

    valid: list[dict[str, Any]] = []

    for p in proposals:
        if not isinstance(p, dict):
            continue

        dep_var = p.get("dependent_variable") or p.get("y_variable", "")
        indep_var = p.get("independent_variable") or p.get("x_variable", "")
        test = p.get("selected_test") or p.get("test_type", "")
        rationale = p.get("rationale") or p.get("test_rationale", "")

        if not dep_var or not indep_var or not test:
            continue

        # Normalize test name
        test = test.lower().strip()
        if test not in VALID_TEST_TYPES:
            continue

        # Invariant S5: Likert columns → non-parametric only
        if dep_var in likert_columns or indep_var in likert_columns:
            if test not in NON_PARAMETRIC_TESTS:
                # Auto-fix: swap to non-parametric equivalent
                fallback_map = {
                    "t_test": "mann_whitney",
                    "anova": "kruskal_wallis",
                    "pearson": "spearman",
                }
                test = fallback_map.get(test, "mann_whitney")
                rationale += (
                    " [Auto-corrected: Likert column requires non-parametric test]"
                )

        fallback = p.get("fallback_test")
        if fallback and fallback not in VALID_TEST_TYPES:
            fallback = None

        valid.append({
            "research_question_id": p.get("research_question_id"),
            "research_question_text": p.get("research_question_text", ""),
            "dependent_variable": dep_var,
            "independent_variable": indep_var,
            "selected_test": test,
            "rationale": rationale,
            "fallback_test": fallback,
            "control_variables": p.get("control_variables", []),
        })

    return valid
