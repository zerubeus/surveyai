"""
Chisquare — Cross-Analysis Chart Generation Service

Generates AI-selected cross-analysis charts based on research questions and
column roles. For each outcome × demographic combination relevant to the RQs,
creates grouped comparison charts (mean outcome by category).

Payload: {"dataset_id": str, "project_id": str}
"""

from __future__ import annotations

import io
import json
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import structlog

from db import SupabaseDB
from services.ai_service import generate

logger = structlog.get_logger()

COLORS = ["#0077BB", "#EE7733", "#009988", "#CC3311", "#33BBEE", "#EE3377", "#BBBBBB"]


def generate_cross_analysis(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Generate AI-selected cross-analysis charts.

    Steps:
    1. Load project context (RQs, sampling, description)
    2. Load column mappings with roles
    3. Load EDA results for column statistics
    4. Ask AI to select relevant outcome × demographic cross-analyses
    5. For each selected pair, generate a grouped comparison chart
    6. Store charts in Supabase Storage + charts table
    7. Update project knowledge_base in additional_context
    """
    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]
    created_by: str = payload.get("created_by", "worker")

    logger.info("cross_analysis_start", dataset_id=dataset_id, project_id=project_id)

    # Step 1: Load project context
    db.update_task_progress(task_id, 5, "Loading project context...")
    project = db.get_project(project_id)
    if not project:
        raise ValueError(f"Project {project_id} not found")

    research_questions = project.get("research_questions") or []
    sampling_method = project.get("sampling_method") or "unknown"
    target_population = project.get("target_population") or ""
    description = project.get("description") or ""

    # Step 2: Load column mappings
    db.update_task_progress(task_id, 10, "Loading column mappings...")
    mappings = db.select("column_mappings", filters={"dataset_id": dataset_id})
    outcome_cols = [m["column_name"] for m in mappings if m.get("role") == "outcome"]
    demographic_cols = [m["column_name"] for m in mappings if m.get("role") == "demographic"]
    covariate_cols = [m["column_name"] for m in mappings if m.get("role") == "covariate"]

    if not outcome_cols or not (demographic_cols or covariate_cols):
        db.complete_task(task_id, {"message": "Not enough outcome/demographic columns for cross-analysis", "charts_generated": 0})
        return

    # Step 3: Load EDA profiles for context
    db.update_task_progress(task_id, 15, "Loading column profiles...")
    eda_rows = db.select("eda_results", filters={"dataset_id": dataset_id, "result_type": "column_profile"})
    eda_by_col: dict[str, dict[str, Any]] = {
        r["column_name"]: r for r in eda_rows if r.get("column_name")
    }

    # Build column summaries for AI prompt
    col_summaries = []
    for m in mappings:
        col = m["column_name"]
        eda = eda_by_col.get(col, {})
        profile = eda.get("profile") or {}
        summary: dict[str, Any] = {
            "name": col,
            "role": m.get("role"),
            "data_type": m.get("data_type"),
        }
        if "frequency_table_top10" in profile:
            summary["categories"] = list(profile["frequency_table_top10"].keys())
        elif "frequency_table" in profile:
            summary["categories"] = list(profile["frequency_table"].keys())
        if "mean" in profile:
            summary["mean"] = profile["mean"]
            summary["std"] = profile.get("std")
        col_summaries.append(summary)

    # Step 4: AI selects cross-analyses
    db.update_task_progress(task_id, 25, "AI selecting relevant cross-analyses...")
    cross_pairs = _select_cross_analyses_with_ai(
        research_questions=research_questions,
        outcome_cols=outcome_cols,
        demographic_cols=demographic_cols,
        covariate_cols=covariate_cols,
        col_summaries=col_summaries,
        description=description,
        sampling_method=sampling_method,
        target_population=target_population,
    )

    logger.info("cross_pairs_selected", count=len(cross_pairs))

    if not cross_pairs:
        db.complete_task(task_id, {"message": "AI selected no cross-analyses", "charts_generated": 0})
        return

    # Step 5: Load dataset
    db.update_task_progress(task_id, 35, "Loading dataset...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")
    df = _load_dataframe(db, dataset)

    # Step 6: Generate charts
    chart_ids: list[str] = []
    total = len(cross_pairs)

    for i, pair in enumerate(cross_pairs):
        progress = 40 + int(50 * (i / total))
        db.update_task_progress(task_id, progress, f"Generating chart {i+1}/{total}...")
        try:
            chart_id = _generate_cross_chart(
                db=db,
                df=df,
                pair=pair,
                project_id=project_id,
                dataset_id=dataset_id,
                created_by=created_by,
            )
            if chart_id:
                chart_ids.append(chart_id)
        except Exception as e:
            logger.warning("cross_chart_failed", pair=pair, error=str(e))

    # Step 7: Update project knowledge base
    db.update_task_progress(task_id, 92, "Updating knowledge base...")
    _update_knowledge_base(db, project_id, project, {
        "cross_analysis": {
            "charts_generated": len(chart_ids),
            "pairs": [
                {
                    "outcome": p["outcome_col"],
                    "group_by": p["group_col"],
                    "title": p["title"],
                    "rq_relevance": p.get("rq_relevance", ""),
                }
                for p in cross_pairs
            ],
        }
    })

    db.complete_task(task_id, {
        "message": f"Generated {len(chart_ids)} cross-analysis charts",
        "charts_generated": len(chart_ids),
        "chart_ids": chart_ids,
    })
    logger.info("cross_analysis_complete", charts=len(chart_ids))


def _select_cross_analyses_with_ai(
    research_questions: Any,
    outcome_cols: list[str],
    demographic_cols: list[str],
    covariate_cols: list[str],
    col_summaries: list[dict[str, Any]],
    description: str,
    sampling_method: str,
    target_population: str,
) -> list[dict[str, Any]]:
    """Ask Gemini to select the most relevant outcome × group combinations."""

    prompt = f"""You are a survey data analyst. Given the research questions and column information below,
select the most relevant cross-analyses to visualise. Focus on comparisons that directly address the
research questions or provide important descriptive context.

## Project Description
{description}

## Sampling Method
{sampling_method}

## Target Population
{target_population}

## Research Questions
{json.dumps(research_questions, indent=2)}

## Available Columns
{json.dumps(col_summaries, indent=2)}

## Task
Select up to 8 cross-analysis pairs (outcome × group_by). Prioritise:
1. Pairs directly related to a research question
2. Outcome × demographic comparisons (mean/distribution)
3. Outcome × covariate comparisons when informative
4. Avoid redundant pairs

Return a JSON array. Each item must have:
- "outcome_col": column name (role=outcome or continuous covariate)
- "group_col": column name (role=demographic or categorical covariate)
- "chart_type": "grouped_bar" | "box" | "heatmap"
- "title": descriptive chart title (plain English)
- "rq_relevance": which research question this addresses (or "descriptive context")
- "description": 1-sentence explanation of what this chart shows

Return ONLY the JSON array, no other text.
"""
    try:
        raw = generate(prompt)
        # generate() returns a dict — get content field
        content = raw if isinstance(raw, str) else raw.get("content", "")
        # Strip markdown fences
        content = content.strip()
        if content.startswith("```"):
            content = "\n".join(content.split("\n")[1:])
            content = content.rstrip("`").strip()
        pairs = json.loads(content)
        if not isinstance(pairs, list):
            return []
        return pairs[:8]  # Cap at 8
    except Exception as e:
        logger.warning("ai_cross_selection_failed", error=str(e))
        # Fallback: generate basic outcome × demographic pairs
        pairs = []
        for oc in outcome_cols[:2]:
            for dc in demographic_cols[:3]:
                pairs.append({
                    "outcome_col": oc,
                    "group_col": dc,
                    "chart_type": "grouped_bar",
                    "title": f"Mean {oc} by {dc}",
                    "rq_relevance": "descriptive context",
                    "description": f"Distribution of {oc} across {dc} categories",
                })
        return pairs[:6]


def _generate_cross_chart(
    db: SupabaseDB,
    df: pd.DataFrame,
    pair: dict[str, Any],
    project_id: str,
    dataset_id: str,
    created_by: str,
) -> str | None:
    """Generate a single cross-analysis chart and store it."""
    outcome_col = pair["outcome_col"]
    group_col = pair["group_col"]
    chart_type = pair.get("chart_type", "grouped_bar")
    title = pair["title"]
    description = pair.get("description", "")

    if outcome_col not in df.columns or group_col not in df.columns:
        return None

    sub = df[[outcome_col, group_col]].dropna()
    if len(sub) < 5:
        return None

    numeric_outcome = pd.to_numeric(sub[outcome_col], errors="coerce")
    if numeric_outcome.notna().sum() < 5:
        return None

    sub = sub.copy()
    sub["_numeric"] = numeric_outcome

    fig, ax = plt.subplots(figsize=(10, 6))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    if chart_type == "grouped_bar" or True:  # default to grouped bar
        group_stats = sub.groupby(group_col)["_numeric"].agg(["mean", "sem", "count"])
        group_stats = group_stats.sort_values("mean", ascending=True)
        # Cap at 12 categories
        if len(group_stats) > 12:
            group_stats = group_stats.tail(12)

        bars = ax.barh(
            [str(g) for g in group_stats.index],
            group_stats["mean"],
            xerr=group_stats["sem"] * 1.96,
            capsize=4,
            color=[COLORS[i % len(COLORS)] for i in range(len(group_stats))],
            alpha=0.85,
            edgecolor="white",
            linewidth=0.5,
        )

        # Value labels on bars
        for bar, (_, row) in zip(bars, group_stats.iterrows()):
            ax.text(
                row["mean"] + row["sem"] * 2 + 0.01,
                bar.get_y() + bar.get_height() / 2,
                f"{row['mean']:.2f} (n={int(row['count'])})",
                va="center",
                fontsize=9,
                color="#333333",
            )

        ax.set_xlabel(f"Mean {outcome_col}", fontsize=11)
        ax.set_ylabel(group_col, fontsize=11)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.axvline(
            group_stats["mean"].mean(),
            color="#999999",
            linestyle="--",
            linewidth=1,
            label=f"Overall mean: {group_stats['mean'].mean():.2f}",
        )
        ax.legend(fontsize=9)

    ax.set_title(title, fontsize=13, fontweight="bold", pad=12)
    if description:
        fig.text(0.5, -0.02, description, ha="center", fontsize=9, color="#666666", style="italic")

    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    png_bytes = buf.read()

    # Store in Supabase Storage
    import uuid
    chart_uuid = str(uuid.uuid4())
    file_name = f"cross_{chart_uuid}.png"
    storage_path = f"{created_by}/{project_id}/{file_name}"
    db.upload_file("charts", storage_path, png_bytes, "image/png")

    # Upsert chart record
    chart_record = db.insert("charts", {
        "project_id": project_id,
        "analysis_result_id": None,
        "created_by": created_by,
        "chart_type": "cross_analysis",
        "title": title,
        "subtitle": description,
        "config": json.dumps({
            "outcome_col": outcome_col,
            "group_col": group_col,
            "rq_relevance": pair.get("rq_relevance", ""),
            "is_cross_analysis": True,
        }),
        "data": json.dumps({"dataset_id": dataset_id, "outcome_col": outcome_col, "group_col": group_col}),
        "file_path": storage_path,
        "has_sample_size": True,
        "is_colorblind_safe": True,
    })
    return chart_record["id"] if chart_record else None


def _update_knowledge_base(
    db: SupabaseDB,
    project_id: str,
    project: dict[str, Any],
    new_data: dict[str, Any],
) -> None:
    """Merge new_data into the project's knowledge_base inside additional_context."""
    import json as _json
    existing_ctx_raw = project.get("additional_context") or "{}"
    try:
        existing_ctx = _json.loads(existing_ctx_raw) if isinstance(existing_ctx_raw, str) else (existing_ctx_raw or {})
    except Exception:
        existing_ctx = {}

    kb = existing_ctx.get("knowledge_base") or {}
    kb.update(new_data)
    existing_ctx["knowledge_base"] = kb

    db.update("projects", {"additional_context": _json.dumps(existing_ctx)}, {"id": project_id})


def _load_dataframe(db: SupabaseDB, dataset: dict[str, Any]) -> pd.DataFrame:
    file_path = dataset["original_file_path"]
    file_type = dataset["file_type"]
    file_bytes = db.download_file("uploads", file_path)
    buf = io.BytesIO(file_bytes)
    if file_type in ("xlsx", "xls",
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      "application/vnd.ms-excel"):
        return pd.read_excel(buf)
    return pd.read_csv(buf, encoding_errors="replace")
