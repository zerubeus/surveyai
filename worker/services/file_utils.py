"""
Chisquare — Shared File Parsing Utilities

Robust CSV/Excel reading with automatic delimiter detection, encoding fallback,
multi-level header flattening, and column name cleaning.

Used by: column_role_service, eda_service, bias_service, cleaning_executor, analysis_executor
"""

from __future__ import annotations

import csv as csv_module
import io
import re
from typing import Any

import pandas as pd

# Encodings to try in order (most common to least common)
ENCODINGS_TO_TRY = ["utf-8", "utf-8-sig", "latin-1", "cp1252", "iso-8859-1"]


def _safe_str(val: Any) -> str:
    """Safely convert any value to string, handling slices, NaN, and edge cases."""
    if isinstance(val, slice):
        return ""
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except (TypeError, ValueError):
        pass
    try:
        return str(val).strip()
    except Exception:
        return ""


def _flatten_multiindex_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten multi-level column headers into single-level strings."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [
            " ".join(_safe_str(part) for part in col).strip()
            for col in df.columns
        ]
    else:
        df.columns = [
            f"Column_{i}" if isinstance(col, slice) else _safe_str(col)
            for i, col in enumerate(df.columns)
        ]
    return df


def _clean_column_names(columns: list[Any]) -> list[str]:
    """Clean column names: strip, remove special chars, deduplicate."""
    seen: dict[str, int] = {}
    result: list[str] = []

    for i, col in enumerate(columns):
        if isinstance(col, slice):
            clean = f"Column_{i}"
        elif isinstance(col, tuple):
            clean = " ".join(_safe_str(part) for part in col).strip()
        else:
            clean = _safe_str(col)

        # Remove non-printable characters
        clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', clean)
        # Replace newlines with space
        clean = re.sub(r'[\r\n]+', ' ', clean)
        # Collapse multiple spaces
        clean = re.sub(r'\s+', ' ', clean).strip()
        # Truncate to 100 chars
        clean = clean[:100]

        if not clean:
            clean = f"unnamed_column_{i}"

        # Deduplicate
        if clean in seen:
            seen[clean] += 1
            clean = f"{clean}_{seen[clean]}"
        else:
            seen[clean] = 1

        result.append(clean)

    return result


def _detect_header_row(file_bytes: bytes) -> int:
    """Detect actual header row in Excel files (skip metadata rows)."""
    try:
        df_test = pd.read_excel(io.BytesIO(file_bytes), header=None, nrows=10)
        row_fill_counts = df_test.notna().sum(axis=1)

        if len(row_fill_counts) < 3:
            return 0

        row0_count = row_fill_counts.iloc[0]
        later_avg = row_fill_counts.iloc[2:6].mean() if len(row_fill_counts) > 2 else row0_count

        if row0_count < later_avg * 0.5:
            for i in range(len(row_fill_counts)):
                if row_fill_counts.iloc[i] >= later_avg * 0.7:
                    return i
        return 0
    except Exception:
        return 0


def _read_excel_robust(file_bytes: bytes, file_type: str, nrows: int | None = None) -> pd.DataFrame:
    """Read Excel with robust header detection and multi-level column handling."""
    header_row = _detect_header_row(file_bytes)

    try:
        engine = "openpyxl" if file_type in ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") else None
        df = pd.read_excel(
            io.BytesIO(file_bytes),
            header=header_row,
            nrows=nrows,
            engine=engine,
        )
    except Exception:
        # Fallback without engine
        df = pd.read_excel(io.BytesIO(file_bytes), header=header_row, nrows=nrows)

    df = _flatten_multiindex_columns(df)
    df.columns = _clean_column_names(list(df.columns))
    return df


def _read_csv_robust(file_bytes: bytes, nrows: int | None = None) -> pd.DataFrame:
    """Read CSV with robust encoding and delimiter detection."""
    # Try to detect delimiter using sniffer
    detected_sep = None
    try:
        sample = file_bytes[:4096].decode("utf-8", errors="replace")
        dialect = csv_module.Sniffer().sniff(sample, delimiters=",;\t|")
        detected_sep = dialect.delimiter
    except Exception:
        pass

    # Try with detected separator first, then fallbacks
    separators_to_try = [detected_sep] if detected_sep else []
    separators_to_try.extend([",", ";", "\t", "|"])

    last_error: Exception | None = None

    # Try each encoding/separator combination
    for encoding in ENCODINGS_TO_TRY:
        for sep in separators_to_try:
            if sep is None:
                continue
            try:
                df = pd.read_csv(
                    io.BytesIO(file_bytes),
                    sep=sep,
                    encoding=encoding,
                    nrows=nrows,
                    on_bad_lines="skip",
                )
                # Accept if we got more than 1 column
                if len(df.columns) > 1:
                    df = _flatten_multiindex_columns(df)
                    df.columns = _clean_column_names(list(df.columns))
                    return df
            except UnicodeDecodeError:
                continue
            except pd.errors.ParserError as e:
                last_error = e
                continue
            except Exception as e:
                last_error = e
                continue

    # Try pandas auto-detection with python engine
    for encoding in ENCODINGS_TO_TRY:
        try:
            df = pd.read_csv(
                io.BytesIO(file_bytes),
                sep=None,
                engine="python",
                encoding=encoding,
                nrows=nrows,
                on_bad_lines="skip",
            )
            df = _flatten_multiindex_columns(df)
            df.columns = _clean_column_names(list(df.columns))
            return df
        except Exception as e:
            last_error = e
            continue

    # Last resort: latin-1 never fails on encoding
    try:
        df = pd.read_csv(
            io.BytesIO(file_bytes),
            encoding="latin-1",
            nrows=nrows,
            on_bad_lines="skip",
        )
        df = _flatten_multiindex_columns(df)
        df.columns = _clean_column_names(list(df.columns))
        return df
    except Exception as e:
        raise pd.errors.ParserError(f"Could not parse CSV: {last_error or e}") from e


def read_dataframe_from_bytes(
    file_bytes: bytes,
    file_type: str,
    nrows: int | None = None,
) -> pd.DataFrame:
    """
    Read uploaded file into a DataFrame with robust handling.

    - Detects Excel by short file_type (xlsx, xls) AND MIME types
    - For CSV: auto-detects delimiter and encoding
    - Returns cleaned column names

    Args:
        file_bytes: Raw file bytes
        file_type: File type or MIME type (e.g., "csv", "xlsx", "application/vnd.ms-excel")
        nrows: Optional limit on number of rows to read

    Returns:
        pd.DataFrame with cleaned column names
    """
    file_type_lower = file_type.lower() if file_type else ""

    # Check if Excel file (short types AND MIME types)
    is_excel = file_type_lower in (
        "xlsx", "xls", "excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/excel",
    )

    if is_excel:
        return _read_excel_robust(file_bytes, file_type_lower, nrows)

    # Default: CSV with robust parsing
    return _read_csv_robust(file_bytes, nrows)
