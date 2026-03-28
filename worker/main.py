"""
SurveyAI Analyst — Python Worker Service

Polls the tasks table for pending work, executes heavy computation
(EDA, cleaning, analysis, report generation), and updates results.

Uses service_role key to bypass RLS for full read/write access.
"""

import os
import time
import signal
import sys

import structlog
from dotenv import load_dotenv

from db import SupabaseDB
from services.instrument_service import parse_instrument
from services.column_role_service import detect_column_roles
from services.eda_service import run_eda
from services.consistency_service import run_consistency_checks
from services.bias_service import run_bias_detection
from services.eda_interpreter import interpret_quality_results
from services.cleaning_service import generate_cleaning_suggestions
from services.cleaning_executor import apply_cleaning_operation
from services.analysis_planner import generate_analysis_plan
from services.analysis_executor import run_analysis
from services.report_service import generate_report
from services.export_service import export_report

load_dotenv()

logger = structlog.get_logger()

# Graceful shutdown
shutdown_requested = False


def handle_signal(signum: int, _frame: object) -> None:
    global shutdown_requested
    logger.info("shutdown_requested", signal=signum)
    shutdown_requested = True


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

# Worker instance ID (unique per container)
WORKER_ID = os.getenv("WORKER_ID", f"worker-{os.getpid()}")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "2"))
# Tasks claimed but not completed after this many minutes are reset to pending
STALE_TASK_TIMEOUT_MINUTES = int(os.getenv("STALE_TASK_TIMEOUT_MINUTES", "10"))
# Max runtime for any single task (minutes) — task is failed if exceeded
MAX_TASK_RUNTIME_MINUTES = int(os.getenv("MAX_TASK_RUNTIME_MINUTES", "15"))


def recover_stale_tasks(db: SupabaseDB) -> None:
    """Reset tasks that were claimed but haven't progressed past 0% in N minutes."""
    try:
        stale = (
            db.client.table("tasks")
            .select("id, task_type, claimed_by, claimed_at")
            .eq("status", "claimed")
            .lt("progress", 5)
            .lt("claimed_at", f"now() - interval '{STALE_TASK_TIMEOUT_MINUTES} minutes'")
            .execute()
            .data or []
        )
        for task in stale:
            db.client.table("tasks").update({
                "status": "pending",
                "claimed_by": None,
                "claimed_at": None,
                "error": f"Stale: claimed by {task.get('claimed_by')} with no progress, reset after {STALE_TASK_TIMEOUT_MINUTES}m",
                "updated_at": "now()",
            }).eq("id", task["id"]).execute()
            logger.warning(
                "stale_task_reset",
                task_id=task["id"],
                task_type=task.get("task_type"),
                claimed_by=task.get("claimed_by"),
            )
    except Exception as e:
        logger.error("stale_recovery_failed", error=str(e))


def main() -> None:
    """Main polling loop for the worker service."""
    logger.info(
        "worker_starting",
        worker_id=WORKER_ID,
        poll_interval=POLL_INTERVAL,
        stale_timeout_min=STALE_TASK_TIMEOUT_MINUTES,
        max_runtime_min=MAX_TASK_RUNTIME_MINUTES,
    )

    db = SupabaseDB()
    poll_count = 0

    while not shutdown_requested:
        try:
            # Recover stale tasks every 30 polls (~60s at 2s interval)
            poll_count += 1
            if poll_count % 30 == 0:
                recover_stale_tasks(db)

            # Attempt to claim the next pending task
            task = db.claim_next_task(WORKER_ID)

            if task is None:
                # No tasks available, wait before polling again
                time.sleep(POLL_INTERVAL)
                continue

            task_id = task["task_id"]
            task_type = task["task_type"]
            payload = task["payload"]
            # Inject created_by into payload so services can use the actual user UUID
            # claim_next_task() returns created_by from the tasks table
            if "created_by" not in payload and task.get("created_by"):
                payload = {**payload, "created_by": str(task["created_by"])}

            logger.info(
                "task_claimed",
                task_id=task_id,
                task_type=task_type,
                worker_id=WORKER_ID,
            )

            # Dispatch to the appropriate handler with max runtime enforcement
            try:
                import threading
                db.update_task_progress(task_id, 0, f"Starting {task_type}")

                task_exception: list[Exception] = []

                def run_task() -> None:
                    try:
                        handle_task(db, task_id, task_type, payload)
                    except Exception as exc:
                        task_exception.append(exc)

                thread = threading.Thread(target=run_task, daemon=True)
                thread.start()
                thread.join(timeout=MAX_TASK_RUNTIME_MINUTES * 60)

                if thread.is_alive():
                    # Task exceeded max runtime
                    error_msg = f"Task exceeded maximum runtime of {MAX_TASK_RUNTIME_MINUTES} minutes"
                    logger.error("task_timeout", task_id=task_id, task_type=task_type)
                    db.fail_task(task_id, error_msg)
                elif task_exception:
                    raise task_exception[0]
                else:
                    logger.info("task_completed", task_id=task_id, task_type=task_type)

            except Exception as e:
                logger.error(
                    "task_failed",
                    task_id=task_id,
                    task_type=task_type,
                    error=str(e),
                )
                db.fail_task(task_id, str(e))

        except Exception as e:
            logger.error("poll_error", error=str(e))
            time.sleep(POLL_INTERVAL * 2)

    logger.info("worker_shutdown", worker_id=WORKER_ID)


def handle_task(db: SupabaseDB, task_id: str, task_type: str, payload: dict) -> None:
    """
    Dispatch a task to the appropriate handler.

    Each handler is responsible for:
    1. Updating progress via db.update_task_progress()
    2. Completing via db.complete_task() with results
    3. Raising exceptions on failure (caught by main loop)
    """
    if task_type == "parse_instrument":
        parse_instrument(db, task_id, payload)
        return

    if task_type == "detect_column_roles":
        detect_column_roles(db, task_id, payload)
        return

    if task_type == "run_eda":
        run_eda(db, task_id, payload)
        return

    if task_type == "run_consistency_checks":
        run_consistency_checks(db, task_id, payload)
        return

    if task_type == "run_bias_detection":
        run_bias_detection(db, task_id, payload)
        return

    if task_type == "interpret_results":
        _handle_interpret_results(db, task_id, payload)
        return

    if task_type == "generate_cleaning_suggestions":
        generate_cleaning_suggestions(db, task_id, payload)
        return

    if task_type == "apply_cleaning_operation":
        apply_cleaning_operation(db, task_id, payload)
        return

    if task_type == "generate_analysis_plan":
        generate_analysis_plan(db, task_id, payload)
        return

    if task_type == "run_analysis":
        run_analysis(db, task_id, payload)
        return

    if task_type == "generate_report":
        generate_report(db, task_id, payload)
        return

    if task_type == "export_report":
        export_report(db, task_id, payload)
        return

    # Future sprint handlers:
    # generate_report_section (per-section generation, if needed)
    # generate_chart (standalone chart generation)
    # export_audit_trail

    logger.warning("unhandled_task_type", task_type=task_type, task_id=task_id)
    db.complete_task(task_id, {"message": f"Task type '{task_type}' not yet implemented"})


def _handle_interpret_results(db: SupabaseDB, task_id: str, payload: dict) -> None:
    """
    Load all EDA results, bias flags, and consistency issues for a dataset,
    then call the AI interpreter. Store interpretation in eda_results.
    """
    import json

    dataset_id: str = payload["dataset_id"]
    project_id: str = payload["project_id"]

    db.update_task_progress(task_id, 10, "Loading EDA results...")

    # Load all results for this dataset
    all_results = db.select("eda_results", filters={"dataset_id": dataset_id})

    eda_results = [r for r in all_results if r.get("result_type") in ("column_profile", "dataset_summary")]
    bias_flags = [r for r in all_results if r.get("result_type") == "bias_check"]
    consistency_issues = [r for r in all_results if r.get("result_type") == "consistency_check"]

    # Load project context
    db.update_task_progress(task_id, 20, "Loading project context...")
    project = db.get_project(project_id)
    project_context = {
        "research_questions": project.get("research_questions") if project else None,
        "sampling_method": project.get("sampling_method") if project else None,
        "target_population": project.get("target_population") if project else None,
    }

    # Dataset metadata
    dataset = db.get_dataset(dataset_id)
    dataset_meta = {
        "row_count": dataset.get("row_count") if dataset else None,
        "column_count": dataset.get("column_count") if dataset else None,
        "file_name": dataset.get("name") if dataset else None,
    }

    db.update_task_progress(task_id, 30, "Calling AI interpreter...")

    interpretation = interpret_quality_results(
        eda_results=eda_results,
        bias_flags=bias_flags,
        consistency_issues=consistency_issues,
        project_context=project_context,
        dataset_meta=dataset_meta,
    )

    db.update_task_progress(task_id, 80, "Storing interpretation...")

    # Store interpretation as its own eda_results row
    db.insert("eda_results", {
        "dataset_id": dataset_id,
        "column_name": None,
        "result_type": "interpretation",
        "profile": None,
        "quality_score": interpretation.get("overall_quality_score"),
        "issues": [],
        "interpretation": json.loads(json.dumps(interpretation, default=str)),
    })

    db.complete_task(task_id, {
        "message": "AI interpretation complete",
        "overall_quality_score": interpretation.get("overall_quality_score"),
    })


if __name__ == "__main__":
    main()
