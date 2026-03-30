"""
Chisquare — Python Worker Service

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
from services.export_service import export_report, export_zip
from services.cross_analysis_service import generate_cross_analysis
from services.analyze_uploads_service import analyze_uploads
from services.notification_service import send_analysis_complete_email
from health import start_health_server, update_stats as _update_stats

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


def enforce_data_retention(db: SupabaseDB) -> None:
    """
    Delete data for deactivated/deleted accounts per privacy policy.
    Runs once per day — removes projects/datasets created_by users
    who haven't signed in for 90+ days AND have no active sessions.
    """
    try:
        # Find users inactive for 90+ days (check via Supabase auth admin)
        # For now: delete orphaned storage files for projects with no auth user
        # This is a best-effort cleanup — full implementation requires pg_cron + auth.users access
        logger.info("data_retention_check_skipped", reason="requires auth.users admin access — configure pg_cron for full enforcement")
    except Exception as e:
        logger.error("data_retention_failed", error=str(e))


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

    # Start health endpoint on port 8765 (configurable)
    health_port = int(os.getenv("HEALTH_PORT", "8765"))
    start_health_server(health_port)

    db = SupabaseDB()
    poll_count = 0

    while not shutdown_requested:
        try:
            # Recover stale tasks every 30 polls (~60s at 2s interval)
            poll_count += 1
            if poll_count % 30 == 0:
                recover_stale_tasks(db)
            # Run data retention check once per day (~43,200 polls at 2s interval)
            if poll_count % 43200 == 0:
                enforce_data_retention(db)

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
            # Inject project_id from the tasks table row if not already in payload
            # This makes all handlers resilient to missing project_id in payload
            if "project_id" not in payload and task.get("project_id"):
                payload = {**payload, "project_id": str(task["project_id"])}

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
                    _update_stats(task_type, "timeout")
                elif task_exception:
                    _update_stats(task_type, "failed")
                    raise task_exception[0]
                else:
                    logger.info("task_completed", task_id=task_id, task_type=task_type)
                    _update_stats(task_type, "completed")

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
        # After all 3 quality tasks complete, update KB (best-effort)
        try:
            p_id = payload.get("project_id", "")
            ds_id = payload.get("dataset_id", "")
            if p_id and ds_id:
                kb = build_quality_kb_summary(db, ds_id)
                update_project_knowledge_base(db, p_id, kb)
        except Exception as kb_err:
            logger.warning("kb_quality_update_failed", error=str(kb_err))
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
        # Update cleaning KB after each operation
        try:
            p_id = payload.get("project_id", "")
            ds_id = payload.get("dataset_id", "")
            if p_id and ds_id:
                kb = build_cleaning_kb_summary(db, ds_id)
                update_project_knowledge_base(db, p_id, kb)
        except Exception as kb_err:
            logger.warning("kb_cleaning_update_failed", error=str(kb_err))
        return

    if task_type == "generate_analysis_plan":
        generate_analysis_plan(db, task_id, payload)
        return

    if task_type == "run_analysis":
        run_analysis(db, task_id, payload)
        # Email notification (best-effort — fails silently if SMTP not configured)
        project_id = payload.get("project_id", "")
        created_by = payload.get("created_by")
        send_analysis_complete_email(db, project_id, task_type, None)
        db.audit("analysis_run", "project", project_id, project_id, created_by,
                 {"task_id": task_id, "dataset_id": payload.get("dataset_id")})
        return

    if task_type == "generate_report":
        generate_report(db, task_id, payload)
        send_analysis_complete_email(db, payload.get("project_id", ""), task_type, None)
        return

    if task_type == "export_report":
        export_report(db, task_id, payload)
        p_id = payload.get("project_id", "")
        c_by = payload.get("created_by")
        send_analysis_complete_email(db, p_id, task_type, None)
        db.audit("report_export", "report", payload.get("report_id"), p_id, c_by,
                 {"format": payload.get("format"), "task_id": task_id})
        return

    if task_type == "generate_cross_analysis":
        generate_cross_analysis(db, task_id, payload)
        return

    if task_type == "analyze_uploads":
        analyze_uploads(db, task_id, payload)
        return

    if task_type == "export_zip":
        export_zip(db, task_id, payload)
        return

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


# ============================================================================
# KNOWLEDGE BASE UTILITIES
# ============================================================================

def update_project_knowledge_base(db: SupabaseDB, project_id: str, new_data: dict) -> None:
    """Merge new_data into projects.additional_context.knowledge_base."""
    import json as _json
    project = db.get_project(project_id)
    if not project:
        return
    existing_raw = project.get("additional_context") or "{}"
    try:
        existing = _json.loads(existing_raw) if isinstance(existing_raw, str) else (existing_raw or {})
    except Exception:
        existing = {}
    kb = existing.get("knowledge_base") or {}
    kb.update(new_data)
    existing["knowledge_base"] = kb
    db.update("projects", {"additional_context": _json.dumps(existing)}, {"id": project_id})


def build_quality_kb_summary(db: SupabaseDB, dataset_id: str) -> dict:
    """Build a quality summary for the knowledge base."""
    eda_rows = db.select("eda_results", filters={"dataset_id": dataset_id})
    profiles = [r for r in eda_rows if r.get("result_type") == "column_profile"]
    consistency = [r for r in eda_rows if r.get("result_type") == "consistency_check"]
    bias = [r for r in eda_rows if r.get("result_type") == "bias_check"]

    total_issues = sum(len(r.get("issues") or []) for r in profiles)
    quality_scores = [r["quality_score"] for r in profiles if r.get("quality_score") is not None]
    avg_quality = round(sum(quality_scores) / len(quality_scores), 1) if quality_scores else None

    missing_cols = []
    outlier_cols = []
    for r in profiles:
        profile = r.get("profile") or {}
        if isinstance(profile, str):
            import json as _j
            try:
                profile = _j.loads(profile)
            except Exception:
                profile = {}
        mp = profile.get("missing_pct", 0)
        oc = profile.get("outlier_count", 0)
        if mp and mp > 5:
            missing_cols.append({"column": r.get("column_name"), "missing_pct": mp})
        if oc and oc > 0:
            outlier_cols.append({"column": r.get("column_name"), "outlier_count": oc})

    consistency_issues = []
    for r in consistency:
        for issue in (r.get("issues") or []):
            if isinstance(issue, dict):
                consistency_issues.append({
                    "type": issue.get("check_type"),
                    "severity": issue.get("severity"),
                    "description": issue.get("description"),
                })

    return {
        "quality": {
            "avg_quality_score": avg_quality,
            "total_column_issues": total_issues,
            "missing_data_columns": missing_cols[:5],
            "outlier_columns": outlier_cols[:5],
            "consistency_issues": consistency_issues[:10],
            "bias_flags_count": len(bias),
        }
    }


def build_cleaning_kb_summary(db: SupabaseDB, dataset_id: str) -> dict:
    """Build a cleaning summary for the knowledge base."""
    ops = db.select("cleaning_operations", filters={"dataset_id": dataset_id})
    applied = [o for o in ops if o.get("status") == "applied"]
    skipped = [o for o in ops if o.get("status") == "rejected"]

    return {
        "cleaning": {
            "operations_applied": len(applied),
            "operations_skipped": len(skipped),
            "applied_operations": [
                {
                    "type": o.get("operation_type"),
                    "column": o.get("column_name"),
                    "description": o.get("description"),
                }
                for o in applied[:10]
            ],
        }
    }
