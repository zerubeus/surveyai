"""
Chisquare — Data Access Layer

All Supabase operations go through this module.
Uses service_role key (bypasses RLS) for worker operations.

No scattered Supabase client calls elsewhere in the worker.
"""

from __future__ import annotations

import os
from typing import Any

import structlog
from supabase import create_client, Client

logger = structlog.get_logger()


class SupabaseDB:
    """Centralized data access layer for the Python worker."""

    def __init__(self) -> None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.client: Client = create_client(url, key)
        logger.info("db_initialized", url=url)

    # ========================================================================
    # TASK QUEUE
    # ========================================================================

    def claim_next_task(
        self,
        worker_id: str,
        task_types: list[str] | None = None,
    ) -> dict[str, Any] | None:
        """
        Atomically claim the next pending task.

        Uses the claim_next_task() SQL function with SKIP LOCKED
        to prevent race conditions between multiple workers.

        Returns: Task dict with {task_id, task_type, project_id, payload}
                 or None if no tasks available.
        """
        result = self.client.rpc(
            "claim_next_task",
            {
                "p_worker_id": worker_id,
                "p_task_types": task_types,
            },
        ).execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        return None

    def update_task_progress(
        self,
        task_id: str,
        progress: int,
        message: str | None = None,
    ) -> None:
        """
        Update task progress (triggers Realtime for frontend).

        Args:
            task_id: UUID of the task
            progress: 0-100 percentage
            message: Optional progress message
        """
        self.client.rpc(
            "update_task_progress",
            {
                "p_task_id": task_id,
                "p_progress": progress,
                "p_message": message,
            },
        ).execute()

    def complete_task(self, task_id: str, result: dict[str, Any] | None = None) -> None:
        """Mark a task as completed with optional result data."""
        self.client.rpc(
            "complete_task",
            {
                "p_task_id": task_id,
                "p_result": result,
            },
        ).execute()

    def fail_task(self, task_id: str, error: str) -> None:
        """Mark a task as failed with error message."""
        self.client.rpc(
            "fail_task",
            {
                "p_task_id": task_id,
                "p_error": error,
            },
        ).execute()

    # ========================================================================
    # GENERIC TABLE OPERATIONS
    # ========================================================================

    def select(
        self,
        table: str,
        columns: str = "*",
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Select rows from a table.

        Args:
            table: Table name
            columns: Column selection (default "*")
            filters: Dict of {column: value} equality filters
        """
        query = self.client.table(table).select(columns)
        if filters:
            for col, val in filters.items():
                query = query.eq(col, val)
        result = query.execute()
        return result.data

    def insert(self, table: str, data: dict[str, Any]) -> dict[str, Any]:
        """Insert a row and return the inserted data."""
        result = self.client.table(table).insert(data).execute()
        return result.data[0]

    def update(
        self,
        table: str,
        data: dict[str, Any],
        filters: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Update rows matching filters and return updated data."""
        query = self.client.table(table).update(data)
        for col, val in filters.items():
            query = query.eq(col, val)
        result = query.execute()
        return result.data

    def delete(self, table: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        """Delete rows matching filters and return deleted data."""
        query = self.client.table(table).delete()
        for col, val in filters.items():
            query = query.eq(col, val)
        result = query.execute()
        return result.data

    # ========================================================================
    # STORAGE OPERATIONS
    # ========================================================================

    def upload_file(
        self,
        bucket: str,
        path: str,
        file_data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """
        Upload a file to Supabase Storage.

        Args:
            bucket: Bucket name (uploads, datasets, reports, charts)
            path: File path within bucket (e.g., "{user_id}/{project_id}/file.csv")
            file_data: File content as bytes
            content_type: MIME type

        Returns: The storage path
        """
        self.client.storage.from_(bucket).upload(
            path=path,
            file=file_data,
            file_options={"content-type": content_type},
        )
        return path

    # ========================================================================
    # CONVENIENCE ACCESSORS
    # ========================================================================

    def get_dataset(self, dataset_id: str) -> dict[str, Any] | None:
        """Fetch a single dataset row by ID."""
        rows = self.select("datasets", filters={"id": dataset_id})
        return rows[0] if rows else None

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        """Fetch a single project row by ID."""
        rows = self.select("projects", filters={"id": project_id})
        return rows[0] if rows else None

    def insert_task(
        self,
        project_id: str,
        task_type: str,
        payload: dict[str, Any] | None = None,
        dataset_id: str | None = None,
        created_by: str = "worker",
    ) -> str:
        """
        Insert a new task into the queue.

        Returns: The new task's UUID.
        """
        data: dict[str, Any] = {
            "project_id": project_id,
            "task_type": task_type,
            "payload": payload or {},
            "created_by": created_by,
        }
        if dataset_id is not None:
            data["payload"] = {**(payload or {}), "dataset_id": dataset_id}
        row = self.insert("tasks", data)
        task_id: str = row["id"]
        logger.info("task_inserted", task_id=task_id, task_type=task_type)
        return task_id

    def download_file(self, bucket: str, path: str) -> bytes:
        """Download a file from Supabase Storage."""
        return self.client.storage.from_(bucket).download(path)

    def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        """
        Get a signed URL for a file (expires after expires_in seconds).

        Args:
            bucket: Bucket name
            path: File path within bucket
            expires_in: URL expiry in seconds (default 1 hour)
        """
        result = self.client.storage.from_(bucket).create_signed_url(path, expires_in)
        return result["signedURL"]
