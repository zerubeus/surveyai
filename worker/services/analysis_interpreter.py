"""
SurveyAI Analyst — Analysis Interpreter Service

Calls Gemini to interpret statistical results in context of the study.

Invariants:
- A2: No causal language for non-experimental designs.
- S2: Effect size must be mentioned in every interpretation.
- A5: At least 2 limitations per interpretation.
- A7: All AI outputs include reasoning field.
"""

from __future__ import annotations

import re
from typing import Any

import structlog

from services.ai_service import generate

logger = structlog.get_logger()

# Causal language patterns (invariant A2)
CAUSAL_PATTERNS = [
    r"\bcauses?\b",
    r"\bleads?\s+to\b",
    r"\bresults?\s+in\b",
    r"\bdue\s+to\b",
    r"\beffect\s+of\b",
    r"\bimpact\s+of\b",
    r"\binfluences?\b",
    r"\bdetermines?\b",
]
CAUSAL_REGEX = re.compile("|".join(CAUSAL_PATTERNS), re.IGNORECASE)


def interpret_analysis(
    results: list[dict[str, Any]],
    study_design: str,
    research_questions: list[Any],
    project_context: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Call Gemini to interpret each analysis result.

    POST-PROCESSING VALIDATION (invariant A2):
    - REJECT if causal language AND non-experimental design
    - REJECT if effect size not mentioned
    - Re-prompt once on rejection

    Returns list of dicts with {plan_id, interpretation, limitations, ai_confidence}.
    """
    is_experimental = study_design in ("experimental", "quasi_experimental")
    interpretations: list[dict[str, Any]] = []

    for result in results:
        plan_id = result.get("plan_id")
        interp = _interpret_single(
            result=result,
            study_design=study_design,
            is_experimental=is_experimental,
            research_questions=research_questions,
            project_context=project_context,
        )
        interp["plan_id"] = plan_id
        interpretations.append(interp)

    return interpretations


def _interpret_single(
    result: dict[str, Any],
    study_design: str,
    is_experimental: bool,
    research_questions: list[Any],
    project_context: dict[str, Any],
) -> dict[str, Any]:
    """Interpret a single analysis result with validation and retry."""
    prompt = _build_interpret_prompt(
        result=result,
        study_design=study_design,
        research_questions=research_questions,
        project_context=project_context,
    )

    response = generate(prompt)
    interpretation_text = response.get("interpretation", "")
    limitations = response.get("limitations", [])
    ai_confidence = response.get("confidence", 0.5)

    # Validate
    rejection_reasons = _validate_interpretation(
        interpretation_text, result, is_experimental
    )

    if rejection_reasons:
        logger.info(
            "interpretation_rejected",
            plan_id=result.get("plan_id"),
            reasons=rejection_reasons,
        )
        # Re-prompt with explicit correction instructions
        retry_prompt = _build_retry_prompt(prompt, rejection_reasons)
        retry_response = generate(retry_prompt)
        interpretation_text = retry_response.get("interpretation", interpretation_text)
        limitations = retry_response.get("limitations", limitations)
        ai_confidence = retry_response.get("confidence", ai_confidence)

        # Validate again — if still fails, force-fix
        retry_reasons = _validate_interpretation(
            interpretation_text, result, is_experimental
        )
        if retry_reasons:
            logger.warning(
                "interpretation_force_fix",
                plan_id=result.get("plan_id"),
                reasons=retry_reasons,
            )
            if not is_experimental:
                interpretation_text = CAUSAL_REGEX.sub(
                    "is associated with", interpretation_text
                )

    # Ensure at least 2 limitations (invariant A5)
    if len(limitations) < 2:
        default_limitations = [
            "This analysis is observational and cannot establish causation.",
            "Results may be affected by unmeasured confounding variables.",
            "The sample may not be fully representative of the target population.",
        ]
        while len(limitations) < 2:
            for lim in default_limitations:
                if lim not in limitations:
                    limitations.append(lim)
                    break
                if len(limitations) >= 2:
                    break

    return {
        "interpretation": interpretation_text,
        "limitations": limitations,
        "ai_confidence": min(1.0, max(0.0, float(ai_confidence))),
        "interpretation_validated": len(
            _validate_interpretation(interpretation_text, result, is_experimental)
        ) == 0,
    }


def _build_interpret_prompt(
    result: dict[str, Any],
    study_design: str,
    research_questions: list[Any],
    project_context: dict[str, Any],
) -> str:
    """Build the interpretation prompt for a single result."""
    parts: list[str] = []

    # Research questions context
    rq_text = ""
    for rq in research_questions:
        if isinstance(rq, dict):
            rq_text += f"- {rq.get('text', str(rq))}\n"
        else:
            rq_text += f"- {rq}\n"

    parts.append(f"## Study Design: {study_design}")
    parts.append(f"## Research Questions:\n{rq_text}")

    sampling = project_context.get("sampling_method", "not specified")
    population = project_context.get("target_population", "not specified")
    parts.append(f"Sampling: {sampling}, Target population: {population}")
    parts.append("")

    # Result details
    parts.append("## Statistical Result")
    parts.append(f"Test: {result.get('test_name', 'unknown')}")
    parts.append(f"Test statistic: {result.get('test_statistic', 'N/A')}")
    parts.append(f"p-value: {result.get('p_value', 'N/A')}")
    parts.append(
        f"Effect size: {result.get('effect_size_name', '?')} = "
        f"{result.get('effect_size_value', 'N/A')} "
        f"({result.get('effect_size_interpretation', '?')})"
    )
    parts.append(f"Sample size: {result.get('sample_size', 'N/A')}")
    parts.append(f"Missing data rate: {result.get('missing_data_rate', 'N/A')}")
    parts.append(f"Assumptions met: {result.get('assumptions_met', 'N/A')}")
    parts.append(f"Fallback used: {result.get('fallback_used', False)}")

    dep_var = result.get("dependent_variable", "")
    indep_var = result.get("independent_variable", "")
    rq_text_single = result.get("research_question_text", "")
    parts.append(f"Variables: {indep_var} → {dep_var}")
    if rq_text_single:
        parts.append(f"Research question: {rq_text_single}")
    parts.append("")

    # Instructions
    observational_note = ""
    if study_design not in ("experimental", "quasi_experimental"):
        observational_note = (
            "CRITICAL: This is an OBSERVATIONAL study (not experimental). "
            "You MUST NOT use causal language. Do NOT say 'causes', 'leads to', "
            "'results in', 'due to', 'effect of', 'impact of', 'influences', "
            "'determines'. Use associational language like 'is associated with', "
            "'is related to', 'there is a relationship between'."
        )

    parts.append(
        "## Task\n"
        "Write 2-3 sentences interpreting this result for a research report.\n\n"
        f"{observational_note}\n\n"
        "You MUST mention the effect size value and its interpretation "
        "(small/medium/large) in your text.\n\n"
        "Return a JSON object with:\n"
        '- "interpretation": string (2-3 sentence interpretation)\n'
        '- "limitations": array of strings (at least 2 limitations)\n'
        '- "confidence": number (0.0-1.0, your confidence in this interpretation)\n'
    )

    return "\n".join(parts)


def _build_retry_prompt(original_prompt: str, rejection_reasons: list[str]) -> str:
    """Build a retry prompt with explicit correction instructions."""
    corrections = "\n".join(f"- {r}" for r in rejection_reasons)
    return (
        f"{original_prompt}\n\n"
        "## CORRECTIONS REQUIRED\n"
        "Your previous interpretation was rejected for these reasons:\n"
        f"{corrections}\n\n"
        "Please fix these issues and try again. Return the same JSON format."
    )


def _validate_interpretation(
    text: str,
    result: dict[str, Any],
    is_experimental: bool,
) -> list[str]:
    """Validate interpretation against invariants. Returns list of rejection reasons."""
    reasons: list[str] = []

    if not text:
        reasons.append("Interpretation is empty")
        return reasons

    # A2: No causal language for observational studies
    if not is_experimental and CAUSAL_REGEX.search(text):
        match = CAUSAL_REGEX.search(text)
        reasons.append(
            f"Causal language detected ('{match.group()}') in non-experimental study"
        )

    # S2: Effect size must be mentioned
    es_value = result.get("effect_size_value")
    if es_value is not None:
        es_str = str(round(float(es_value), 2))
        es_name = result.get("effect_size_name", "")
        # Check if either the value or the name appears
        if es_str not in text and es_name not in text.lower():
            reasons.append(
                f"Effect size not mentioned (expected {es_name}={es_str})"
            )

    return reasons
