"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useCleaningSuggestions } from "@/hooks/useCleaningSuggestions";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "@/lib/toast";
import type { Tables, Json } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Project = Tables<"projects">;
type Dataset = Tables<"datasets">;
type CleaningOperation = Tables<"cleaning_operations">;
type PipelineStatus = Record<string, string>;

export interface Step5CleaningProps {
  project: Project;
  dataset: Dataset | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const OP_TYPE_LABELS: Record<string, string> = {
  remove_duplicates: "Remove duplicate rows",
  impute_value: "Fill missing values",
  fix_encoding: "Standardise text values",
  standardize_missing: "Mark missing values consistently",
  fix_outlier: "Cap outlier values",
  recode_values: "Recode values",
  rename_column: "Rename column",
  fix_data_type: "Fix data type",
  fix_skip_logic: "Fix skip logic",
  drop_column: "Drop column",
  split_column: "Split column",
  merge_columns: "Merge columns",
  custom: "Custom operation",
};

function plainLanguage(op: CleaningOperation): string {
  const base = OP_TYPE_LABELS[op.operation_type];
  if (!base) return op.description;
  if (op.operation_type === "impute_value") {
    const params = op.parameters as Record<string, string> | null;
    if (params?.strategy) return `${base} with ${params.strategy}`;
  }
  return base;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Step5Cleaning({ project, dataset }: Step5CleaningProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const projectId = project.id;
  const datasetId = dataset?.id ?? null;

  const cleaning = useCleaningSuggestions(datasetId);

  /* ---------- Rollback task tracking ---------- */
  const [actioningOpId, setActioningOpId] = useState<string | null>(null);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const actionProgress = useTaskProgress(actionTaskId);
  const [isFinalizing, setIsFinalizing] = useState(false);

  useEffect(() => {
    if (
      actionProgress.status === "completed" ||
      actionProgress.status === "failed"
    ) {
      if (actionProgress.status === "completed") {
        toast("Operation rolled back", { variant: "success" });
      } else {
        toast("Rollback failed", { variant: "error" });
      }
      setActioningOpId(null);
      setActionTaskId(null);
    }
  }, [actionProgress.status]);

  /* ---------- Computed ---------- */
  const totalPending = useMemo(
    () => cleaning.all.filter((o) => o.status === "pending" || o.status === "approved").length,
    [cleaning.all],
  );

  /* ---------- Handlers ---------- */
  const handleRollback = useCallback(
    async (op: CleaningOperation) => {
      setActioningOpId(op.id);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from("cleaning_operations")
          .update({ status: "undone" })
          .eq("id", op.id);
        if (error) throw error;
        toast("Operation rolled back", { variant: "success" });
      } catch {
        toast("Failed to roll back", { variant: "error" });
      } finally {
        setActioningOpId(null);
      }
    },
    [supabase],
  );

  const handleFinalize = useCallback(async () => {
    setIsFinalizing(true);
    try {
      const newPipeline: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "5": "completed",
        "6": "active",
      };
      await supabase
        .from("projects")
        // @ts-ignore
        .update({
          current_step: 6,
          pipeline_status: newPipeline as unknown as Json,
        })
        .eq("id", projectId);
      toast("Data cleaning finalized! Moving to Analysis.", { variant: "success" });
      router.refresh();
      router.push(`/projects/${projectId}/step/6`);
    } catch {
      toast("Failed to finalize", { variant: "error" });
    } finally {
      setIsFinalizing(false);
    }
  }, [project.pipeline_status, supabase, projectId, router]);

  /* ================================================================ */
  /*  No dataset                                                       */
  /* ================================================================ */
  if (!dataset) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No dataset found. Please complete the upload step first.
        </CardContent>
      </Card>
    );
  }

  /* ================================================================ */
  /*  Still loading                                                    */
  /* ================================================================ */
  if (cleaning.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">Loading cleaning operations...</p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  Simplified: Changes Applied Summary                              */
  /* ================================================================ */

  // Applied operations for timeline view
  const appliedOps = cleaning.all.filter((o) => o.status === "applied");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Changes Applied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review the data transformations that have been applied to your dataset.
        </p>
      </div>

      {/* Action progress bar */}
      {actioningOpId && (
        <Card>
          <CardContent className="p-4 space-y-1">
            <Progress value={actionProgress.progress} className="h-2" />
            <p className="text-xs text-muted-foreground">Processing operation...</p>
          </CardContent>
        </Card>
      )}

      {/* Summary card */}
      <Card>
        <CardContent className="p-6">
          {appliedOps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <CheckCircle2 className="mb-4 h-12 w-12 text-green-500" />
              <p className="text-lg font-medium">No changes needed</p>
              <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">
                Your dataset passed quality checks without requiring any modifications.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-medium">{appliedOps.length} transformation{appliedOps.length !== 1 ? "s" : ""} applied</p>
                  <p className="text-sm text-muted-foreground">Your data has been cleaned and is ready for analysis</p>
                </div>
              </div>

              {/* Timeline of applied operations */}
              <div className="space-y-2 pt-4 border-t">
                {appliedOps.map((op, idx) => {
                  const opTypeIcon = op.operation_type === "remove_duplicates" ? "🗑" :
                    op.operation_type === "impute_value" ? "📊" :
                    op.operation_type === "fix_outlier" ? "📈" :
                    op.operation_type === "recode_values" ? "🔄" :
                    op.operation_type === "standardize_missing" ? "⚪" :
                    op.operation_type === "fix_data_type" ? "🔢" : "✨";

                  const afterStats = op.after_snapshot as Record<string, number> | null;
                  const beforeStats = op.before_snapshot as Record<string, number> | null;
                  const rowsAffected = beforeStats?.row_count && afterStats?.row_count
                    ? beforeStats.row_count - afterStats.row_count
                    : op.affected_rows_estimate;

                  return (
                    <div
                      key={op.id}
                      className="flex items-start gap-3 rounded-lg border p-3 bg-muted/30"
                    >
                      <span className="text-lg">{opTypeIcon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{op.description || plainLanguage(op)}</p>
                          {op.column_name && (
                            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                              {op.column_name}
                            </code>
                          )}
                        </div>
                        {rowsAffected != null && rowsAffected > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {rowsAffected.toLocaleString()} rows affected
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRollback(op)}
                        disabled={actioningOpId === op.id}
                      >
                        {actioningOpId === op.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1.5">Undo</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending operations notice (if any remain) */}
      {totalPending > 0 && (
        <Card className="border-yellow-200 dark:border-yellow-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="shrink-0">{totalPending} pending</Badge>
              <p className="text-sm text-muted-foreground">
                Some suggested fixes were not applied.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto shrink-0"
                onClick={() => router.push(`/projects/${projectId}/step/4`)}
              >
                Review in Quality
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Proceed to Analysis */}
      <div className="flex justify-end border-t pt-4">
        <Button onClick={handleFinalize} disabled={isFinalizing}>
          {isFinalizing ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Proceeding...</>
          ) : (
            <>Proceed to Analysis <ArrowRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </div>
    </div>
  );
}

