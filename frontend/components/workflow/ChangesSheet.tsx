"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/types/database";

type CleaningOperation = Tables<"cleaning_operations">;
type Dataset = Tables<"datasets">;

interface ChangesSheetProps {
  dataset: Dataset;
  appliedOps: CleaningOperation[];
  isOpen: boolean;
  onClose: () => void;
  onUndoOp?: (opId: string) => void;
}

interface AfterSnapshot {
  changed_row_indices?: number[];
  changed_column?: string | null;
  row_count?: number;
  null_count?: number;
}

const ROWS_PER_PAGE = 50;

/**
 * Slide-over side sheet showing data diff after cleaning fixes
 */
export function ChangesSheet({
  dataset,
  appliedOps,
  isOpen,
  onClose,
  onUndoOp,
}: ChangesSheetProps) {
  const supabase = createBrowserClient();

  // CSV data state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(0);
  const [undoingOpId, setUndoingOpId] = useState<string | null>(null);

  // Build set of changed cells: "rowIndex-columnName"
  const changedCells = useMemo(() => {
    const cells = new Set<string>();
    for (const op of appliedOps) {
      const snapshot = op.after_snapshot as AfterSnapshot | null;
      if (!snapshot) continue;
      const indices = snapshot.changed_row_indices ?? [];
      const col = snapshot.changed_column;
      if (col) {
        for (const idx of indices) {
          cells.add(`${idx}-${col}`);
        }
      }
    }
    return cells;
  }, [appliedOps]);

  // Get list of changed columns
  const changedColumns = useMemo(() => {
    const cols = new Set<string>();
    for (const op of appliedOps) {
      const snapshot = op.after_snapshot as AfterSnapshot | null;
      const col = snapshot?.changed_column;
      if (col) cols.add(col);
    }
    return Array.from(cols);
  }, [appliedOps]);

  // Get all changed row indices
  const changedRowIndices = useMemo(() => {
    const indices = new Set<number>();
    for (const op of appliedOps) {
      const snapshot = op.after_snapshot as AfterSnapshot | null;
      const idxs = snapshot?.changed_row_indices ?? [];
      for (const idx of idxs) {
        indices.add(idx);
      }
    }
    return indices;
  }, [appliedOps]);

  // Filter data based on view settings
  const filteredData = useMemo(() => {
    let data = csvData;

    // Filter to only changed rows if enabled
    if (showOnlyChanged) {
      data = data.filter((_, idx) => changedRowIndices.has(idx));
    }

    return data;
  }, [csvData, showOnlyChanged, changedRowIndices]);

  // Pagination
  const totalPages = Math.ceil(filteredData.length / ROWS_PER_PAGE);
  const paginatedData = useMemo(() => {
    const start = currentPage * ROWS_PER_PAGE;
    return filteredData.slice(start, start + ROWS_PER_PAGE);
  }, [filteredData, currentPage]);

  // Columns to display (filtered or all)
  const displayColumns = useMemo(() => {
    if (selectedColumn && selectedColumn !== "all") {
      const idx = csvHeaders.indexOf(selectedColumn);
      return idx >= 0 ? [{ name: selectedColumn, index: idx }] : [];
    }
    return csvHeaders.map((name, index) => ({ name, index }));
  }, [csvHeaders, selectedColumn]);

  // Fetch CSV data when sheet opens
  useEffect(() => {
    if (!isOpen || !dataset) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Determine which file to fetch
        const filePath = dataset.working_file_path || dataset.original_file_path;
        const bucket = dataset.working_file_path ? "datasets" : "uploads";

        if (!filePath) {
          throw new Error("No file path available");
        }

        // Get signed URL
        const { data: signedUrlData, error: signedUrlError } =
          await supabase.storage.from(bucket).createSignedUrl(filePath, 300);

        if (signedUrlError || !signedUrlData?.signedUrl) {
          throw new Error(signedUrlError?.message ?? "Failed to get signed URL");
        }

        // Fetch CSV text
        const response = await fetch(signedUrlData.signedUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        const text = await response.text();

        // Parse CSV (simple split - handles most cases)
        const lines = text.split("\n").filter((line) => line.trim());
        if (lines.length === 0) {
          throw new Error("Empty file");
        }

        // Parse header
        const headers = parseCSVLine(lines[0]);
        setCsvHeaders(headers);

        // Parse data rows
        const rows = lines.slice(1).map((line) => parseCSVLine(line));
        setCsvData(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, dataset, supabase]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(0);
  }, [showOnlyChanged, selectedColumn]);

  // Handle keyboard escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Get operation type for a cell
  const getOperationType = useCallback(
    (rowIndex: number, colName: string): string | null => {
      for (const op of appliedOps) {
        const snapshot = op.after_snapshot as AfterSnapshot | null;
        if (!snapshot) continue;
        if (snapshot.changed_column !== colName) continue;
        if (snapshot.changed_row_indices?.includes(rowIndex)) {
          return op.operation_type;
        }
      }
      return null;
    },
    [appliedOps],
  );

  // Get rows affected per op
  const getRowsAffected = useCallback((op: CleaningOperation): number => {
    if (op.affected_rows_estimate != null) {
      return op.affected_rows_estimate;
    }
    const snapshot = op.after_snapshot as AfterSnapshot | null;
    return snapshot?.changed_row_indices?.length ?? 0;
  }, []);

  // Handle undo operation
  const handleUndo = useCallback(
    async (opId: string) => {
      if (onUndoOp) {
        setUndoingOpId(opId);
        await onUndoOp(opId);
        setUndoingOpId(null);
      }
    },
    [onUndoOp],
  );

  if (!isOpen) return null;

  const totalChangedRows = changedRowIndices.size;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Sheet — centered, inset from edges, full height with margin */}
      <div
        className={cn(
          "fixed inset-y-4 right-4 left-4 md:left-auto md:right-6 md:w-[88vw] md:max-w-[1300px]",
          "bg-background z-50 shadow-2xl rounded-xl border",
          "transform transition-transform duration-300 ease-out",
          "flex flex-col",
          isOpen ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Applied Changes Preview</h2>
            <p className="text-sm text-muted-foreground">
              {changedCells.size} cell{changedCells.size !== 1 ? "s" : ""} modified
              across {changedColumns.length} column{changedColumns.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Body: sidebar + main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar - Applied changes */}
          <div className="w-72 border-r bg-muted/30 flex flex-col">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Applied Changes
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {appliedOps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No changes applied yet
                </p>
              ) : (
                appliedOps.map((op) => {
                  const snapshot = op.after_snapshot as AfterSnapshot | null;
                  const colName = snapshot?.changed_column ?? op.column_name;
                  const rowsAffected = getRowsAffected(op);

                  return (
                    <div
                      key={op.id}
                      className="rounded-lg border bg-background p-3 space-y-2"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-green-600 dark:text-green-400 mt-0.5">✓</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight">
                            {formatOpType(op.operation_type)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {colName && (
                              <code className="font-mono">{colName}</code>
                            )}
                            {colName && rowsAffected > 0 && " · "}
                            {rowsAffected > 0 && `${rowsAffected} rows`}
                          </p>
                        </div>
                      </div>
                      {onUndoOp && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-full h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleUndo(op.id)}
                          disabled={undoingOpId === op.id}
                        >
                          {undoingOpId === op.id ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RotateCcw className="h-3 w-3 mr-1" />
                          )}
                          Undo
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Main content area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              {/* Left: Row filter toggle */}
              <div className="inline-flex rounded-lg border p-0.5 bg-muted/50">
                <button
                  className={cn(
                    "px-3 py-1 text-sm rounded-md transition-colors",
                    !showOnlyChanged
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setShowOnlyChanged(false)}
                >
                  All rows
                </button>
                <button
                  className={cn(
                    "px-3 py-1 text-sm rounded-md transition-colors",
                    showOnlyChanged
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setShowOnlyChanged(true)}
                >
                  Changed rows only
                </button>
              </div>

              {/* Right: Column focus dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Focus column</span>
                <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                  <SelectTrigger className="w-48 h-8 text-sm">
                    <SelectValue placeholder="All columns" />
                  </SelectTrigger>
                  <SelectContent className="w-48 max-h-64 overflow-y-auto">
                    <SelectItem value="all" className="text-sm">All columns</SelectItem>
                    {changedColumns.map((col) => (
                      <SelectItem key={col} value={col} className="text-sm">
                        <span className="flex items-center gap-2">
                          <span className="text-amber-500">●</span>
                          {col}
                        </span>
                      </SelectItem>
                    ))}
                    {csvHeaders
                      .filter((h) => !changedColumns.includes(h))
                      .map((col) => (
                        <SelectItem key={col} value={col} className="text-sm">
                          <span className="text-muted-foreground">{col}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row count + Pagination above table */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <span className="text-sm text-muted-foreground">
                Showing {filteredData.length} rows · {totalChangedRows} changed
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">
                    {currentPage + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-64 text-red-500">
                  {error}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground w-16">
                          Row
                        </th>
                        {displayColumns.map((col) => (
                          <th
                            key={col.name}
                            className={cn(
                              "px-3 py-1.5 text-left font-medium",
                              changedColumns.includes(col.name)
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              {changedColumns.includes(col.name) && (
                                <span className="text-amber-500 text-xs">●</span>
                              )}
                              {col.name}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedData.map((row, displayIdx) => {
                        // Calculate actual row index
                        const actualIdx = showOnlyChanged
                          ? Array.from(changedRowIndices).sort((a, b) => a - b)[
                              currentPage * ROWS_PER_PAGE + displayIdx
                            ]
                          : currentPage * ROWS_PER_PAGE + displayIdx;

                        const isChangedRow = changedRowIndices.has(actualIdx);

                        return (
                          <tr
                            key={displayIdx}
                            className={cn(
                              "border-b",
                              isChangedRow && "bg-amber-50/50 dark:bg-amber-950/20",
                            )}
                          >
                            <td className="px-3 py-1.5 text-muted-foreground font-mono text-xs">
                              {actualIdx + 1}
                            </td>
                            {displayColumns.map((col) => {
                              const cellKey = `${actualIdx}-${col.name}`;
                              const isChanged = changedCells.has(cellKey);
                              const value = row[col.index] ?? "";

                              return (
                                <td
                                  key={col.name}
                                  className={cn(
                                    "px-3 py-1.5",
                                    isChanged &&
                                      "bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "truncate max-w-[200px] block",
                                      isChanged && "font-medium",
                                    )}
                                    title={value}
                                  >
                                    {value || (
                                      <span className="text-muted-foreground italic">
                                        empty
                                      </span>
                                    )}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filteredData.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      No data to display
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Simple CSV line parser that handles quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Format operation type for display
 */
function formatOpType(opType: string): string {
  const labels: Record<string, string> = {
    remove_duplicates: "Removed duplicates",
    impute_value: "Imputed missing values",
    fix_encoding: "Standardized text",
    standardize_missing: "Standardized missing",
    fix_outlier: "Capped outliers",
    recode_values: "Recoded values",
    rename_column: "Renamed column",
    fix_data_type: "Fixed data type",
    fix_skip_logic: "Fixed skip logic",
    drop_column: "Dropped column",
    split_column: "Split column",
    merge_columns: "Merged columns",
    custom: "Custom operation",
  };
  return labels[opType] ?? opType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
