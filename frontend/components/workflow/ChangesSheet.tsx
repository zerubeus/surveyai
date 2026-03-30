"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tables, Json } from "@/lib/types/database";

type CleaningOperation = Tables<"cleaning_operations">;
type Dataset = Tables<"datasets">;

interface ChangesSheetProps {
  dataset: Dataset;
  appliedOps: CleaningOperation[];
  isOpen: boolean;
  onClose: () => void;
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
}: ChangesSheetProps) {
  const supabase = createBrowserClient();

  // CSV data state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

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

  // Total changed cells count
  const totalChangedCells = changedCells.size;

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
    if (selectedColumn) {
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

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={cn(
          "fixed right-0 top-0 h-full w-[85%] max-w-[1400px] bg-background z-50 shadow-2xl",
          "transform transition-transform duration-300 ease-out",
          "flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Applied Changes Preview</h2>
            <p className="text-sm text-muted-foreground">
              {totalChangedCells} cell{totalChangedCells !== 1 ? "s" : ""} modified
              across {changedColumns.length} column{changedColumns.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-4 border-b px-6 py-3 flex-wrap">
          {/* Row filter toggle */}
          <Button
            variant={showOnlyChanged ? "default" : "outline"}
            size="sm"
            onClick={() => setShowOnlyChanged(!showOnlyChanged)}
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            {showOnlyChanged ? "Showing changed rows" : "Show all rows"}
          </Button>

          {/* Column filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Column:</span>
            <Button
              variant={selectedColumn === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedColumn(null)}
            >
              All
            </Button>
            {changedColumns.slice(0, 5).map((col) => (
              <Button
                key={col}
                variant={selectedColumn === col ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedColumn(col)}
              >
                {col}
              </Button>
            ))}
            {changedColumns.length > 5 && (
              <span className="text-xs text-muted-foreground">
                +{changedColumns.length - 5} more
              </span>
            )}
          </div>
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
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">
                      Row
                    </th>
                    {displayColumns.map((col) => (
                      <th
                        key={col.name}
                        className={cn(
                          "px-3 py-2 text-left font-medium",
                          changedColumns.includes(col.name)
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {col.name}
                        {changedColumns.includes(col.name) && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                          >
                            modified
                          </Badge>
                        )}
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
                        <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                          {actualIdx + 1}
                        </td>
                        {displayColumns.map((col) => {
                          const cellKey = `${actualIdx}-${col.name}`;
                          const isChanged = changedCells.has(cellKey);
                          const opType = isChanged
                            ? getOperationType(actualIdx, col.name)
                            : null;
                          const value = row[col.index] ?? "";

                          return (
                            <td
                              key={col.name}
                              className={cn(
                                "px-3 py-2",
                                isChanged &&
                                  "bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded",
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "truncate max-w-[200px]",
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
                                {opType && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1 py-0 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 shrink-0"
                                  >
                                    {formatOpType(opType)}
                                  </Badge>
                                )}
                              </div>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-6 py-3">
            <span className="text-sm text-muted-foreground">
              Showing {currentPage * ROWS_PER_PAGE + 1}-
              {Math.min((currentPage + 1) * ROWS_PER_PAGE, filteredData.length)} of{" "}
              {filteredData.length} rows
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                Page {currentPage + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
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
  return opType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^Fix /, "")
    .replace(/^Standardize /, "Std ");
}
