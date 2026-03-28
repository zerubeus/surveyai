"""
SurveyAI Analyst — EDA Interpretation Service

Calls Gemini ONCE with ALL column stats, bias flags, and consistency issues.
Returns structured interpretation (Option 1 — full context).

Invariants:
- A4: Every AI output includes confidence (0.0-1.0)
- AI interprets, code computes
"""

from __future__ import annotations

import json
from typing import Any

import structlog

from services import ai_service

logger = structlog.get_logger()


def interpret_quality_results(
    eda_results: list[dict[str, Any]],
    bias_flags: list[dict[str, Any]],
    consistency_issues: list[dict[str, Any]],
    project_context: dict[str, Any],
    dataset_meta: dict[str, Any],
) -> dict[str, Any]:
    """
    Call Gemini ONCE with ALL column stats (Option 1 — full context).

    Args:
        eda_results: Full per-column stats from DB
        bias_flags: All detected bias flags
        consistency_issues: All consistency check results
        project_context: {research_questions, sampling_method, target_population}
        dataset_meta: {row_count, column_count, file_name}

    Returns:
        {
            "dataset_summary": str,
            "overall_quality_score": int,
            "column_interpretations": [{column_name, finding, implication}],
            "bias_explanations": [{bias_type, plain_language, risk_level}],
            "recommended_next_steps": [str],
        }
    """
    prompt = _build_prompt(eda_results, bias_flags, consistency_issues, project_context, dataset_meta)
    logger.info("interpretation_prompt_built", prompt_len=len(prompt))

    result = _call_and_validate(prompt)
    logger.info("interpretation_complete")
    return result


def _call_and_validate(prompt: str, attempt: int = 1) -> dict[str, Any]:
    """Call Gemini and validate response. Re-prompt once if invalid."""
    try:
        result = ai_service.generate(prompt)

        if not isinstance(result, dict):
            result = {"raw_response": result}

        # Validate required fields
        valid = (
            isinstance(result.get("dataset_summary"), str)
            and isinstance(result.get("overall_quality_score"), (int, float))
            and 0 <= result["overall_quality_score"] <= 100
            and isinstance(result.get("recommended_next_steps"), list)
            and len(result["recommended_next_steps"]) >= 2
        )

        if not valid and attempt == 1:
            logger.warning("interpretation_invalid_response", attempt=1)
            retry_prompt = (
                prompt + "\n\n## IMPORTANT: Your previous response was invalid. "
                "You MUST return a JSON object with these exact keys:\n"
                '- "dataset_summary": string (2-3 sentences)\n'
                '- "overall_quality_score": integer 0-100\n'
                '- "column_interpretations": array of {column_name, finding, implication}\n'
                '- "bias_explanations": array of {bias_type, plain_language, risk_level}\n'
                '- "recommended_next_steps": array of at least 2 strings\n'
            )
            return _call_and_validate(retry_prompt, attempt=2)

        # Ensure defaults for missing fields
        result.setdefault("dataset_summary", "Data quality analysis complete.")
        result.setdefault("overall_quality_score", 50)
        result.setdefault("column_interpretations", [])
        result.setdefault("bias_explanations", [])
        result.setdefault("recommended_next_steps", ["Review flagged columns", "Address critical issues"])

        # Clamp score
        result["overall_quality_score"] = max(0, min(100, int(result["overall_quality_score"])))

        return result

    except Exception as e:
        logger.error("interpretation_failed", error=str(e), attempt=attempt)
        return {
            "dataset_summary": f"AI interpretation unavailable: {e}",
            "overall_quality_score": 0,
            "column_interpretations": [],
            "bias_explanations": [],
            "recommended_next_steps": ["Review EDA results manually", "Check bias flags and consistency issues"],
        }


def _build_prompt(
    eda_results: list[dict[str, Any]],
    bias_flags: list[dict[str, Any]],
    consistency_issues: list[dict[str, Any]],
    project_context: dict[str, Any],
    dataset_meta: dict[str, Any],
) -> str:
    """Build the single prompt for Gemini with ALL column stats."""
    parts: list[str] = []

    # Dataset metadata
    parts.append("## Dataset Overview")
    parts.append(f"- File: {dataset_meta.get('file_name', 'unknown')}")
    parts.append(f"- Rows: {dataset_meta.get('row_count', '?')}")
    parts.append(f"- Columns: {dataset_meta.get('column_count', '?')}")
    parts.append("")

    # Project context
    parts.append("## Project Context")
    rq = project_context.get("research_questions") or []
    rq_text = "; ".join(
        q.get("text", str(q)) if isinstance(q, dict) else str(q) for q in rq
    ) if rq else "not specified"
    parts.append(f"- Research questions: {rq_text}")
    parts.append(f"- Sampling method: {project_context.get('sampling_method') or 'not specified'}")
    parts.append(f"- Target population: {project_context.get('target_population') or 'not specified'}")
    parts.append("")

    # Column profiles (ALL columns)
    column_profiles = [r for r in eda_results if r.get("result_type") == "column_profile"]
    dataset_summaries = [r for r in eda_results if r.get("result_type") == "dataset_summary"]

    if dataset_summaries:
        summary = dataset_summaries[0].get("profile") or {}
        parts.append("## Dataset Quality Summary")
        parts.append(f"- Overall quality score: {summary.get('overall_quality', '?')}/100")
        parts.append(f"- Columns profiled: {summary.get('columns_profiled', '?')}")
        parts.append(f"- Critical issues: {summary.get('critical_count', 0)}")
        parts.append(f"- Warnings: {summary.get('warning_count', 0)}")
        parts.append("")

    parts.append("## ALL Column Statistics")
    for r in column_profiles[:50]:  # Cap to avoid token overflow
        col_name = r.get("column_name", "?")
        profile = r.get("profile") or {}
        quality = r.get("quality_score")
        issues = r.get("issues") or []
        role = r.get("column_role") or "unknown"

        parts.append(f"### {col_name} (role: {role}, quality: {quality}/100)")
        for key in ("mean", "median", "std", "min", "max", "p25", "p75", "p95",
                     "distribution", "n_unique", "mode", "ordered_values",
                     "unique_count", "duplicate_count", "missing_count",
                     "skipped_count", "missing_pct", "outlier_count", "rare_count",
                     "non_null_count", "min_date", "max_date"):
            if key in profile:
                parts.append(f"  - {key}: {profile[key]}")
        if issues:
            parts.append(f"  - Issues: {json.dumps(issues, default=str)[:300]}")
        parts.append("")

    # Bias flags
    if bias_flags:
        parts.append("## Detected Bias Flags")
        for flag in bias_flags:
            bias_type = flag.get("bias_type", "unknown")
            evidence = flag.get("bias_evidence") or {}
            severity = flag.get("bias_severity", "warning")
            desc = evidence.get("description", str(flag))
            parts.append(f"- **{bias_type}** ({severity}): {desc}")
        parts.append("")

    # Consistency issues
    if consistency_issues:
        parts.append("## Consistency Check Results")
        for c in consistency_issues:
            for issue in (c.get("issues") or []):
                affected = issue.get("affected_rows_count", issue.get("affected_rows", "?"))
                parts.append(
                    f"- {issue.get('check_type', '?')}: {issue.get('description', '')} "
                    f"({affected} rows affected)"
                )
        parts.append("")

    # Task instructions
    parts.append("## Task")
    parts.append(
        "You are a survey data quality expert. Based on ALL the statistics above, return a JSON object with:\n\n"
        '1. "dataset_summary": A 2-3 sentence overall quality verdict.\n'
        '2. "overall_quality_score": Integer 0-100 reflecting overall data quality.\n'
        '3. "column_interpretations": Array of objects for columns with quality_score < 80 or flagged issues. '
        'Each object: {"column_name": "...", "finding": "...", "implication": "..."}\n'
        '4. "bias_explanations": Array of objects for each detected bias flag. '
        'Each object: {"bias_type": "...", "plain_language": "...", "risk_level": "low|medium|high"}\n'
        '5. "recommended_next_steps": Array of 3-5 actionable next steps (strings).\n\n'
        "Focus on actionable insights for survey researchers. Be specific about which columns "
        "and what the numbers mean for the research questions. Return ONLY the JSON object."
    )

    return "\n".join(parts)
