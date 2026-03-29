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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Undo2,
  Wand2,
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

type ReviewMode = "one-at-a-time" | "review-all";

type CleaningCategory =
  | "duplicates"
  | "missing"
  | "outliers"
  | "formatting"
  | "type_issues"
  | "other";

export interface Step5CleaningProps {
  project: Project;
  dataset: Dataset | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function categorizeOp(op: CleaningOperation): CleaningCategory {
  const t = op.operation_type;
  if (t === "remove_duplicates") return "duplicates";
  if (t === "standardize_missing" || t === "impute_value") return "missing";
  if (t === "fix_outlier") return "outliers";
  if (t === "fix_encoding" || t === "recode_values" || t === "rename_column")
    return "formatting";
  if (t === "fix_data_type" || t === "split_column" || t === "merge_columns")
    return "type_issues";
  return "other";
}

const CATEGORY_LABELS: Record<CleaningCategory, string> = {
  duplicates: "Duplicates",
  missing: "Missing Values",
  outliers: "Outliers",
  formatting: "Formatting",
  type_issues: "Type Issues",
  other: "Other",
};

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

  /* ---------- Review mode + index ---------- */
  const [reviewMode, setReviewMode] = useState<ReviewMode>("one-at-a-time");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSampleData, setShowSampleData] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  /* ---------- Computed ---------- */
  const actionable = useMemo(
    () => cleaning.all.filter((op) => op.status === "pending" || op.status === "approved"),
    [cleaning.all],
  );

  const reviewed = useMemo(
    () => cleaning.all.filter((op) => op.status === "applied" || op.status === "rejected"),
    [cleaning.all],
  );

  const appliedOps = useMemo(
    () => cleaning.all.filter((op) => op.status === "applied"),
    [cleaning.all],
  );

  const allReviewed = actionable.length === 0 && cleaning.all.length > 0;

  const grouped = useMemo(() => {
    const groups: Record<CleaningCategory, CleaningOperation[]> = {
      duplicates: [],
      missing: [],
      outliers: [],
      formatting: [],
      type_issues: [],
      other: [],
    };
    for (const op of actionable) {
      groups[categorizeOp(op)].push(op);
    }
    return groups;
  }, [actionable]);

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
    if (applyProgress.status === "completed" || applyProgress.status === "failed") {
      if (applyProgress.status === "completed") {
        toast("Cleaning operation applied", { variant: "success" });
      } else {
        toast("Failed to apply operation", { variant: "error" });
      }
      setApplyingOpId(null);
      setApplyTaskId(null);
    }
  }, [applyProgress.status]);

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
      if (reviewMode === "one-at-a-time" && currentIndex >= actionable.length - 1) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    },
    [supabase, reviewMode, currentIndex, actionable.length],
  );

  const handleUndo = useCallback(
    async (op: CleaningOperation) => {
      await supabase
        .from("cleaning_operations")
        // @ts-ignore
        .update({ status: "undone" as Enums<"cleaning_op_status"> })
        .eq("id", op.id);
      toast("Operation undone", { variant: "success" });
    },
    [supabase],
  );

  const handleBulkAction = useCallback(
    async (ops: CleaningOperation[], action: "apply" | "skip") => {
      if (action === "skip") {
        const ids = ops.map((o) => o.id);
        await supabase
          .from("cleaning_operations")
          // @ts-ignore
          .update({ status: "rejected" as Enums<"cleaning_op_status"> })
          .in("id", ids);
        toast(`Skipped ${ids.length} operations`, { variant: "default" });
      } else {
        for (const op of ops) {
          await handleApply(op);
        }
      }
    },
    [supabase, handleApply],
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

  const isGenerating =
    generateProgress.status === "running" ||
    generateProgress.status === "claimed" ||
    generateProgress.status === "pending";

  /* ---------------------------------------------------------------- */
  /*  No dataset                                                       */
  /* ---------------------------------------------------------------- */
  if (!dataset) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No dataset found. Please complete the upload step first.
        </CardContent>
      </Card>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  No suggestions yet                                               */
  /* ---------------------------------------------------------------- */
  if (cleaning.all.length === 0 && !isGenerating && !cleaning.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and apply AI-generated cleaning suggestions based on your quality analysis.
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wand2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="mb-4 text-sm text-muted-foreground">
              Generate AI-powered cleaning suggestions based on the quality analysis.
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

  /* ---------------------------------------------------------------- */
  /*  Generating in progress                                           */
  /* ---------------------------------------------------------------- */
  if (isGenerating || cleaning.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generating cleaning suggestions…
          </p>
        </div>
        <Card>
          <CardContent className="py-8 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <span className="text-sm">
                {generateProgress.message ?? "Analysing data quality issues…"}
              </span>
            </div>
            {generateProgress.progress != null && generateProgress.progress > 0 && (
              <Progress value={generateProgress.progress} className="h-2" />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Suggestions loaded                                               */
  /* ---------------------------------------------------------------- */
  const currentOp = actionable[currentIndex];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Data Cleaning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and apply AI-generated cleaning suggestions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {cleaning.all.length} suggestion{cleaning.all.length !== 1 ? "s" : ""}
          </Badge>
          {appliedOps.length > 0 && (
            <Badge className="bg-green-600">
              {appliedOps.length} applied
            </Badge>
          )}
        </div>
      </div>

      {/* Review mode switcher */}
      {actionable.length > 0 && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={reviewMode === "one-at-a-time" ? "default" : "outline"}
            onClick={() => setReviewMode("one-at-a-time")}
          >
            One at a time
          </Button>
          <Button
            size="sm"
            variant={reviewMode === "review-all" ? "default" : "outline"}
            onClick={() => setReviewMode("review-all")}
          >
            Review all
          </Button>
        </div>
      )}

      {/* One-at-a-time review */}
      {reviewMode === "one-at-a-time" && currentOp && (
        <CleaningCard
          op={currentOp}
          index={currentIndex}
          total={actionable.length}
          isApplying={applyingOpId === currentOp.id}
          showSampleData={showSampleData}
          onToggleSample={() => setShowSampleData((v) => !v)}
          onApply={() => handleApply(currentOp)}
          onSkip={() => handleSkip(currentOp)}
          onNext={() => setCurrentIndex((i) => Math.min(i + 1, actionable.length - 1))}
          onPrev={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
        />
      )}

      {/* Review-all grouped */}
      {reviewMode === "review-all" && actionable.length > 0 && (
        <div className="space-y-4">
          {(Object.entries(grouped) as [CleaningCategory, CleaningOperation[]][])
            .filter(([, ops]) => ops.length > 0)
            .map(([category, ops]) => (
              <Card key={category}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">
                      {CATEGORY_LABELS[category]} ({ops.length})
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleBulkAction(ops, "skip")}>
                        Skip all
                      </Button>
                      <Button size="sm" onClick={() => handleBulkAction(ops, "apply")}>
                        Apply all
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {ops.map((op) => (
                    <div key={op.id} className="flex items-start justify-between gap-3 rounded border p-3 text-sm">
                      <div>
                        <p className="font-medium">{op.description ?? op.operation_type}</p>
                        {op.column_name && (
                          <p className="text-xs text-muted-foreground">Column: {op.column_name}</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => handleSkip(op)}>Skip</Button>
                        <Button size="sm" onClick={() => handleApply(op)} disabled={applyingOpId === op.id}>
                          {applyingOpId === op.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* No more actionable */}
      {actionable.length === 0 && cleaning.all.length > 0 && (
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              All {cleaning.all.length} suggestions reviewed. {appliedOps.length} applied.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Reviewed ops */}
      {reviewed.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Reviewed ({reviewed.length})</p>
          {reviewed.map((op) => (
            <div
              key={op.id}
              className="flex items-center justify-between gap-3 rounded border bg-muted/30 p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                {op.status === "applied" ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={op.status === "rejected" ? "line-through text-muted-foreground" : ""}>
                  {op.description ?? op.operation_type}
                </span>
              </div>
              {op.status === "applied" && (
                <Button size="sm" variant="ghost" onClick={() => handleUndo(op)}>
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Finalize */}
      <div className="flex justify-end pt-4 border-t">
        <Button onClick={handleFinalize} disabled={isFinalizing}>
          {isFinalizing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finalizing...
            </>
          ) : (
            <>
              Continue to Analysis
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CleaningCard (one-at-a-time)                                       */
/* ------------------------------------------------------------------ */

interface CleaningCardProps {
  op: CleaningOperation;
  index: number;
  total: number;
  isApplying: boolean;
  showSampleData: boolean;
  onToggleSample: () => void;
  onApply: () => void;
  onSkip: () => void;
  onNext: () => void;
  onPrev: () => void;
}

function CleaningCard({
  op,
  index,
  total,
  isApplying,
  showSampleData,
  onToggleSample,
  onApply,
  onSkip,
  onNext,
  onPrev,
}: CleaningCardProps) {
  const impactColor =
    op.impact === "high"
      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      : op.impact === "medium"
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
      : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Suggestion {index + 1} of {total}
            </p>
            <CardTitle className="text-base">{op.description ?? op.operation_type}</CardTitle>
            {op.column_name && (
              <CardDescription>Column: <code className="rounded bg-muted px-1 text-xs">{op.column_name}</code></CardDescription>
            )}
          </div>
          {op.impact && (
            <Badge className={impactColor}>{op.impact} impact</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {op.rationale && (
          <p className="text-sm text-muted-foreground">{op.rationale}</p>
        )}

        {op.sample_data && (
          <div>
            <Button variant="ghost" size="sm" onClick={onToggleSample} className="mb-2 h-7 px-2 text-xs">
              {showSampleData ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
              Sample data
            </Button>
            {showSampleData && (
              <pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-32">
                {JSON.stringify(op.sample_data, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onPrev} disabled={index === 0}>←</Button>
            <Button variant="outline" size="sm" onClick={onNext} disabled={index === total - 1}>→</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSkip} disabled={isApplying}>Skip</Button>
            <Button onClick={onApply} disabled={isApplying}>
              {isApplying ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Applying…</>
              ) : (
                <><Check className="mr-2 h-4 w-4" />Apply</>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
