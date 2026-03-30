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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
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
/*  Category config                                                    */
/* ------------------------------------------------------------------ */

interface CleaningCategory {
  key: string;
  stepNum: number;
  name: string;
  opTypes: string[];
  descriptionFilter?: (op: CleaningOperation) => boolean;
}

const CATEGORIES: CleaningCategory[] = [
  {
    key: "cat-1",
    stepNum: 1,
    name: "Duplicate Removal",
    opTypes: ["remove_duplicates"],
  },
  {
    key: "cat-2",
    stepNum: 2,
    name: "Response Quality",
    opTypes: ["custom"],
    descriptionFilter: (op) =>
      op.operation_type === "custom" &&
      op.description.toLowerCase().includes("response_quality"),
  },
  {
    key: "cat-3",
    stepNum: 3,
    name: "Standardization",
    opTypes: ["fix_encoding", "recode_values", "rename_column", "fix_data_type"],
  },
  {
    key: "cat-4",
    stepNum: 4,
    name: "Missing Value Treatment",
    opTypes: ["standardize_missing", "impute_value"],
  },
  {
    key: "cat-5",
    stepNum: 5,
    name: "Outlier Treatment",
    opTypes: ["fix_outlier"],
  },
  {
    key: "cat-6",
    stepNum: 6,
    name: "Skip Logic Fixes",
    opTypes: ["fix_skip_logic"],
  },
  {
    key: "cat-7",
    stepNum: 7,
    name: "Custom Operations",
    opTypes: ["custom"],
    // Only custom ops NOT already matched by cat-2 (response_quality)
    descriptionFilter: (op) =>
      op.operation_type === "custom" &&
      !op.description.toLowerCase().includes("response_quality"),
  },
];

function categorizeOp(op: CleaningOperation): string {
  // Response quality custom ops
  if (
    op.operation_type === "custom" &&
    op.description.toLowerCase().includes("response_quality")
  ) {
    return "cat-2";
  }
  // Custom (general)
  if (op.operation_type === "custom") {
    return "cat-7";
  }
  for (const cat of CATEGORIES) {
    if (cat.opTypes.includes(op.operation_type) && cat.key !== "cat-2" && cat.key !== "cat-7") {
      return cat.key;
    }
  }
  return "cat-7"; // fallback
}

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
  const { dispatchTask } = useDispatchTask();

  /* ---------- Apply / rollback task tracking ---------- */
  const [actioningOpId, setActioningOpId] = useState<string | null>(null);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const actionProgress = useTaskProgress(actionTaskId);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [applyAllRunning, setApplyAllRunning] = useState(false);

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

  /* ---------- Computed: ops by category ---------- */
  const opsByCategory = useMemo(() => {
    const map: Record<string, CleaningOperation[]> = {};
    for (const cat of CATEGORIES) {
      map[cat.key] = [];
    }
    for (const op of cleaning.all) {
      const catKey = categorizeOp(op);
      if (!map[catKey]) map[catKey] = [];
      map[catKey].push(op);
    }
    return map;
  }, [cleaning.all]);

  const totalApplied = useMemo(
    () => cleaning.all.filter((o) => o.status === "applied").length,
    [cleaning.all],
  );
  const totalPending = useMemo(
    () => cleaning.all.filter((o) => o.status === "pending" || o.status === "approved").length,
    [cleaning.all],
  );
  const totalRejected = useMemo(
    () => cleaning.all.filter((o) => o.status === "rejected").length,
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
      } catch {
        toast("Failed to apply operation", { variant: "error" });
        setActioningOpId(null);
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
    },
    [supabase],
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

  const handleApplyAllPending = useCallback(async () => {
    if (!datasetId) return;
    setApplyAllRunning(true);
    const pendingOps = cleaning.all.filter(
      (o) => o.status === "pending" || o.status === "approved",
    );
    try {
      for (const op of pendingOps) {
        await supabase
          .from("cleaning_operations")
          // @ts-ignore
          .update({ status: "approved" as Enums<"cleaning_op_status"> })
          .eq("id", op.id);
        await dispatchTask(
          projectId,
          "apply_cleaning_operation",
          { operation_id: op.id, dataset_id: datasetId },
          datasetId,
        );
      }
      toast(`Applied ${pendingOps.length} operations`, { variant: "success" });
    } catch {
      toast("Some operations failed to apply", { variant: "error" });
    } finally {
      setApplyAllRunning(false);
    }
  }, [cleaning.all, datasetId, projectId, dispatchTask, supabase]);

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
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Finalizing...</>
            ) : (
              <>Continue to Analysis <ArrowRight className="ml-2 h-4 w-4" /></>
            )}
          </Button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Main: 7-category cleaning audit view                            */
  /* ================================================================ */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and manage cleaning operations by category.
          </p>
        </div>
      </div>

      {/* Summary stats bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex items-center gap-2 text-sm">
            <Badge className="bg-green-600 text-white">{totalApplied} applied</Badge>
            <Badge variant="outline">{totalPending} pending review</Badge>
            <Badge variant="secondary">{totalRejected} skipped</Badge>
          </div>
          <div className="ml-auto">
            {totalPending > 0 && (
              <Button
                size="sm"
                onClick={handleApplyAllPending}
                disabled={applyAllRunning}
              >
                {applyAllRunning && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Apply All Pending ({totalPending})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action progress bar */}
      {actioningOpId && (
        <Card>
          <CardContent className="p-4 space-y-1">
            <Progress value={actionProgress.progress} className="h-2" />
            <p className="text-xs text-muted-foreground">Processing operation...</p>
          </CardContent>
        </Card>
      )}

      {/* 7-category accordion */}
      <Accordion type="multiple" className="space-y-2">
        {CATEGORIES.map((cat) => {
          const ops = opsByCategory[cat.key] ?? [];
          const appliedOps = ops.filter((o) => o.status === "applied");
          const pendingOps = ops.filter((o) => o.status === "pending" || o.status === "approved");
          const otherOps = ops.filter(
            (o) => o.status !== "applied" && o.status !== "pending" && o.status !== "approved",
          );

          return (
            <AccordionItem
              key={cat.key}
              value={cat.key}
              className="rounded-lg border"
            >
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex flex-1 items-center gap-3 text-left">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {cat.stepNum}
                  </span>
                  <span className="text-sm font-medium">{cat.name}</span>
                  {ops.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      {appliedOps.length > 0 && (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
                          {appliedOps.length} applied
                        </Badge>
                      )}
                      {pendingOps.length > 0 && (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs">
                          {pendingOps.length} pending
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No operations
                    </span>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {ops.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No cleaning operations in this category.
                  </p>
                )}

                {/* Applied operations */}
                {appliedOps.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                      Applied ({appliedOps.length})
                    </p>
                    {appliedOps.map((op) => (
                      <OpCard
                        key={op.id}
                        op={op}
                        actioningOpId={actioningOpId}
                        onRollback={handleRollback}
                      />
                    ))}
                  </div>
                )}

                {/* Pending operations */}
                {pendingOps.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                      Pending Review ({pendingOps.length})
                    </p>
                    {pendingOps.map((op) => (
                      <OpCard
                        key={op.id}
                        op={op}
                        actioningOpId={actioningOpId}
                        onApply={handleApply}
                        onSkip={handleSkip}
                      />
                    ))}
                  </div>
                )}

                {/* Rejected/undone operations */}
                {otherOps.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Skipped / Rolled Back ({otherOps.length})
                    </p>
                    {otherOps.map((op) => (
                      <OpCard
                        key={op.id}
                        op={op}
                        actioningOpId={actioningOpId}
                      />
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Finalize */}
      <div className="flex justify-end border-t pt-4">
        <Button onClick={handleFinalize} disabled={isFinalizing}>
          {isFinalizing ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Finalizing...</>
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

function OpCard({
  op,
  actioningOpId,
  onApply,
  onSkip,
  onRollback,
}: {
  op: CleaningOperation;
  actioningOpId: string | null;
  onApply?: (op: CleaningOperation) => void;
  onSkip?: (op: CleaningOperation) => void;
  onRollback?: (op: CleaningOperation) => void;
}) {
  const isActioning = actioningOpId === op.id;
  const beforeData = op.before_snapshot as Record<string, Json>[] | null;
  const afterData = op.after_snapshot as Record<string, Json>[] | null;
  const hasSample =
    beforeData && Array.isArray(beforeData) && beforeData.length > 0;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={op.status} />
          <span className="text-sm font-medium">
            {op.description || plainLanguage(op)}
          </span>
        </div>
        {op.column_name && (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
            {op.column_name}
          </code>
        )}
      </div>

      {op.reasoning && (
        <p className="text-xs text-muted-foreground">{op.reasoning}</p>
      )}

      {/* Before/after sample */}
      {hasSample && (
        <BeforeAfterPreview before={beforeData} after={afterData} />
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {op.status === "applied" && onRollback && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => onRollback(op)}
            disabled={isActioning}
          >
            {isActioning ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Rollback
          </Button>
        )}
        {(op.status === "pending" || op.status === "approved") && onSkip && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSkip(op)}
            disabled={isActioning}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Skip
          </Button>
        )}
        {(op.status === "pending" || op.status === "approved") && onApply && (
          <Button
            size="sm"
            onClick={() => onApply(op)}
            disabled={isActioning}
          >
            {isActioning ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            Apply
          </Button>
        )}
      </div>
    </div>
  );
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
                  <th className="px-1 text-center text-muted-foreground">
                    &rarr;
                  </th>
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
