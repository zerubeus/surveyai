"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useCleaningSuggestions } from "@/hooks/useCleaningSuggestions";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  Minus,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import type { Tables, Json, Enums } from "@/lib/types/database";

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
  split_column: "Split column",
  merge_columns: "Merge columns",
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

function matchesResearchQuestion(
  columnName: string | null,
  researchQuestions: Json,
): string | null {
  if (!columnName) return null;
  const rqs = Array.isArray(researchQuestions)
    ? (researchQuestions as Array<{ text?: string } | string>)
    : [];
  const colLower = columnName.toLowerCase();
  for (const rq of rqs) {
    const text = typeof rq === "string" ? rq : rq?.text ?? "";
    if (text.toLowerCase().includes(colLower)) {
      return text.length > 80 ? text.slice(0, 80) + "\u2026" : text;
    }
  }
  return null;
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
  const { dispatchTask } = useDispatchTask();

  /* ---------- Apply / rollback task tracking ---------- */
  const [actioningOpId, setActioningOpId] = useState<string | null>(null);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const actionProgress = useTaskProgress(actionTaskId);

  /* ---------- Review state ---------- */
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFinalizing, setIsFinalizing] = useState(false);

  /* ---------- Reset action tracking on complete ---------- */
  useEffect(() => {
    if (
      actionProgress.status === "completed" ||
      actionProgress.status === "failed"
    ) {
      if (actionProgress.status === "completed") {
        toast("Operation completed", { variant: "success" });
      } else {
        toast("Operation failed", { variant: "error" });
      }
      setActioningOpId(null);
      setActionTaskId(null);
    }
  }, [actionProgress.status]);

  /* ---------- Keyboard navigation ---------- */
  useEffect(() => {
    if (cleaning.all.length === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "ArrowRight") {
        setCurrentIndex((i) => Math.min(i + 1, cleaning.all.length - 1));
      } else if (e.key === "ArrowLeft") {
        setCurrentIndex((i) => Math.max(i - 1, 0));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cleaning.all.length]);

  /* ---------- Computed ---------- */
  const pendingOps = useMemo(
    () => cleaning.all.filter((op) => op.status === "pending" || op.status === "approved"),
    [cleaning.all],
  );

  const appliedOps = useMemo(
    () => cleaning.all.filter((op) => op.status === "applied"),
    [cleaning.all],
  );

  /* ---------- Handlers ---------- */
  const handleApply = useCallback(
    async (op: CleaningOperation) => {
      if (!datasetId) return;
      setActioningOpId(op.id);
      try {
        await supabase
          .from("cleaning_operations")
          // @ts-ignore
          .update({ status: "approved" as Enums<"cleaning_op_status"> })
          .eq("id", op.id);
        const { taskId } = await dispatchTask(
          projectId,
          "apply_cleaning_operation",
          { operation_id: op.id, dataset_id: datasetId },
          datasetId,
        );
        setActionTaskId(taskId);
        // advance to next pending op
        setCurrentIndex((i) => Math.min(i + 1, cleaning.all.length - 1));
      } catch {
        toast("Failed to apply operation", { variant: "error" });
        setActioningOpId(null);
      }
    },
    [projectId, datasetId, dispatchTask, supabase, cleaning.all.length],
  );

  const handleSkip = useCallback(
    async (op: CleaningOperation) => {
      await supabase
        .from("cleaning_operations")
        // @ts-ignore
        .update({ status: "rejected" as Enums<"cleaning_op_status"> })
        .eq("id", op.id);
      setCurrentIndex((i) => Math.min(i + 1, cleaning.all.length - 1));
    },
    [supabase, cleaning.all.length],
  );

  const handleRollback = useCallback(
    async (op: CleaningOperation) => {
      setActioningOpId(op.id);
      try {
        await supabase
          .from("cleaning_operations")
          // @ts-ignore
          .update({ status: "undone" as Enums<"cleaning_op_status"> })
          .eq("id", op.id);
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
          <p className="mt-1 text-sm text-muted-foreground">Loading cleaning operations…</p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <span className="text-sm text-muted-foreground">Loading…</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  No operations yet                                               */
  /* ================================================================ */
  if (cleaning.all.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            No cleaning operations found. Go back to the Quality step to review issues and apply fixes.
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="mb-2 text-sm font-medium">No cleaning operations</p>
            <p className="mb-6 text-sm text-muted-foreground text-center max-w-sm">
              Cleaning suggestions are generated during the Quality Assessment step. 
              Go back to review quality issues and apply fixes there.
            </p>
            <Button variant="outline" onClick={() => router.push(`/projects/${projectId}/step/4`)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Quality Assessment
            </Button>
          </CardContent>
        </Card>
        <div className="flex justify-end border-t pt-4">
          <Button onClick={handleFinalize} disabled={isFinalizing}>
            {isFinalizing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Finalizing…</>
            ) : (
              <>Continue to Analysis <ArrowRight className="ml-2 h-4 w-4" /></>
            )}
          </Button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Main: guided review + applied ops                               */
  /* ================================================================ */
  const total = cleaning.all.length;
  const safeIndex = Math.min(currentIndex, total - 1);
  const currentOp = cleaning.all[safeIndex];
  const progressPct = total > 0 ? ((safeIndex + 1) / total) * 100 : 0;

  const rqMatch = currentOp
    ? matchesResearchQuestion(currentOp.column_name, project.research_questions)
    : null;

  const beforeData = currentOp?.before_snapshot as Record<string, Json>[] | null;
  const afterData = currentOp?.after_snapshot as Record<string, Json>[] | null;
  const hasSample = beforeData && Array.isArray(beforeData) && beforeData.length > 0;

  const isCurrentActioning = currentOp ? actioningOpId === currentOp.id : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review each cleaning operation. Applied operations can be rolled back.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {appliedOps.length > 0 && (
            <Badge className="bg-green-600">{appliedOps.length} applied</Badge>
          )}
          {pendingOps.length > 0 && (
            <Badge variant="outline">{pendingOps.length} pending</Badge>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* ======================================================== */}
        {/*  Main card (left)                                         */}
        {/* ======================================================== */}
        <div className="flex-1 min-w-0">
          {currentOp ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Operation {safeIndex + 1} of {total}</span>
                  <StatusBadge status={currentOp.status} />
                </div>
                <Progress value={progressPct} className="h-1.5 mt-2" />
              </CardHeader>

              <CardContent className="space-y-5">
                {/* Title + column */}
                <div>
                  <CardTitle className="text-base">{plainLanguage(currentOp)}</CardTitle>
                  {currentOp.column_name && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Affected column:{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                        {currentOp.column_name}
                      </code>
                    </p>
                  )}
                </div>

                {/* Why this matters */}
                <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">Why this matters</p>
                  {rqMatch ? (
                    <p className="text-sm">
                      This column appears in your research question:{" "}
                      <span className="italic">&ldquo;{rqMatch}&rdquo;</span>
                    </p>
                  ) : (
                    <p className="text-sm">{currentOp.reasoning || currentOp.description}</p>
                  )}
                </div>

                {/* Description */}
                {currentOp.description && (
                  <p className="text-sm text-muted-foreground">{currentOp.description}</p>
                )}

                {/* Before → After preview */}
                {hasSample && (
                  <BeforeAfterPreview before={beforeData} after={afterData} />
                )}

                {/* Apply progress */}
                {isCurrentActioning && (
                  <div className="space-y-1">
                    <Progress value={actionProgress.progress} className="h-2" />
                    <p className="text-xs text-muted-foreground">Processing…</p>
                  </div>
                )}

                {/* Keyboard hint */}
                <p className="text-xs text-muted-foreground text-center">
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">&larr;</kbd>{" "}
                  Previous &middot;{" "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">&rarr;</kbd>{" "}
                  Next
                </p>

                {/* Action buttons */}
                <div className="flex items-center justify-between border-t pt-4">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
                      disabled={safeIndex === 0}
                    >
                      <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentIndex((i) => Math.min(i + 1, total - 1))}
                      disabled={safeIndex >= total - 1}
                    >
                      Next
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    {currentOp.status === "applied" ? (
                      /* Applied op → rollback button */
                      <Button
                        variant="outline"
                        onClick={() => handleRollback(currentOp)}
                        disabled={isCurrentActioning}
                        className="text-destructive hover:text-destructive"
                      >
                        {isCurrentActioning ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Roll back
                      </Button>
                    ) : currentOp.status === "pending" || currentOp.status === "approved" ? (
                      /* Pending op → skip / apply */
                      <>
                        <Button
                          variant="outline"
                          onClick={() => handleSkip(currentOp)}
                          disabled={isCurrentActioning}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Skip
                        </Button>
                        <Button
                          onClick={() => handleApply(currentOp)}
                          disabled={isCurrentActioning}
                        >
                          {isCurrentActioning ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Apply
                        </Button>
                      </>
                    ) : (
                      /* Rejected / undone — info only */
                      <Badge variant="outline" className="text-muted-foreground">
                        {currentOp.status === "rejected" ? "Skipped" : "Rolled back"}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-green-200 dark:border-green-900 bg-green-50/50">
              <CardContent className="flex flex-col items-center py-8">
                <CheckCircle2 className="mb-3 h-8 w-8 text-green-500" />
                <p className="font-medium">All operations reviewed!</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {appliedOps.length} applied · {cleaning.rejected.length} skipped
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ======================================================== */}
        {/*  Sidebar (right)                                          */}
        {/* ======================================================== */}
        <div className="w-full lg:w-64 flex-shrink-0">
          <Card className="sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All operations</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[60vh] overflow-y-auto p-0">
              <div className="space-y-0.5 px-3 pb-3">
                {cleaning.all.map((op, idx) => {
                  const isCurrent = idx === safeIndex;
                  return (
                    <button
                      key={op.id}
                      onClick={() => setCurrentIndex(idx)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        isCurrent
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <SidebarStatusIcon status={op.status} isCurrent={isCurrent} />
                      <span className="truncate">{op.description || plainLanguage(op)}</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Applied ops summary */}
      {appliedOps.length > 0 && (
        <Card className="border-green-200 dark:border-green-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-green-700 dark:text-green-400">
              Applied operations ({appliedOps.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {appliedOps.map((op) => (
              <div
                key={op.id}
                className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  <span className="truncate">{op.description || plainLanguage(op)}</span>
                  {op.column_name && (
                    <code className="text-xs text-muted-foreground font-mono">{op.column_name}</code>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={() => handleRollback(op)}
                  disabled={actioningOpId === op.id}
                >
                  {actioningOpId === op.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Finalize */}
      <div className="flex justify-end border-t pt-4">
        <Button onClick={handleFinalize} disabled={isFinalizing}>
          {isFinalizing ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Finalizing…</>
          ) : (
            <>Finalize &amp; Continue to Analysis <ArrowRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function StatusBadge({ status }: { status: string }) {
  if (status === "applied")
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">applied</Badge>;
  if (status === "rejected")
    return <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 text-xs">skipped</Badge>;
  if (status === "undone")
    return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs">rolled back</Badge>;
  return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs">pending</Badge>;
}

function SidebarStatusIcon({ status, isCurrent }: { status: string; isCurrent: boolean }) {
  if (status === "applied")
    return <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />;
  if (status === "rejected")
    return <Minus className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />;
  if (status === "undone")
    return <RotateCcw className="h-3.5 w-3.5 flex-shrink-0 text-orange-500" />;
  if (isCurrent)
    return <div className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center"><div className="h-2 w-2 rounded-full bg-primary" /></div>;
  return <Circle className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" />;
}

function BeforeAfterPreview({
  before,
  after,
}: {
  before: Record<string, Json>[] | null;
  after: Record<string, Json>[] | null;
}) {
  if (!before || before.length === 0) return null;
  const cols = Object.keys(before[0]);
  const rows = before.slice(0, 5);
  const afterRows = after?.slice(0, 5) ?? [];

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Before &rarr; After</p>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              {cols.map((col) => (
                <th key={`before-${col}`} className="px-2 py-1 text-left font-mono font-medium">{col}</th>
              ))}
              {afterRows.length > 0 && (
                <>
                  <th className="px-1 text-center text-muted-foreground">&rarr;</th>
                  {cols.map((col) => (
                    <th key={`after-${col}`} className="px-2 py-1 text-left font-mono font-medium text-green-700 dark:text-green-400">{col}</th>
                  ))}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const afterRow = afterRows[i];
              return (
                <tr key={i} className="border-b last:border-0">
                  {cols.map((col) => (
                    <td key={`b-${col}`} className="px-2 py-1 font-mono">{String(row[col] ?? "")}</td>
                  ))}
                  {afterRows.length > 0 && (
                    <>
                      <td className="px-1 text-center text-muted-foreground">&rarr;</td>
                      {cols.map((col) => (
                        <td key={`a-${col}`} className="px-2 py-1 font-mono text-green-700 dark:text-green-400">
                          {afterRow ? String(afterRow[col] ?? "") : ""}
                        </td>
                      ))}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
