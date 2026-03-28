"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  LayoutList,
  ChevronsUpDown,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Tables, Json } from "@/lib/types/database";

type CleaningOperation = Tables<"cleaning_operations">;

interface CleaningSuggestionFlowProps {
  suggestions: CleaningOperation[];
  datasetId: string;
  projectId: string;
  onRefetch: () => void;
}

type ViewMode = "one-at-a-time" | "bulk";

// Category grouping for bulk mode
const CATEGORY_MAP: Record<string, string> = {
  remove_duplicates: "Duplicates",
  standardize_missing: "Missing Values",
  fix_outlier: "Outliers",
  recode_values: "Formatting",
  fix_data_type: "Type Issues",
  fix_encoding: "Encoding",
  fix_skip_logic: "Skip Logic",
  impute_value: "Missing Values",
  drop_column: "Column Operations",
  rename_column: "Column Operations",
  split_column: "Column Operations",
  merge_columns: "Column Operations",
  custom: "Other",
};

function getCategory(opType: string): string {
  return CATEGORY_MAP[opType] ?? "Other";
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.85) {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
        HIGH
      </Badge>
    );
  }
  if (confidence >= 0.5) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
        MED
      </Badge>
    );
  }
  return (
    <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
      LOW
    </Badge>
  );
}

export function CleaningSuggestionFlow({
  suggestions,
  datasetId,
  projectId,
  onRefetch,
}: CleaningSuggestionFlowProps) {
  const [mode, setMode] = useState<ViewMode>("one-at-a-time");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [applyingTaskId, setApplyingTaskId] = useState<string | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const { dispatchTask } = useDispatchTask();
  const applyProgress = useTaskProgress(applyingTaskId);

  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  const handleAccept = useCallback(
    async (operation: CleaningOperation) => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setProcessingIds((prev) => new Set(prev).add(operation.id));

      try {
        // Mark as approved
        await supabase
          .from("cleaning_operations")
          // @ts-expect-error — supabase update type inference
          .update({
            status: "approved" as const,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          })
          .eq("id", operation.id);

        // Dispatch apply task
        const { taskId } = await dispatchTask(
          projectId,
          "apply_cleaning_operation",
          {
            operation_id: operation.id,
            dataset_id: datasetId,
            approved_by: user.id,
          },
          datasetId,
        );

        setApplyingTaskId(taskId);
      } catch {
        // Error handled by dispatchTask
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(operation.id);
          return next;
        });
      }
    },
    [datasetId, projectId, dispatchTask],
  );

  const handleSkip = useCallback(
    async (operation: CleaningOperation) => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setProcessingIds((prev) => new Set(prev).add(operation.id));

      await supabase
        .from("cleaning_operations")
        // @ts-expect-error — supabase update type inference
        .update({
          status: "rejected" as const,
          rejected_by: user.id,
          rejected_at: new Date().toISOString(),
        })
        .eq("id", operation.id);

      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(operation.id);
        return next;
      });

      onRefetch();
    },
    [onRefetch],
  );

  const handleBulkAccept = useCallback(
    async (operations: CleaningOperation[]) => {
      for (const op of operations) {
        await handleAccept(op);
      }
      onRefetch();
    },
    [handleAccept, onRefetch],
  );

  const handleBulkSkip = useCallback(
    async (operations: CleaningOperation[]) => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      for (const op of operations) {
        await supabase
          .from("cleaning_operations")
          // @ts-expect-error — supabase update type inference
          .update({
            status: "rejected" as const,
            rejected_by: user.id,
            rejected_at: new Date().toISOString(),
          })
          .eq("id", op.id);
      }

      onRefetch();
    },
    [onRefetch],
  );

  // Refetch when apply task completes
  const prevApplyStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = applyProgress.status;
    if (
      (status === "completed" || status === "failed") &&
      prevApplyStatus.current !== status &&
      applyingTaskId
    ) {
      setApplyingTaskId(null);
      onRefetch();
    }
    prevApplyStatus.current = status;
  }, [applyProgress.status, applyingTaskId, onRefetch]);

  if (pendingSuggestions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="mb-4 h-12 w-12 text-green-500" />
          <p className="text-sm text-muted-foreground">
            All suggestions have been reviewed.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Apply progress overlay
  if (applyingTaskId && applyProgress.status !== "completed") {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin" />
            Applying cleaning operation...
          </div>
          <Progress value={applyProgress.progress} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {applyProgress.progressMessage ?? "Processing..."}
          </p>
          {applyProgress.error && (
            <p className="text-xs text-red-500">{applyProgress.error}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {pendingSuggestions.length} suggestion
          {pendingSuggestions.length !== 1 ? "s" : ""} to review
        </p>
        <div className="flex gap-1 rounded-lg border p-1">
          <Button
            variant={mode === "one-at-a-time" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("one-at-a-time")}
          >
            <ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />
            One at a time
          </Button>
          <Button
            variant={mode === "bulk" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("bulk")}
          >
            <LayoutList className="mr-1.5 h-3.5 w-3.5" />
            Bulk
          </Button>
        </div>
      </div>

      {mode === "one-at-a-time" ? (
        <OneAtATimeView
          suggestions={pendingSuggestions}
          currentIndex={currentIndex}
          setCurrentIndex={setCurrentIndex}
          onAccept={handleAccept}
          onSkip={handleSkip}
          processingIds={processingIds}
        />
      ) : (
        <BulkView
          suggestions={pendingSuggestions}
          onAccept={handleAccept}
          onSkip={handleSkip}
          onBulkAccept={handleBulkAccept}
          onBulkSkip={handleBulkSkip}
          processingIds={processingIds}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-at-a-time view
// ---------------------------------------------------------------------------

function OneAtATimeView({
  suggestions,
  currentIndex,
  setCurrentIndex,
  onAccept,
  onSkip,
  processingIds,
}: {
  suggestions: CleaningOperation[];
  currentIndex: number;
  setCurrentIndex: (i: number) => void;
  onAccept: (op: CleaningOperation) => void;
  onSkip: (op: CleaningOperation) => void;
  processingIds: Set<string>;
}) {
  const idx = Math.min(currentIndex, suggestions.length - 1);
  const suggestion = suggestions[idx];

  if (!suggestion) return null;

  const isProcessing = processingIds.has(suggestion.id);

  return (
    <div className="space-y-3">
      <SuggestionCard suggestion={suggestion} />

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentIndex(Math.max(0, idx - 1))}
          disabled={idx === 0}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>

        <span className="text-xs text-muted-foreground">
          {idx + 1} of {suggestions.length}
        </span>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSkip(suggestion)}
            disabled={isProcessing}
          >
            <X className="mr-1 h-4 w-4" />
            Skip
          </Button>
          <Button
            size="sm"
            onClick={() => onAccept(suggestion)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1 h-4 w-4" />
            )}
            Accept
          </Button>
        </div>
      </div>

      {/* Next button for navigation without action */}
      {idx < suggestions.length - 1 && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentIndex(idx + 1)}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk view — grouped by category
// ---------------------------------------------------------------------------

function BulkView({
  suggestions,
  onAccept,
  onSkip,
  onBulkAccept,
  onBulkSkip,
  processingIds,
}: {
  suggestions: CleaningOperation[];
  onAccept: (op: CleaningOperation) => void;
  onSkip: (op: CleaningOperation) => void;
  onBulkAccept: (ops: CleaningOperation[]) => void;
  onBulkSkip: (ops: CleaningOperation[]) => void;
  processingIds: Set<string>;
}) {
  // Group by category
  const groups: Record<string, CleaningOperation[]> = {};
  for (const sug of suggestions) {
    const cat = getCategory(sug.operation_type);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(sug);
  }

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([category, ops]) => (
        <div key={category}>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              {category}{" "}
              <span className="text-muted-foreground font-normal">
                ({ops.length})
              </span>
            </h4>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onBulkSkip(ops)}
              >
                Skip all
              </Button>
              <Button size="sm" onClick={() => onBulkAccept(ops)}>
                Accept all
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {ops.map((sug) => (
              <div key={sug.id} className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <SuggestionCard suggestion={sug} compact />
                </div>
                <div className="flex flex-col gap-1.5 pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => onSkip(sug)}
                    disabled={processingIds.has(sug.id)}
                    title="Skip"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => onAccept(sug)}
                    disabled={processingIds.has(sug.id)}
                    title="Accept"
                  >
                    {processingIds.has(sug.id) ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion card
// ---------------------------------------------------------------------------

function SuggestionCard({
  suggestion,
  compact = false,
}: {
  suggestion: CleaningOperation;
  compact?: boolean;
}) {
  const [showSample, setShowSample] = useState(false);
  const params = suggestion.parameters as Record<string, Json> | null;
  const preview = suggestion.impact_preview as Record<string, Json> | null;
  const impactOnAnalysis = params?.impact_on_analysis as string | undefined;

  return (
    <Card>
      <CardHeader className={compact ? "p-3 pb-1" : "pb-3"}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle
              className={compact ? "text-sm" : "text-base"}
            >
              <span className="capitalize">
                {suggestion.operation_type.replace(/_/g, " ")}
              </span>
              {suggestion.column_name && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {suggestion.column_name}
                </span>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {suggestion.description}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <ConfidenceBadge confidence={suggestion.confidence} />
            {suggestion.affected_rows_estimate != null && (
              <Badge variant="outline" className="text-xs">
                {suggestion.affected_rows_estimate.toLocaleString()} rows
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={compact ? "p-3 pt-0" : ""}>
        {/* AI Reasoning */}
        <p className="text-sm text-muted-foreground">{suggestion.reasoning}</p>

        {/* Impact on analysis */}
        {impactOnAnalysis && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-blue-600 dark:text-blue-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
            {impactOnAnalysis}
          </p>
        )}

        {/* Sample data toggle */}
        {preview && (
          <div className="mt-2">
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowSample(!showSample)}
            >
              {showSample ? "Hide" : "Show"} sample data
            </button>
            {showSample && (
              <div className="mt-2 rounded-lg border bg-muted/50 p-3">
                {Array.isArray(preview.sample_before) && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Before:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(preview.sample_before as Json[]).map((v, i) => (
                        <code
                          key={i}
                          className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300"
                        >
                          {String(v)}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(preview.sample_after) && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium">After:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(preview.sample_after as Json[]).map((v, i) => (
                        <code
                          key={i}
                          className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300"
                        >
                          {v === null ? "null" : String(v)}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
                {preview.action && (
                  <p className="mt-2 text-xs italic text-muted-foreground">
                    {String(preview.action)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
