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
  Wand2,
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
    ? (researchQuestions as string[])
    : [];
  const colLower = columnName.toLowerCase();
  for (const rq of rqs) {
    if (typeof rq === "string" && rq.toLowerCase().includes(colLower)) {
      return rq.length > 80 ? rq.slice(0, 80) + "\u2026" : rq;
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
  const { dispatchTask, isDispatching } = useDispatchTask();

  /* ---------- Generate task tracking ---------- */
  const [generateTaskId, setGenerateTaskId] = useState<string | null>(null);
  const generateProgress = useTaskProgress(generateTaskId);

  /* ---------- Apply task tracking ---------- */
  const [applyingOpId, setApplyingOpId] = useState<string | null>(null);
  const [applyTaskId, setApplyTaskId] = useState<string | null>(null);
  const applyProgress = useTaskProgress(applyTaskId);

  /* ---------- Review state ---------- */
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFinalizing, setIsFinalizing] = useState(false);

  /* ---------- Computed ---------- */
  const actionable = useMemo(
    () =>
      cleaning.all.filter(
        (op) => op.status === "pending" || op.status === "approved",
      ),
    [cleaning.all],
  );

  const appliedOps = useMemo(
    () => cleaning.all.filter((op) => op.status === "applied"),
    [cleaning.all],
  );

  /* ---------- Auto-detect running generate task ---------- */
  useEffect(() => {
    if (!datasetId) return;
    if (cleaning.all.length > 0 || cleaning.isLoading) return;
    supabase
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("task_type", "generate_cleaning_suggestions")
      .in("status", ["pending", "claimed", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          // @ts-ignore
          setGenerateTaskId(data[0].id);
        }
      });
  }, [cleaning.all.length, cleaning.isLoading, projectId, datasetId, supabase]);

  /* ---------- Reset apply tracking on complete ---------- */
  useEffect(() => {
    if (
      applyProgress.status === "completed" ||
      applyProgress.status === "failed"
    ) {
      if (applyProgress.status === "completed") {
        toast("Cleaning operation applied", { variant: "success" });
      } else {
        toast("Failed to apply operation", { variant: "error" });
      }
      setApplyingOpId(null);
      setApplyTaskId(null);
    }
  }, [applyProgress.status]);

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

  /* ---------- Handlers ---------- */
  const handleGenerate = useCallback(async () => {
    if (!datasetId) return;
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_cleaning_suggestions",
        { dataset_id: datasetId },
        datasetId,
      );
      setGenerateTaskId(taskId);
    } catch {
      toast("Failed to generate suggestions", { variant: "error" });
    }
  }, [projectId, datasetId, dispatchTask]);

  const handleApply = useCallback(
    async (op: CleaningOperation) => {
      if (!datasetId) return;
      setApplyingOpId(op.id);
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
        setApplyTaskId(taskId);
      } catch {
        toast("Failed to apply operation", { variant: "error" });
        setApplyingOpId(null);
      }
    },
    [projectId, datasetId, dispatchTask, supabase],
  );

  const handleSkip = useCallback(
    async (op: CleaningOperation) => {
      await supabase
        .from("cleaning_operations")
        // @ts-ignore
        .update({ status: "rejected" as Enums<"cleaning_op_status"> })
        .eq("id", op.id);
      if (currentIndex >= actionable.length - 1) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    },
    [supabase, currentIndex, actionable.length],
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
      toast("Data cleaning finalized! Moving to Analysis.", {
        variant: "success",
      });
      router.refresh();
      router.push(`/projects/${projectId}/step/6`);
    } catch {
      toast("Failed to finalize", { variant: "error" });
    } finally {
      setIsFinalizing(false);
    }
  }, [project.pipeline_status, supabase, projectId, router]);

  const isGenerating =
    generateProgress.status === "running" ||
    generateProgress.status === "claimed" ||
    generateProgress.status === "pending";

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
  /*  No suggestions yet                                               */
  /* ================================================================ */
  if (cleaning.all.length === 0 && !isGenerating && !cleaning.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and apply AI-generated cleaning suggestions based on your
            quality analysis.
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wand2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="mb-4 text-sm text-muted-foreground">
              Generate AI-powered cleaning suggestions based on the quality
              analysis.
            </p>
            <Button onClick={handleGenerate} disabled={isDispatching}>
              {isDispatching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Dispatching...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  Generate Cleaning Suggestions
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  Generating in progress                                           */
  /* ================================================================ */
  if (isGenerating || cleaning.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generating cleaning suggestions&hellip;
          </p>
        </div>
        <Card>
          <CardContent className="py-8 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <span className="text-sm">
                {generateProgress.progressMessage ?? "Analysing data quality issues\u2026"}
              </span>
            </div>
            {generateProgress.progress != null &&
              generateProgress.progress > 0 && (
                <Progress value={generateProgress.progress} className="h-2" />
              )}
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  Suggestions loaded — guided review                               */
  /* ================================================================ */
  const total = cleaning.all.length;
  const safeIndex = Math.min(currentIndex, total - 1);
  const currentOp = cleaning.all[safeIndex];
  const progressPct = total > 0 ? ((safeIndex + 1) / total) * 100 : 0;

  const rqMatch = currentOp
    ? matchesResearchQuestion(
        currentOp.column_name,
        project.research_questions,
      )
    : null;

  const beforeData = currentOp?.before_snapshot as
    | Record<string, Json>[]
    | null;
  const afterData = currentOp?.after_snapshot as
    | Record<string, Json>[]
    | null;
  const hasSample =
    beforeData && Array.isArray(beforeData) && beforeData.length > 0;

  const isCurrentApplying = currentOp
    ? applyingOpId === currentOp.id
    : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review each suggestion and decide whether to apply or skip it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {total} suggestion{total !== 1 ? "s" : ""}
          </Badge>
          {appliedOps.length > 0 && (
            <Badge className="bg-green-600">{appliedOps.length} applied</Badge>
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
                  <span>
                    Suggestion {safeIndex + 1} of {total}
                  </span>
                  <SeverityBadge severity={currentOp.severity} />
                </div>
                <Progress value={progressPct} className="h-1.5 mt-2" />
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Title + column */}
                <div>
                  <CardTitle className="text-base">
                    {plainLanguage(currentOp)}
                  </CardTitle>
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
                  <p className="text-xs font-semibold text-muted-foreground">
                    Why this matters
                  </p>
                  {rqMatch ? (
                    <p className="text-sm">
                      This column appears in your research question:{" "}
                      <span className="italic">&ldquo;{rqMatch}&rdquo;</span>
                    </p>
                  ) : (
                    <p className="text-sm">
                      {currentOp.reasoning || currentOp.description}
                    </p>
                  )}
                </div>

                {/* Operation description */}
                <p className="text-sm">{currentOp.description}</p>

                {/* Before → After preview */}
                {hasSample && (
                  <BeforeAfterPreview before={beforeData} after={afterData} />
                )}

                {/* Apply progress */}
                {isCurrentApplying && (
                  <div className="space-y-1">
                    <Progress
                      value={applyProgress.progress}
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground">
                      Applying&hellip;
                    </p>
                  </div>
                )}

                {/* Keyboard hint */}
                <p className="text-xs text-muted-foreground text-center">
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">
                    &larr;
                  </kbd>{" "}
                  Previous &middot;{" "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">
                    &rarr;
                  </kbd>{" "}
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
                      onClick={() =>
                        setCurrentIndex((i) => Math.min(i + 1, total - 1))
                      }
                      disabled={safeIndex >= total - 1}
                    >
                      Next
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleSkip(currentOp)}
                      disabled={
                        isCurrentApplying ||
                        currentOp.status === "applied" ||
                        currentOp.status === "rejected"
                      }
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Skip
                    </Button>
                    <Button
                      onClick={() => handleApply(currentOp)}
                      disabled={
                        isCurrentApplying ||
                        currentOp.status === "applied" ||
                        currentOp.status === "rejected"
                      }
                    >
                      {isCurrentApplying ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Apply
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="flex flex-col items-center py-8">
                <CheckCircle2 className="mb-3 h-8 w-8 text-green-500" />
                <p className="font-medium">All suggestions reviewed!</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {appliedOps.length} applied, {cleaning.rejected.length}{" "}
                  skipped
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
              <CardTitle className="text-sm">All suggestions</CardTitle>
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
                      <SidebarStatusIcon
                        status={op.status}
                        isCurrent={isCurrent}
                      />
                      <span className="truncate">
                        {op.description || plainLanguage(op)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  Bottom: Finalize                                             */}
      {/* ============================================================ */}
      <div className="flex justify-end border-t pt-4">
        <Button onClick={handleFinalize} disabled={isFinalizing}>
          {isFinalizing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finalizing...
            </>
          ) : (
            <>
              Finalize &amp; Continue to Analysis
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function SeverityBadge({ severity }: { severity: string | null }) {
  if (severity === "critical")
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs">
        critical
      </Badge>
    );
  if (severity === "warning")
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-xs">
        warning
      </Badge>
    );
  return (
    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs">
      info
    </Badge>
  );
}

function SidebarStatusIcon({
  status,
  isCurrent,
}: {
  status: string;
  isCurrent: boolean;
}) {
  if (status === "applied")
    return <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />;
  if (status === "rejected")
    return <Minus className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />;
  if (isCurrent)
    return (
      <div className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        <div className="h-2 w-2 rounded-full bg-primary" />
      </div>
    );
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
      <p className="mb-2 text-xs font-semibold text-muted-foreground">
        Before &rarr; After
      </p>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              {cols.map((col) => (
                <th
                  key={`before-${col}`}
                  className="px-2 py-1 text-left font-mono font-medium"
                >
                  {col}
                </th>
              ))}
              {afterRows.length > 0 && (
                <>
                  <th className="px-1 text-center text-muted-foreground">&rarr;</th>
                  {cols.map((col) => (
                    <th
                      key={`after-${col}`}
                      className="px-2 py-1 text-left font-mono font-medium text-green-700 dark:text-green-400"
                    >
                      {col}
                    </th>
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
                    <td key={`b-${col}`} className="px-2 py-1 font-mono">
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                  {afterRows.length > 0 && (
                    <>
                      <td className="px-1 text-center text-muted-foreground">
                        &rarr;
                      </td>
                      {cols.map((col) => (
                        <td
                          key={`a-${col}`}
                          className="px-2 py-1 font-mono text-green-700 dark:text-green-400"
                        >
                          {afterRow
                            ? String(afterRow[col] ?? "")
                            : ""}
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
