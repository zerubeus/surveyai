"""
Chisquare Worker — Health Endpoint

Runs a lightweight HTTP server alongside the main worker loop.
Reports task queue state + worker uptime for monitoring tools.
"""

import os
import json
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any

import structlog

logger = structlog.get_logger()

_start_time = time.time()
_task_counts: dict[str, int] = {}
_last_task_at: float | None = None


def update_stats(task_type: str, status: str) -> None:
    """Called by the worker main loop to keep stats fresh."""
    global _last_task_at
    key = f"{task_type}:{status}"
    _task_counts[key] = _task_counts.get(key, 0) + 1
    _last_task_at = time.time()


class HealthHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass  # suppress access logs

    def do_GET(self) -> None:
        if self.path not in ("/health", "/health/"):
            self.send_response(404)
            self.end_headers()
            return

        uptime_s = int(time.time() - _start_time)
        payload = {
            "status": "ok",
            "uptime_seconds": uptime_s,
            "worker_id": os.getenv("WORKER_ID", f"worker-{os.getpid()}"),
            "task_counts": _task_counts,
            "last_task_seconds_ago": int(time.time() - _last_task_at) if _last_task_at else None,
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())


def start_health_server(port: int = 8765) -> None:
    """Start the health HTTP server in a background daemon thread."""
    try:
        server = HTTPServer(("0.0.0.0", port), HealthHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        logger.info("health_server_started", port=port)
    except OSError as e:
        logger.warning("health_server_failed", error=str(e), port=port)
