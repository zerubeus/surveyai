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


def main() -> None:
    """Main polling loop for the worker service."""
    logger.info("worker_starting", worker_id=WORKER_ID, poll_interval=POLL_INTERVAL)

    db = SupabaseDB()

    while not shutdown_requested:
        try:
            # Attempt to claim the next pending task
            task = db.claim_next_task(WORKER_ID)

            if task is None:
                # No tasks available, wait before polling again
                time.sleep(POLL_INTERVAL)
                continue

            task_id = task["task_id"]
            task_type = task["task_type"]
            payload = task["payload"]

            logger.info(
                "task_claimed",
                task_id=task_id,
                task_type=task_type,
                worker_id=WORKER_ID,
            )

            # Dispatch to the appropriate handler
            # Handlers will be implemented in subsequent sprints
            try:
                db.update_task_progress(task_id, 0, f"Starting {task_type}")
                handle_task(db, task_id, task_type, payload)
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

    # Future sprint handlers:
    # Sprint 6: detect_column_roles
    # Sprint 7: run_eda, run_consistency_checks, run_bias_detection
    # Sprint 8: generate_cleaning_suggestions
    # Sprint 9: apply_cleaning_operation
    # Sprint 11-12: run_analysis
    # Sprint 13: interpret_results
    # Sprint 14: generate_report_section
    # Sprint 15: generate_chart
    # Sprint 16: export_report, export_audit_trail

    logger.warning("unhandled_task_type", task_type=task_type, task_id=task_id)
    db.complete_task(task_id, {"message": f"Task type '{task_type}' not yet implemented"})


if __name__ == "__main__":
    main()
