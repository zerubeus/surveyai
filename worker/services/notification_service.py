"""
Chisquare Worker — Notification Service

Sends email notifications after task completion using Supabase's admin email API
or direct SMTP. Falls back silently if misconfigured.
"""

import os
import smtplib
import json
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import structlog

logger = structlog.get_logger()


def _get_smtp_config() -> dict[str, Any] | None:
    """Read SMTP config from environment. Returns None if not configured."""
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    if not (host and user and password):
        return None
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "password": password,
        "from_email": os.getenv("SMTP_FROM", user),
        "from_name": os.getenv("SMTP_FROM_NAME", "Chisquare"),
    }


def send_analysis_complete_email(
    db: Any,
    project_id: str,
    task_type: str,
    result: dict[str, Any] | None,
) -> None:
    """Send an analysis-complete notification to the project owner."""
    try:
        cfg = _get_smtp_config()
        if not cfg:
            # No SMTP configured — skip silently
            return

        # Load project + creator email
        project = db.get_project(project_id)
        if not project:
            return
        created_by = project.get("created_by")
        if not created_by:
            return

        # Get user email from auth.users via service role
        try:
            user_data = db.client.auth.admin.get_user_by_id(created_by)
            email = getattr(user_data.user, "email", None) if user_data and user_data.user else None
        except Exception as e:
            logger.warning("get_user_email_failed", error=str(e), user_id=created_by)
            return
        if not email:
            return

        project_name = project.get("name", "Your project")

        # Build subject and body per task type
        if task_type == "run_analysis":
            sig_count = result.get("significant_count", "?") if result else "?"
            total_count = result.get("total_tests", "?") if result else "?"
            subject = f"✅ Analysis complete — {project_name}"
            body_html = f"""
<h2>Your analysis is ready</h2>
<p><strong>{project_name}</strong></p>
<p>{sig_count} of {total_count} tests returned significant results (p &lt; 0.05).</p>
<p><a href="{os.getenv('APP_URL', 'http://localhost:3000')}/projects/{project_id}/step/6">View results →</a></p>
<hr>
<p style="color:#888;font-size:12px">Chisquare · <a href="{os.getenv('APP_URL','')}/privacy">Privacy policy</a></p>
"""
        elif task_type == "generate_report":
            subject = f"📄 Report ready — {project_name}"
            body_html = f"""
<h2>Your report has been generated</h2>
<p><strong>{project_name}</strong></p>
<p>Your AI-drafted report is ready for review and export.</p>
<p><a href="{os.getenv('APP_URL', 'http://localhost:3000')}/projects/{project_id}/step/7">View report →</a></p>
<hr>
<p style="color:#888;font-size:12px">Chisquare</p>
"""
        elif task_type == "export_report":
            subject = f"⬇️ Export ready — {project_name}"
            body_html = f"""
<h2>Your export is ready</h2>
<p><strong>{project_name}</strong></p>
<p>Your report export is ready to download. The link expires in 7 days.</p>
<p><a href="{os.getenv('APP_URL', 'http://localhost:3000')}/projects/{project_id}/step/7">Download →</a></p>
<hr>
<p style="color:#888;font-size:12px">Chisquare</p>
"""
        else:
            return  # Don't email for EDA/cleaning tasks

        # Send via SMTP
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
        msg["To"] = email
        msg.attach(MIMEText(body_html, "html"))

        with smtplib.SMTP(cfg["host"], cfg["port"]) as server:
            server.starttls()
            server.login(cfg["user"], cfg["password"])
            server.sendmail(cfg["from_email"], email, msg.as_string())

        logger.info("notification_sent", task_type=task_type, project_id=project_id)

    except Exception as e:
        # Never let notification failure crash the worker
        logger.warning("notification_failed", error=str(e), task_type=task_type)
