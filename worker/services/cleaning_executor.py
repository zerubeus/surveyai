"""
Chisquare — Cleaning Operation Executor

Applies a single approved cleaning operation to a dataset,
creating a new versioned copy.

Invariants:
- D1: Original file NEVER modified
- D2: Every transformation has audit record
- D3: Dataset versions are a linked list via parent_id
- A1: AI never auto-applies (approved_by required)
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import structlog

from db import SupabaseDB
from services.file_utils import read_dataframe_from_bytes

logger = structlog.get_logger()


def apply_cleaning_operation(
    db: SupabaseDB, task_id: str, payload: dict[str, Any]
) -> None:
    """
    Apply a single approved cleaning operation.

    Payload: {"operation_id": str, "dataset_id": str, "approved_by": str}
    """
    operation_id: str = payload["operation_id"]
    dataset_id: str = payload["dataset_id"]
    approved_by: str = payload["approved_by"]

    logger.info(
        "cleaning_apply_start",
        operation_id=operation_id,
        dataset_id=dataset_id,
    )

    # Step 1: Fetch and validate operation
    db.update_task_progress(task_id, 5, "Validating operation...")
    ops = db.select("cleaning_operations", filters={"id": operation_id})
    if not ops:
        raise ValueError(f"Cleaning operation {operation_id} not found")
    operation = ops[0]

    if operation["status"] != "approved":
        raise ValueError(
            f"Operation {operation_id} has status '{operation['status']}', "
            f"expected 'approved'"
        )
    if not operation.get("approved_by"):
        raise ValueError(
            f"Operation {operation_id} has no approved_by (invariant A1)"
        )

    # Step 2: Find the current dataset version
    db.update_task_progress(task_id, 10, "Loading current dataset...")
    dataset = db.get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    # Find the is_current=True version for this project
    project_datasets = db.select(
        "datasets",
        filters={
            "project_id": dataset["project_id"],
            "is_current": True,
        },
    )
    current_dataset = project_datasets[0] if project_datasets else dataset

    # Step 3: Download current file
    db.update_task_progress(task_id, 20, "Downloading dataset file...")
    file_path = (
        current_dataset.get("working_file_path")
        or current_dataset["original_file_path"]
    )
    bucket = "datasets" if current_dataset.get("working_file_path") else "uploads"
    file_bytes = db.download_file(bucket, file_path)

    file_type: str = current_dataset["file_type"]
    df = read_dataframe_from_bytes(file_bytes, file_type)

    before_stats: dict[str, Any] = {
        "row_count": len(df),
        "null_count": int(df.isnull().sum().sum()),
    }

    # Step 4: Apply transformation
    db.update_task_progress(task_id, 40, "Applying transformation...")
    op_type: str = operation["operation_type"]
    col_name: str | None = operation.get("column_name")
    params: dict[str, Any] = operation.get("parameters") or {}

    # Capture original values for changed row tracking
    df_before = df.copy()

    df = _apply_transform(df, op_type, col_name, params)

    # Find changed row indices (for column-level operations)
    changed_indices: list[int] = []
    if col_name and col_name in df_before.columns and col_name in df.columns:
        # Compare string representations to catch all changes
        before_vals = df_before[col_name].astype(str).fillna("__NULL__")
        after_vals = df[col_name].astype(str).fillna("__NULL__")
        changed_mask = before_vals != after_vals
        changed_indices = changed_mask[changed_mask].index.tolist()[:500]  # cap at 500

    after_stats: dict[str, Any] = {
        "row_count": len(df),
        "null_count": int(df.isnull().sum().sum()),
        "changed_row_indices": changed_indices,
        "changed_column": col_name,
    }

    # Step 5: Upload new file
    db.update_task_progress(task_id, 60, "Uploading cleaned dataset...")
    new_version = current_dataset.get("version", 0) + 1

    original_name: str = current_dataset["name"]
    base_name = (
        original_name.rsplit(".", 1)[0] if "." in original_name else original_name
    )
    new_filename = f"{base_name}_cleaned_v{new_version}.csv"

    uploaded_by: str = current_dataset["uploaded_by"]
    project_id: str = current_dataset["project_id"]
    new_storage_path = f"{uploaded_by}/{project_id}/{new_filename}"

    csv_buffer = io.BytesIO()
    df.to_csv(csv_buffer, index=False)
    csv_bytes = csv_buffer.getvalue()

    db.upload_file("datasets", new_storage_path, csv_bytes, "text/csv")

    # Step 6: Create new dataset version via SQL function
    db.update_task_progress(task_id, 75, "Creating dataset version...")
    try:
        result = db.client.rpc(
            "create_dataset_version",
            {
                "p_parent_id": current_dataset["id"],
                "p_working_file_path": new_storage_path,
            },
        ).execute()
    except Exception as e:
        logger.error("create_dataset_version_rpc_failed", error=str(e), parent_id=current_dataset["id"])
        raise RuntimeError(f"Failed to create dataset version: {e}") from e

    new_dataset_id: str | None = result.data
    if isinstance(new_dataset_id, list):
        new_dataset_id = new_dataset_id[0] if new_dataset_id else None

    # Update new dataset metadata
    if new_dataset_id:
        db.update(
            "datasets",
            {
                "name": current_dataset["name"],
                "row_count": len(df),
                "column_count": len(df.columns),
                "file_size_bytes": len(csv_bytes),
                "file_type": "text/csv",
                "status": "cleaning",
            },
            {"id": new_dataset_id},
        )

        # Copy column_mappings from parent dataset to new dataset version
        try:
            parent_mappings = db.select("column_mappings", filters={"dataset_id": current_dataset["id"]})
            if parent_mappings:
                for mapping in parent_mappings:
                    new_mapping = {k: v for k, v in mapping.items() if k not in ("id", "created_at", "updated_at")}
                    new_mapping["dataset_id"] = new_dataset_id
                    db.client.table("column_mappings").insert(new_mapping).execute()
                logger.info("column_mappings_copied", count=len(parent_mappings), new_dataset_id=new_dataset_id)
        except Exception as e:
            logger.warning("column_mappings_copy_failed", error=str(e))

    # Step 7: Update operation
    db.update_task_progress(task_id, 85, "Recording results...")
    now = datetime.now(timezone.utc).isoformat()
    db.update(
        "cleaning_operations",
        {
            "status": "applied",
            "applied_at": now,
            "before_snapshot": json.loads(
                json.dumps(before_stats, default=_json_safe)
            ),
            "after_snapshot": json.loads(
                json.dumps(after_stats, default=_json_safe)
            ),
            "resulting_dataset_id": new_dataset_id,
        },
        {"id": operation_id},
    )

    # Step 8: Audit log
    db.insert(
        "audit_log",
        {
            "project_id": project_id,
            "user_id": approved_by,
            "action": "cleaning_operation_applied",
            "entity_type": "cleaning_operations",
            "entity_id": operation_id,
            "details": {
                "operation_type": op_type,
                "column_name": col_name,
                "before_stats": before_stats,
                "after_stats": after_stats,
                "new_dataset_id": new_dataset_id,
                "new_version": new_version,
            },
        },
    )

    db.complete_task(
        task_id,
        {
            "message": f"Applied {op_type} operation",
            "operation_id": operation_id,
            "new_dataset_id": new_dataset_id,
            "before_stats": before_stats,
            "after_stats": after_stats,
        },
    )
    logger.info(
        "cleaning_apply_complete",
        operation_id=operation_id,
        new_dataset_id=new_dataset_id,
    )


def _apply_transform(
    df: pd.DataFrame,
    op_type: str,
    col_name: str | None,
    params: dict[str, Any],
) -> pd.DataFrame:
    """Apply a cleaning transformation. Returns new DataFrame."""
    df = df.copy()

    if op_type == "remove_duplicates":
        keep = params.get("keep", "first")
        df = df.drop_duplicates(keep=keep)

    elif op_type == "standardize_missing":
        if col_name and col_name in df.columns:
            missing_codes = params.get("missing_codes", [])
            str_col = df[col_name].astype(str).str.strip()
            for code in missing_codes:
                mask = str_col == str(code)
                df.loc[mask, col_name] = np.nan

    elif op_type == "fix_outlier":
        if col_name and col_name in df.columns:
            method = params.get("method", "iqr_cap")
            if method == "iqr_cap":
                lower = params.get("lower_bound")
                upper = params.get("upper_bound")
                if lower is not None and upper is not None:
                    numeric = pd.to_numeric(df[col_name], errors="coerce")
                    df[col_name] = numeric.clip(lower=lower, upper=upper)

    elif op_type == "recode_values":
        if col_name and col_name in df.columns:
            method = params.get("method", "title_case")
            if method == "title_case":
                mask = df[col_name].notna()
                df.loc[mask, col_name] = (
                    df.loc[mask, col_name].astype(str).str.strip().str.title()
                )
            elif method == "set_null_out_of_range":
                valid_values = params.get("valid_values", [])
                if valid_values:
                    numeric = pd.to_numeric(df[col_name], errors="coerce")
                    invalid_mask = df[col_name].notna() & ~numeric.isin(
                        valid_values
                    )
                    df.loc[invalid_mask, col_name] = np.nan

    elif op_type == "fix_data_type":
        if col_name and col_name in df.columns:
            target_type = params.get("target_type", "numeric")
            if target_type == "numeric":
                df[col_name] = pd.to_numeric(df[col_name], errors="coerce")

    elif op_type in ("fix_encoding", "fix_skip_logic"):
        pass  # future implementation

    else:
        logger.warning("unknown_operation_type", op_type=op_type)

    return df


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
