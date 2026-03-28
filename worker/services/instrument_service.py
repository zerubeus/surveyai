"""
Chisquare — Instrument Parsing Service

Orchestrates instrument file parsing:
1. Downloads file from Supabase Storage
2. Routes to appropriate parser (XLSForm or PDF/DOCX)
3. Stores parsed structure in the instruments table
4. Updates task progress throughout
"""

from __future__ import annotations

import dataclasses
import json
from typing import Any

import structlog

from db import SupabaseDB
from parsers.xlsform_parser import ParsedInstrument, parse_xlsform
from parsers.pdf_questionnaire_parser import parse_document

logger = structlog.get_logger()

# MIME types that route to XLSForm parser
XLSFORM_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
}

# MIME types that route to document (AI) parser
DOCUMENT_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}


def _instrument_to_json(instrument: ParsedInstrument) -> dict[str, Any]:
    """Convert ParsedInstrument dataclass to a JSON-serializable dict."""
    return dataclasses.asdict(instrument)


def parse_instrument(db: SupabaseDB, task_id: str, payload: dict[str, Any]) -> None:
    """
    Parse an uploaded instrument file and store structured data.

    Payload: {"instrument_id": str, "storage_path": str, "mime_type": str}

    Steps:
    1. Update instrument status to 'parsing'
    2. Download file from Storage
    3. Route to appropriate parser
    4. Store parsed_structure as JSONB
    5. Update instrument status to 'parsed'
    """
    instrument_id: str = payload["instrument_id"]
    storage_path: str = payload["storage_path"]
    mime_type: str = payload["mime_type"]

    logger.info(
        "parse_instrument_start",
        instrument_id=instrument_id,
        storage_path=storage_path,
        mime_type=mime_type,
    )

    # Step 1: Mark instrument as parsing
    db.update_task_progress(task_id, 5, "Preparing to parse instrument")
    db.update("instruments", {"parse_status": "parsing"}, {"id": instrument_id})

    # Step 2: Download file from Storage
    db.update_task_progress(task_id, 10, "Downloading file")
    try:
        file_bytes = db.download_file("uploads", storage_path)
    except Exception as e:
        db.update("instruments", {
            "parse_status": "failed",
            "parse_errors": [{"error": f"Failed to download file: {e}"}],
        }, {"id": instrument_id})
        raise ValueError(f"Failed to download instrument file: {e}") from e

    db.update_task_progress(task_id, 20, "File downloaded, starting parse")

    # Step 3: Route to parser
    try:
        if mime_type in XLSFORM_MIMES:
            db.update_task_progress(task_id, 30, "Parsing XLSForm structure")
            parsed = parse_xlsform(file_bytes)
        elif mime_type in DOCUMENT_MIMES:
            db.update_task_progress(task_id, 30, "Extracting text from document")
            parsed = parse_document(file_bytes, mime_type)
        else:
            raise ValueError(f"Unsupported MIME type: {mime_type}")
    except Exception as e:
        db.update("instruments", {
            "parse_status": "failed",
            "parse_errors": [{"error": str(e)}],
        }, {"id": instrument_id})
        raise

    db.update_task_progress(task_id, 80, "Storing parsed results")

    # Step 4: Build structured data for DB storage
    parsed_dict = _instrument_to_json(parsed)

    # Separate questions, choices, skip_logic, and settings for dedicated columns
    # IMPORTANT: Pass Python dicts/lists directly — do NOT use json.dumps() for JSONB columns.
    # supabase-py serializes Python objects to JSON internally. Wrapping in json.dumps()
    # produces a double-encoded string stored as a JSON string scalar, not an object.
    questions_list: list[dict[str, Any]] = parsed_dict["questions"]
    choice_lists: dict[str, list[dict[str, Any]]] = {}
    for q in parsed.questions:
        if q.choices:
            parts = q.type.split(None, 1)
            list_name = parts[1] if len(parts) > 1 else q.name
            if list_name not in choice_lists:
                choice_lists[list_name] = [dataclasses.asdict(c) if dataclasses.is_dataclass(c) else c for c in q.choices]

    skip_logic_entries = [
        {"name": q.name, "relevant": q.relevant}
        for q in parsed.questions
        if q.relevant
    ]

    settings_data = {
        "title": parsed.title,
        "form_id": parsed.form_id,
        "version": parsed.version,
        "default_language": parsed.default_language,
        "languages": parsed.languages,
    }

    # Step 5: Update instrument record with native Python objects (not JSON strings)
    db.update("instruments", {
        "parsed_structure": parsed_dict,
        "questions": questions_list,
        "skip_logic": skip_logic_entries,
        "choice_lists": choice_lists,
        "settings": settings_data,
        "parse_status": "parsed",
        "parse_errors": [],
    }, {"id": instrument_id})

    # Complete the task with summary
    question_count = len([q for q in parsed.questions if q.question_type not in ("group", "repeat", "metadata")])
    result = {
        "message": "Instrument parsed successfully",
        "question_count": question_count,
        "total_items": len(parsed.questions),
        "skip_logic_count": parsed.skip_logic_count,
        "has_skip_logic": parsed.has_skip_logic,
        "languages": parsed.languages,
        "title": parsed.title,
    }

    db.complete_task(task_id, result)

    logger.info(
        "parse_instrument_complete",
        instrument_id=instrument_id,
        question_count=question_count,
        skip_logic_count=parsed.skip_logic_count,
    )
