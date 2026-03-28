"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useAnalysisResults } from "@/hooks/useAnalysisResults";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { LoadingSkeleton } from "@/components/workflow/LoadingSkeleton";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Info,
  Loader2,
  RefreshCw,
  Scale,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import type { Tables, Json } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Project = Tables<"projects">;
type Dataset = Tables<"datasets">;
type AnalysisPlan = Tables<"analysis_plans">;
type PipelineStatus = Record<string, string>;

interface Step5AnalysisProps {
  project: Project;
  dataset: Dataset | null;
  hasWeightColumn: boolean;
  weightColumnName: string | null;
  initialRunningTaskIds: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusBadge(status: AnalysisPlan["status"]) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Completed
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          <Check className="mr-1 h-3 w-3" />
          Approved
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-600 hover:bg-gray-100">
          <X className="mr-1 h-3 w-3" />
          Rejected
        </Badge>
      );
    default:
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          Pending
        </Badge>
      );
  }
}

/** Format a test name like "mann_whitney_u" → "Mann-Whitney U" */
function formatTestName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/ U$/, " U")
    .replace(/ T /, "-T ")
    .replace(/ Chi /, "-Chi ");
}

/** Group plans by research question text */
function groupByRQ(
  plans: AnalysisPlan[],
): Map<string, AnalysisPlan[]> {
  const groups = new Map<string, AnalysisPlan[]>();
  for (const plan of plans) {
    const key = plan.research_question_text ?? "Ungrouped analyses";
    const existing = groups.get(key) ?? [];
    existing.push(plan);
    groups.set(key, existing);
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function Step5Analysis({
  project,
  dataset,
  hasWeightColumn,
  weightColumnName,
  initialRunningTaskIds,
}: Step5AnalysisProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const projectId = project.id;
  const datasetId = dataset?.id ?? null;

  /* ---------- Task tracking ---------- */
  const [planTaskId, setPlanTaskId] = useState<string | null>(
    initialRunningTaskIds["generate_analysis_plan"] ?? null,
  );
  const planProgress = useTaskProgress(planTaskId);
  const { dispatchTask, isDispatching } = useDispatchTask();

  /* ---------- Analysis plans (Realtime) ---------- */
  const { plans, isLoading: plansLoading } = useAnalysisResults(datasetId);

  /* ---------- UI state ---------- */
  const [expandedRQs, setExpandedRQs] = useState<Set<string>>(new Set());
  const [showAutoApproveConfirm, setShowAutoApproveConfirm] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [updatingPlanIds, setUpdatingPlanIds] = useState<Set<string>>(new Set());

  /* ---------- Derived state ---------- */
  const isGenerating =
    planProgress.status === "running" ||
    planProgress.status === "claimed" ||
    planProgress.status === "pending";

  const groupedPlans = useMemo(() => groupByRQ(plans), [plans]);

  const approvedCount = useMemo(
    // Count plans that are approved OR already completed (ran successfully)
    () => plans.filter((p) => p.status === "approved" || p.status === "completed").length,
    [plans],
  );

  const pendingCount = useMemo(
    () => plans.filter((p) => p.status === "planned").length,
    [plans],
  );

  const hasPlans = plans.length > 0;
  const canRunAnalysis = approvedCount > 0;

  /* ---------- Handlers ---------- */

  const handleGeneratePlan = useCallback(async () => {
    if (!datasetId) return;
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_analysis_plan",
        { dataset_id: datasetId },
        datasetId,
      );
      setPlanTaskId(taskId);
      toast("Generating analysis plan...", { variant: "default" });
    } catch {
      toast("Failed to start plan generation", { variant: "error" });
    }
  }, [projectId, datasetId, dispatchTask]);

  const handleRegenerate = useCallback(async () => {
    if (!datasetId) return;
    // Delete existing plans, then regenerate
    try {
      await supabase
        .from("analysis_plans")
        .delete()
        .eq("dataset_id", datasetId);

      const { taskId } = await dispatchTask(
        projectId,
        "generate_analysis_plan",
        { dataset_id: datasetId },
        datasetId,
      );
      setPlanTaskId(taskId);
      toast("Re-generating analysis plan...", { variant: "default" });
    } catch {
      toast("Failed to re-generate plan", { variant: "error" });
    }
  }, [projectId, datasetId, supabase, dispatchTask]);

  const handleUpdatePlanStatus = useCallback(
    async (planId: string, newStatus: "approved" | "rejected") => {
      setUpdatingPlanIds((prev) => new Set(prev).add(planId));
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        const updateData =
          newStatus === "approved"
            ? {
                status: newStatus as const,
                approved_by: user?.id ?? null,
                approved_at: new Date().toISOString(),
              }
            : {
                status: newStatus as const,
                approved_by: null,
                approved_at: null,
              };

        const { error } = await supabase
          .from("analysis_plans")
          .update(updateData)
          .eq("id", planId);

        if (error) throw error;
      } catch {
        toast("Failed to update plan status", { variant: "error" });
      } finally {
        setUpdatingPlanIds((prev) => {
          const next = new Set(prev);
          next.delete(planId);
          return next;
        });
      }
    },
    [supabase],
  );

  const handleAutoApproveAll = useCallback(async () => {
    setShowAutoApproveConfirm(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const pendingPlans = plans.filter((p) => p.status === "planned");
    const now = new Date().toISOString();

    try {
      for (const plan of pendingPlans) {
        await supabase
          .from("analysis_plans")
          .update({
            status: "approved" as const,
            approved_by: user?.id ?? null,
            approved_at: now,
          })
          .eq("id", plan.id);
      }
      toast(`Approved ${pendingPlans.length} analyses`, { variant: "success" });
    } catch {
      toast("Failed to auto-approve some plans", { variant: "error" });
    }
  }, [plans, supabase]);

  const handleRunAnalysis = useCallback(async () => {
    if (!datasetId) return;
    setIsFinalizing(true);
    try {
      await dispatchTask(
        projectId,
        "run_analysis",
        { dataset_id: datasetId },
        datasetId,
      );

      // Update pipeline status
      const pipelineStatus: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "5": "completed",
        "6": "active",
      };

      await supabase
        .from("projects")
        .update({
          current_step: 6,
          pipeline_status: pipelineStatus as unknown as Json,
        })
        .eq("id", projectId);

      toast("Analysis running. View progress in step bar.", {
        variant: "success",
      });

      router.push(`/projects/${projectId}/step/6`);
    } catch {
      toast("Failed to start analysis", { variant: "error" });
    } finally {
      setIsFinalizing(false);
    }
  }, [projectId, datasetId, project.pipeline_status, supabase, dispatchTask, router]);

  const toggleRQ = useCallback((rqKey: string) => {
    setExpandedRQs((prev) => {
      const next = new Set(prev);
      if (next.has(rqKey)) {
        next.delete(rqKey);
      } else {
        next.add(rqKey);
      }
      return next;
    });
  }, []);

  /* ================================================================ */
  /*  No dataset guard                                                 */
  /* ================================================================ */

  if (!dataset) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <ClipboardCheck className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No dataset found. Please upload data in Step 2.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push(`/projects/${project.id}/step/2`)}
          >
            Go to Step 2
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ================================================================ */
  /*  Generating skeleton (task running, no plans yet)                  */
  /* ================================================================ */

  if (isGenerating && !hasPlans) {
    return (
      <div className="space-y-6">
        {/* Weights banner */}
        <WeightsBanner
          hasWeightColumn={hasWeightColumn}
          weightColumnName={weightColumnName}
        />

        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <div>
                <p className="font-medium">Generating analysis plan...</p>
                <p className="text-sm text-muted-foreground">
                  {planProgress.progressMessage ?? "Reading research questions..."}
                </p>
              </div>
            </div>
            <Progress value={planProgress.progress} className="h-2" />
          </CardContent>
        </Card>

        <LoadingSkeleton type="card" count={3} />
      </div>
    );
  }

  /* ================================================================ */
  /*  Generation failed                                                */
  /* ================================================================ */

  if (planProgress.status === "failed" && !hasPlans) {
    return (
      <div className="space-y-6">
        <WeightsBanner
          hasWeightColumn={hasWeightColumn}
          weightColumnName={weightColumnName}
        />

        <Card className="border-red-200">
          <CardContent className="flex flex-col items-center py-8">
            <AlertCircle className="mb-3 h-10 w-10 text-red-500" />
            <p className="font-medium text-red-700">Plan generation failed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {planProgress.error ?? "An unexpected error occurred."}
            </p>
            <Button className="mt-4" onClick={handleGeneratePlan}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  Initial state — no plans exist yet                               */
  /* ================================================================ */

  if (!hasPlans && !isGenerating && !plansLoading) {
    return (
      <div className="space-y-6">
        <WeightsBanner
          hasWeightColumn={hasWeightColumn}
          weightColumnName={weightColumnName}
        />

        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Sparkles className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="mb-1 font-medium">No analysis plan yet</p>
            <p className="mb-6 text-sm text-muted-foreground">
              AI will read your research questions and propose statistical tests
              for each variable pair.
            </p>
            <Button
              size="lg"
              onClick={handleGeneratePlan}
              disabled={isDispatching}
            >
              {isDispatching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Generate Analysis Plan
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  Plans loaded — plan review UI                                     */
  /* ================================================================ */

  return (
    <div className="space-y-6">
      {/* Weights banner */}
      <WeightsBanner
        hasWeightColumn={hasWeightColumn}
        weightColumnName={weightColumnName}
      />

      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">
            Analysis Plan
          </h2>
          <span className="text-sm text-muted-foreground">
            {approvedCount} of {plans.length} approved or completed
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            onClick={handleRegenerate}
            disabled={isDispatching || isFinalizing}
          >
            <RefreshCw className="mr-1 inline h-3 w-3" />
            Re-generate plan
          </button>

          {pendingCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAutoApproveConfirm(true)}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Auto-approve all
            </Button>
          )}

          <Button
            size="sm"
            disabled={!canRunAnalysis || isFinalizing}
            onClick={handleRunAnalysis}
          >
            {isFinalizing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            Run Analysis ({approvedCount})
          </Button>
        </div>
        {!canRunAnalysis && plans.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground text-right">
            Approve at least one research question above to enable analysis
          </p>
        )}
      </div>

      {/* Auto-approve confirmation dialog */}
      {showAutoApproveConfirm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="flex items-center justify-between p-4">
            <p className="text-sm">
              Approve all <strong>{pendingCount}</strong> proposed analyses?
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAutoApproveConfirm(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleAutoApproveAll}>
                Approve All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generating overlay (re-generating with existing plans) */}
      {isGenerating && hasPlans && (
        <Card className="border-blue-200">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm">
                {planProgress.progressMessage ?? "Regenerating plan..."}
              </span>
            </div>
            <Progress value={planProgress.progress} className="h-1.5" />
          </CardContent>
        </Card>
      )}

      {/* Plans grouped by RQ */}
      <div className="space-y-4">
        {Array.from(groupedPlans.entries()).map(([rqText, rqPlans]) => (
          <RQCard
            key={rqText}
            rqText={rqText}
            plans={rqPlans}
            isExpanded={expandedRQs.has(rqText)}
            onToggle={() => toggleRQ(rqText)}
            onUpdateStatus={handleUpdatePlanStatus}
            updatingPlanIds={updatingPlanIds}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function WeightsBanner({
  hasWeightColumn,
  weightColumnName,
}: {
  hasWeightColumn: boolean;
  weightColumnName: string | null;
}) {
  if (hasWeightColumn) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <Scale className="h-4 w-4 shrink-0" />
        <span>
          Survey weight column detected{" "}
          {weightColumnName && (
            <>
              (<code className="rounded bg-green-100 px-1 text-xs">{weightColumnName}</code>)
            </>
          )}{" "}
          — weighted analysis enabled
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
      <Info className="h-4 w-4 shrink-0" />
      <span>
        No survey weights detected — analysis will use unweighted tests
      </span>
    </div>
  );
}

interface RQCardProps {
  rqText: string;
  plans: AnalysisPlan[];
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateStatus: (planId: string, status: "approved" | "rejected") => void;
  updatingPlanIds: Set<string>;
}

function RQCard({
  rqText,
  plans,
  isExpanded,
  onToggle,
  onUpdateStatus,
  updatingPlanIds,
}: RQCardProps) {
  const approvedInGroup = plans.filter((p) => p.status === "approved").length;

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            {isExpanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium leading-snug">
                {rqText}
              </CardTitle>
              <CardDescription className="mt-1">
                {plans.length} test{plans.length !== 1 ? "s" : ""} proposed
                {approvedInGroup > 0 && (
                  <> · {approvedInGroup} approved</>
                )}
              </CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {plans.map((p) => (
              <span
                key={p.id}
                className={`h-2 w-2 rounded-full ${
                  p.status === "approved"
                    ? "bg-green-500"
                    : p.status === "rejected"
                      ? "bg-gray-400"
                      : "bg-yellow-400"
                }`}
                title={`${p.dependent_variable} × ${p.independent_variable}: ${p.status}`}
              />
            ))}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-3 pt-0">
          {plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              isUpdating={updatingPlanIds.has(plan.id)}
              onUpdateStatus={onUpdateStatus}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

interface PlanRowProps {
  plan: AnalysisPlan;
  isUpdating: boolean;
  onUpdateStatus: (planId: string, status: "approved" | "rejected") => void;
}

function PlanRow({ plan, isUpdating, onUpdateStatus }: PlanRowProps) {
  const [showRationale, setShowRationale] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      {/* Top row: variables + test badge + status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium">
            {plan.dependent_variable}{" "}
            <span className="text-muted-foreground">×</span>{" "}
            {plan.independent_variable}
          </span>
          <Badge variant="outline" className="shrink-0">
            {formatTestName(plan.selected_test)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(plan.status)}
        </div>
      </div>

      {/* Expandable: Why this test? */}
      <Collapsible open={showRationale} onOpenChange={setShowRationale}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {showRationale ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Why this test?
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 rounded bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed">
            {plan.test_rationale}
          </p>
        </CollapsibleContent>
      </Collapsible>

      {/* Expandable: Assumptions & fallback */}
      {plan.fallback_test && (
        <Collapsible open={showAssumptions} onOpenChange={setShowAssumptions}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showAssumptions ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Assumptions &amp; fallback
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p>
                <strong>Fallback test:</strong>{" "}
                {formatTestName(plan.fallback_test)}
              </p>
              <p>
                Used if normality or other assumptions fail at runtime.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Approve / Reject buttons — hide for completed plans (already ran) */}
      <div className="flex items-center gap-2 pt-1">
        {plan.status !== "approved" && plan.status !== "completed" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
            disabled={isUpdating}
            onClick={() => onUpdateStatus(plan.id, "approved")}
          >
            {isUpdating ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1 h-3 w-3" />
            )}
            Approve
          </Button>
        )}
        {plan.status !== "rejected" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-gray-300 text-gray-600 hover:bg-gray-50"
            disabled={isUpdating}
            onClick={() => onUpdateStatus(plan.id, "rejected")}
          >
            {isUpdating ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <X className="mr-1 h-3 w-3" />
            )}
            Reject
          </Button>
        )}
        {(plan.status === "approved" || plan.status === "rejected") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            disabled={isUpdating}
            onClick={() =>
              onUpdateStatus(
                plan.id,
                plan.status === "approved" ? "rejected" : "approved",
              )
            }
          >
            {plan.status === "approved" ? "Undo approval" : "Undo rejection"}
          </Button>
        )}
      </div>
    </div>
  );
}
