"""
Chisquare — AI Code Fix Service

Generates safe pandas code from natural language instructions using Gemini,
then executes the code in a sandbox to preview changes before applying.

Tier 2: AI-generated pandas code for custom data cleaning fixes.
"""

from __future__ import annotations

import ast
import json
from typing import Any

import numpy as np
import pandas as pd
import structlog

from db import SupabaseDB
from services.ai_service import generate
from services.file_utils import read_dataframe_from_bytes

logger = structlog.get_logger()


def generate_code_fix(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Generate pandas code from natural language instruction and preview the result.

    Payload: {
        "project_id": str,
        "dataset_id": str,
        "operation_id": str,  # cleaning_operations.id
        "instruction": str,   # the user's natural language instruction
        "column_name": str | None,  # the column this applies to (if any)
    }
    """
    operation_id: str = payload["operation_id"]
    dataset_id: str = payload["dataset_id"]
    instruction: str = payload["instruction"]
    column_name: str | None = payload.get("column_name")

    logger.info(
        "code_fix_start",
        operation_id=operation_id,
        dataset_id=dataset_id,
        column_name=column_name,
    )

    # Step 1: Load operation and validate
    db.update_task_progress(task_id, 5, "Loading operation...")
    ops = db.select("cleaning_operations", filters={"id": operation_id})
    if not ops:
        raise ValueError(f"Cleaning operation {operation_id} not found")
    operation = ops[0]
    existing_params = operation.get("parameters") or {}

    # Step 2: Load dataset and column statistics
    db.update_task_progress(task_id, 15, "Loading dataset context...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    # Find current dataset version
    project_datasets = db.select(
        "datasets",
        filters={
            "project_id": dataset["project_id"],
            "is_current": True,
        },
    )
    current_dataset = project_datasets[0] if project_datasets else dataset

    # Download file for sampling
    file_path = (
        current_dataset.get("working_file_path")
        or current_dataset["original_file_path"]
    )
    bucket = "datasets" if current_dataset.get("working_file_path") else "uploads"
    file_bytes = db.download_file(bucket, file_path)
    file_type: str = current_dataset["file_type"]
    df = read_dataframe_from_bytes(file_bytes, file_type)

    row_count = len(df)

    # Get column statistics from EDA results
    db.update_task_progress(task_id, 25, "Building context from EDA...")
    column_context = _build_column_context(db, dataset_id, column_name, df)

    # Step 3: Call Gemini to generate code
    db.update_task_progress(task_id, 40, "AI generating pandas code...")
    prompt = _build_code_generation_prompt(
        instruction=instruction,
        column_name=column_name,
        row_count=row_count,
        column_context=column_context,
    )

    try:
        ai_result = generate(prompt)
    except Exception as e:
        logger.error("code_fix_ai_error", error=str(e))
        db.fail_task(task_id, f"AI code generation failed: {e}")
        return

    # Validate AI response structure
    code = ai_result.get("code")
    explanation = ai_result.get("explanation", "")
    is_column_op = ai_result.get("is_column_op", True)
    is_safe = ai_result.get("safe", False)
    warning = ai_result.get("warning")

    if not is_safe or not code:
        error_msg = warning or explanation or "AI determined this operation is unsafe"
        logger.warning("code_fix_unsafe", error=error_msg)
        db.update(
            "cleaning_operations",
            {
                "parameters": {
                    **existing_params,
                    "generated_code": None,
                    "code_error": error_msg,
                    "code_safe": False,
                }
            },
            {"id": operation_id},
        )
        db.complete_task(
            task_id,
            {
                "message": "Code generation failed - unsafe operation",
                "operation_id": operation_id,
                "error": error_msg,
                "safe": False,
            },
        )
        return

    # Step 4: Validate generated code (safety checks)
    db.update_task_progress(task_id, 55, "Validating generated code...")
    try:
        _validate_code_safety(code)
    except ValueError as e:
        logger.warning("code_fix_validation_failed", error=str(e))
        db.update(
            "cleaning_operations",
            {
                "parameters": {
                    **existing_params,
                    "generated_code": None,
                    "code_error": str(e),
                    "code_safe": False,
                }
            },
            {"id": operation_id},
        )
        db.fail_task(task_id, f"Code validation failed: {e}")
        return

    # Step 5: Execute in sandbox on sample data
    db.update_task_progress(task_id, 70, "Testing code on sample...")
    sample_df = df.head(500).copy()
    try:
        _, preview_rows, changed_count = run_sandboxed(code, sample_df, column_name)
        # Estimate total changed rows
        if len(sample_df) > 0:
            changed_ratio = changed_count / len(sample_df)
            estimated_total_changed = int(changed_ratio * row_count)
        else:
            estimated_total_changed = 0
    except Exception as e:
        logger.error("code_fix_sandbox_error", error=str(e))
        db.update(
            "cleaning_operations",
            {
                "parameters": {
                    **existing_params,
                    "generated_code": code,
                    "code_error": f"Execution failed: {e}",
                    "code_safe": False,
                }
            },
            {"id": operation_id},
        )
        db.fail_task(task_id, f"Code execution failed: {e}")
        return

    # Step 6: Store results
    db.update_task_progress(task_id, 90, "Saving generated code...")
    db.update(
        "cleaning_operations",
        {
            "parameters": {
                **existing_params,
                "instruction": instruction,
                "generated_code": code,
                "code_explanation": explanation,
                "code_preview": preview_rows,
                "changed_rows_estimate": estimated_total_changed,
                "is_column_op": is_column_op,
                "code_safe": True,
            }
        },
        {"id": operation_id},
    )

    db.complete_task(
        task_id,
        {
            "message": "Code generated successfully",
            "operation_id": operation_id,
            "dataset_id": dataset_id,
            "code": code,
            "explanation": explanation,
            "preview": preview_rows,
            "changed_rows_estimate": estimated_total_changed,
            "safe": True,
        },
    )
    logger.info(
        "code_fix_complete",
        operation_id=operation_id,
        changed_estimate=estimated_total_changed,
    )


def _build_column_context(
    db: SupabaseDB,
    dataset_id: str,
    column_name: str | None,
    df: pd.DataFrame,
) -> dict[str, Any]:
    """Build context about the column/dataset for the AI prompt."""
    context: dict[str, Any] = {
        "row_count": len(df),
        "columns": list(df.columns),
    }

    if column_name and column_name in df.columns:
        col = df[column_name]
        context["data_type"] = str(col.dtype)
        context["missing_count"] = int(col.isna().sum())
        context["missing_pct"] = (
            (context["missing_count"] / len(df) * 100) if len(df) > 0 else 0
        )

        # Sample values (non-null, unique)
        non_null = col.dropna()
        unique_vals = non_null.unique()[:20]
        context["sample_values"] = [str(v) for v in unique_vals]

        # Value counts (top 15)
        value_counts = col.value_counts().head(15).to_dict()
        context["value_counts"] = {str(k): int(v) for k, v in value_counts.items()}

        # Try to get EDA profile for more context
        eda_results = db.select(
            "eda_results",
            filters={
                "dataset_id": dataset_id,
                "result_type": "column_profile",
            },
        )
        for eda in eda_results:
            result_data = eda.get("result_data") or {}
            if result_data.get("column_name") == column_name:
                context["eda_profile"] = result_data
                break

    return context


def _build_code_generation_prompt(
    instruction: str,
    column_name: str | None,
    row_count: int,
    column_context: dict[str, Any],
) -> str:
    """Build the Gemini prompt for code generation."""
    data_type = column_context.get("data_type", "object")
    sample_values = column_context.get("sample_values", [])
    value_counts = column_context.get("value_counts", {})
    missing_count = column_context.get("missing_count", 0)
    missing_pct = column_context.get("missing_pct", 0.0)

    sample_str = ", ".join(f'"{v}"' for v in sample_values[:10])
    value_counts_str = "\n".join(
        f"  {k}: {v}" for k, v in list(value_counts.items())[:10]
    )

    prompt = f"""You are a Python/pandas data cleaning expert. Generate safe pandas code to apply a transformation to a survey dataset column.

## Dataset context
- Rows: {row_count}
- Column: {column_name or "entire dataset"}
- Data type: {data_type}
- Sample values: {sample_str}
- Value distribution:
{value_counts_str}
- Missing count: {missing_count} ({missing_pct:.1f}%)

## User instruction
{instruction}

## Requirements
1. Write a single Python expression or simple code block that transforms the pandas Series `series` (for column ops) or DataFrame `df` (for multi-column ops)
2. Assign result back: `series = <transform>` or `df = <transform>`
3. ONLY use: pandas, numpy (imported as pd, np) - no other imports
4. Do NOT modify the original df/series in place for read operations
5. Preserve all non-targeted rows unchanged
6. Handle NaN values gracefully
7. If instruction is ambiguous or unsafe, explain why and suggest a correction

Return JSON:
{{
  "code": "series = series.map({{'Very satisfied': 1, 'satisfied': 2, 'neutral': 3, 'dissatisfied': 4, 'Very dissatisfied': 5}})",
  "explanation": "Maps text labels to numeric scale 1-5",
  "affected_rows_estimate": {row_count},
  "is_column_op": true,
  "safe": true,
  "warning": null
}}

If unsafe: set safe=false, code=null, explanation=reason.
Return ONLY valid JSON."""

    return prompt


def _validate_code_safety(code: str) -> None:
    """Validate generated code for safety. Raises ValueError if unsafe."""
    # Parse AST
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f"Invalid Python syntax: {e}") from e

    # Block dangerous patterns
    dangerous_names = {
        "exec",
        "eval",
        "open",
        "__import__",
        "compile",
        "globals",
        "locals",
        "getattr",
        "setattr",
        "delattr",
        "input",
        "breakpoint",
        "exit",
        "quit",
        "os",
        "sys",
        "subprocess",
        "shutil",
        "pathlib",
        "importlib",
    }

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            # Check function calls
            if isinstance(node.func, ast.Name) and node.func.id in dangerous_names:
                raise ValueError(f"Unsafe operation: {node.func.id}")
            # Check attribute calls like os.system
            if isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name):
                    if node.func.value.id in dangerous_names:
                        raise ValueError(
                            f"Unsafe module access: {node.func.value.id}.{node.func.attr}"
                        )

        if isinstance(node, ast.Import):
            raise ValueError("Import statements not allowed in generated code")

        if isinstance(node, ast.ImportFrom):
            raise ValueError("Import statements not allowed in generated code")

        # Block attribute access to dunder methods
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                raise ValueError(f"Dunder method access not allowed: {node.attr}")


def run_sandboxed(
    code: str,
    df: pd.DataFrame,
    col_name: str | None,
) -> tuple[pd.DataFrame, list[dict[str, Any]], int]:
    """
    Run generated code safely on a DataFrame.

    Returns (modified_df, preview_rows, changed_count).
    """
    # Validate code safety first
    _validate_code_safety(code)

    # Execute with limited globals
    local_vars: dict[str, Any] = {
        "df": df.copy(),
        "pd": pd,
        "np": np,
    }
    if col_name and col_name in df.columns:
        local_vars["series"] = df[col_name].copy()

    # Execute with empty builtins for safety
    exec(code, {"__builtins__": {}}, local_vars)

    # Get result
    result_df = local_vars.get("df", df)
    if col_name and "series" in local_vars:
        result_df = df.copy()
        result_df[col_name] = local_vars["series"]

    # Build preview: find changed rows
    changed_mask = pd.Series(False, index=df.index)
    if col_name and col_name in df.columns and col_name in result_df.columns:
        # Compare string representations to catch all changes
        before_str = df[col_name].astype(str).fillna("__NAN__")
        after_str = result_df[col_name].astype(str).fillna("__NAN__")
        changed_mask = before_str != after_str

    preview: list[dict[str, Any]] = []
    for idx in df[changed_mask].head(10).index:
        before_val = str(df.loc[idx, col_name]) if col_name else "..."
        after_val = str(result_df.loc[idx, col_name]) if col_name else "..."
        preview.append({"row": int(idx), "before": before_val, "after": after_val})

    return result_df, preview, int(changed_mask.sum())
