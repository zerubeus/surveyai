"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useAnalysisResults } from "@/hooks/useAnalysisResults";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useProgressToast } from "@/hooks/useProgressToast";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  MinusCircle,
  RefreshCw,
  Scale,
  Sparkles,
  TrendingUp,
  X,
  XCircle,
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
type EDAResult = Pick<
  Tables<"eda_results">,
  "id" | "column_name" | "column_role" | "data_type" | "profile" | "quality_score"
>;

interface Step5AnalysisProps {
  project: Project;
  dataset: Dataset | null;
  hasWeightColumn: boolean;
  weightColumnName: string | null;
  initialRunningTaskIds: Record<string, string>;
  edaResults?: EDAResult[];
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
  edaResults = [],
}: Step5AnalysisProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const projectId = project.id;
  const datasetId = dataset?.id ?? null;

  /* ---------- Task tracking ---------- */
  const [planTaskId, setPlanTaskId] = useState<string | null>(
    initialRunningTaskIds["generate_analysis_plan"] ?? null,
  );
  const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(
    initialRunningTaskIds["run_analysis"] ?? null,
  );
  const planProgress = useTaskProgress(planTaskId);
  const analysisProgress = useTaskProgress(analysisTaskId);
  useProgressToast(planProgress, { label: "Analysis plan generation", thresholds: [50] });
  useProgressToast(analysisProgress, { label: "Running analysis", thresholds: [25, 50, 75] });
  const { dispatchTask, isDispatching } = useDispatchTask();

  /* ---------- Analysis plans (Realtime) ---------- */
  const { plans, results, isLoading: plansLoading } = useAnalysisResults(datasetId);

  /* ---------- UI state ---------- */
  const [expandedRQs, setExpandedRQs] = useState<Set<string>>(new Set());
  const [showAutoApproveConfirm, setShowAutoApproveConfirm] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [updatingPlanIds, setUpdatingPlanIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("statistical");
  const [showCustomTestForm, setShowCustomTestForm] = useState(false);
  const [customTestForm, setCustomTestForm] = useState({
    rqText: "",
    depVar: "",
    indepVar: "",
    testType: "linear_regression" as string,
    controlVars: "",
  });
  const [isAddingCustom, setIsAddingCustom] = useState(false);

  /* ---------- Auto-generate plan on first load ---------- */
  const autoGenerateDispatched = useRef(false);
  const planIsRunning =
    planProgress.status === "running" ||
    planProgress.status === "claimed" ||
    planProgress.status === "pending";
  useEffect(() => {
    if (
      !datasetId ||
      plansLoading ||
      plans.length > 0 ||
      planIsRunning ||
      planTaskId !== null ||
      autoGenerateDispatched.current
    ) return;
    autoGenerateDispatched.current = true;
    dispatchTask(
      projectId,
      "generate_analysis_plan",
      { dataset_id: datasetId, project_id: projectId },
      datasetId,
    )
      .then(({ taskId }) => setPlanTaskId(taskId))
      .catch(() => {
        // Will show retry button if needed
        autoGenerateDispatched.current = false;
      });
  }, [datasetId, plansLoading, plans.length, planIsRunning, planTaskId, projectId, dispatchTask]);

  /* ---------- Auto-run analysis once plans are ready ---------- */
  const autoRunDispatched = useRef(false);
  const analysisIsRunning =
    analysisProgress.status === "running" ||
    analysisProgress.status === "claimed" ||
    analysisProgress.status === "pending";

  useEffect(() => {
    // Fire once: when plans exist, none are already completed, and analysis isn't running
    if (
      !datasetId ||
      plansLoading ||
      plans.length === 0 ||
      analysisIsRunning ||
      analysisTaskId !== null ||
      autoRunDispatched.current ||
      plans.every((p) => p.status === "completed")
    ) return;

    // Auto-approve all planned items then run analysis
    autoRunDispatched.current = true;
    const approveAndRun = async () => {
      try {
        // Approve all planned items
        const planned = plans.filter((p) => p.status === "planned");
        if (planned.length > 0) {
          await supabase
            .from("analysis_plans")
            // @ts-ignore
            .update({ status: "approved" })
            .in("id", planned.map((p) => p.id));
        }
        const { taskId } = await dispatchTask(
          projectId,
          "run_analysis",
          { dataset_id: datasetId, project_id: projectId },
          datasetId,
        );
        setAnalysisTaskId(taskId);
      } catch {
        autoRunDispatched.current = false;
      }
    };
    approveAndRun();
  }, [datasetId, plansLoading, plans, analysisIsRunning, analysisTaskId, projectId, dispatchTask, supabase]);

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
  const allCompleted = plans.length > 0 && plans.every((p) => p.status === "completed");

  /* ---------- Summary Insights derived state ---------- */
  const significantCount = useMemo(
    () => results.filter((r) => r.p_value !== null && r.p_value < 0.05).length,
    [results],
  );

  interface ResultWithPlan {
    result: Tables<"analysis_results">;
    plan: Tables<"analysis_plans">;
  }
  interface RQGroup {
    rqText: string;
    items: ResultWithPlan[];
  }

  const insightGroupedResults = useMemo((): RQGroup[] => {
    const planMap = new Map(plans.map((p) => [p.id, p]));
    const groups = new Map<string, ResultWithPlan[]>();
    for (const r of results) {
      const plan = planMap.get(r.plan_id);
      if (!plan) continue;
      const key = plan.research_question_text ?? "Ungrouped analyses";
      const items = groups.get(key) ?? [];
      items.push({ result: r, plan });
      groups.set(key, items);
    }
    return Array.from(groups.entries()).map(([rqText, items]) => ({ rqText, items }));
  }, [plans, results]);

  const rqTrafficLights = useMemo((): Map<string, "green" | "yellow" | "red"> => {
    const map = new Map<string, "green" | "yellow" | "red">();
    for (const group of insightGroupedResults) {
      const total = group.items.length;
      const sig = group.items.filter((i) => i.result.p_value !== null && i.result.p_value < 0.05).length;
      if (sig === total && total > 0) map.set(group.rqText, "green");
      else if (sig > 0) map.set(group.rqText, "yellow");
      else map.set(group.rqText, "red");
    }
    return map;
  }, [insightGroupedResults]);

  /* ---------- Handlers ---------- */

  const handleGeneratePlan = useCallback(async () => {
    if (!datasetId) return;
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_analysis_plan",
        { dataset_id: datasetId, project_id: projectId },
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
        { dataset_id: datasetId, project_id: projectId },
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
                status: "approved" as const,
                approved_by: user?.id ?? null,
                approved_at: new Date().toISOString(),
              }
            : {
                status: "rejected" as const,
                approved_by: null as null,
                approved_at: null as null,
              };

        const { error } = await supabase
          .from("analysis_plans")
          // @ts-expect-error — supabase update type inference
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
          // @ts-expect-error — supabase update type inference
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
        { dataset_id: datasetId, project_id: projectId },
        datasetId,
      );

      // Update pipeline status
      const pipelineStatus: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "6": "completed",
        "7": "active",
      };

      await supabase
        .from("projects")
        // @ts-expect-error — supabase update type inference
        .update({
          current_step: 7,
          pipeline_status: pipelineStatus as unknown as Json,
        })
        .eq("id", projectId);

      toast("Analysis running. View progress in step bar.", {
        variant: "success",
      });

      router.refresh();
      router.push(`/projects/${projectId}/step/7`);
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

  /** Add a custom analysis plan directly */
  const handleAddCustomTest = useCallback(async () => {
    if (!datasetId || !customTestForm.depVar || !customTestForm.indepVar) return;
    setIsAddingCustom(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const controlVars = customTestForm.controlVars
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      const { error } = await supabase
        .from("analysis_plans")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({
          project_id: projectId,
          dataset_id: datasetId,
          created_by: user?.id ?? null,
          research_question_id: "custom",
          research_question_text: customTestForm.rqText || `${customTestForm.testType}: ${customTestForm.depVar} ← ${customTestForm.indepVar}`,
          dependent_variable: customTestForm.depVar,
          independent_variable: customTestForm.indepVar,
          control_variables: controlVars,
          selected_test: customTestForm.testType,
          status: "approved",
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
        } as never);

      if (!error) {
        setShowCustomTestForm(false);
        setCustomTestForm({ rqText: "", depVar: "", indepVar: "", testType: "linear_regression", controlVars: "" });
        toast("Custom test added and approved", { variant: "success" });
      } else {
        toast(`Failed to add test: ${error.message}`, { variant: "error" });
      }
    } finally {
      setIsAddingCustom(false);
    }
  }, [datasetId, projectId, customTestForm, supabase]);

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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="descriptive">Descriptive</TabsTrigger>
          <TabsTrigger value="statistical">Statistical Tests</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/*  TAB: Descriptive Analysis                                    */}
        {/* ============================================================ */}
        <TabsContent value="descriptive">
          <DescriptiveTab edaResults={edaResults} />
        </TabsContent>

        {/* ============================================================ */}
        {/*  TAB: Statistical Tests (existing content)                    */}
        {/* ============================================================ */}
        <TabsContent value="statistical">
          <div className="space-y-6 pt-2">
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

            {/* Add Custom Test */}
            {true && (
              <div className="pt-2">
                {!showCustomTestForm ? (
                  <button
                    type="button"
                    onClick={() => setShowCustomTestForm(true)}
                    className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Add custom analysis (e.g. linear regression)
                  </button>
                ) : (
                  <Card className="border-purple-200 bg-purple-50/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        Add Custom Statistical Test
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Test Type</label>
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                            value={customTestForm.testType}
                            onChange={(e) => setCustomTestForm(f => ({...f, testType: e.target.value}))}
                          >
                            <option value="linear_regression">Linear Regression (OLS)</option>
                            <option value="logistic_regression">Logistic Regression</option>
                            <option value="moderation_analysis">Moderation Analysis</option>
                            <option value="mediation_analysis">Mediation Analysis</option>
                            <option value="pearson">Pearson Correlation</option>
                            <option value="spearman">Spearman Correlation</option>
                            <option value="kendall_tau">Kendall Tau</option>
                            <option value="point_biserial">Point-Biserial Correlation</option>
                            <option value="t_test">Independent t-test</option>
                            <option value="welchs_t">Welch t-test</option>
                            <option value="anova">One-Way ANOVA</option>
                            <option value="mann_whitney">Mann-Whitney U</option>
                            <option value="kruskal_wallis">Kruskal-Wallis</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Outcome Variable</label>
                          <input
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                            placeholder="e.g. JobSatisfaction"
                            value={customTestForm.depVar}
                            onChange={(e) => setCustomTestForm(f => ({...f, depVar: e.target.value}))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Predictor Variable</label>
                          <input
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                            placeholder="e.g. WLB"
                            value={customTestForm.indepVar}
                            onChange={(e) => setCustomTestForm(f => ({...f, indepVar: e.target.value}))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            Control Variables <span className="font-normal">(comma-separated, optional)</span>
                          </label>
                          <input
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                            placeholder="e.g. Workload, Stress"
                            value={customTestForm.controlVars}
                            onChange={(e) => setCustomTestForm(f => ({...f, controlVars: e.target.value}))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Research Question (optional)</label>
                        <input
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                          placeholder="e.g. Does WLB predict job satisfaction controlling for workload?"
                          value={customTestForm.rqText}
                          onChange={(e) => setCustomTestForm(f => ({...f, rqText: e.target.value}))}
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={handleAddCustomTest}
                          disabled={isAddingCustom || !customTestForm.depVar || !customTestForm.indepVar}
                        >
                          {isAddingCustom ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                          Add & Approve Test
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowCustomTestForm(false)}>
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Summary Insights — visible when analysis results exist */}
            {results.length > 0 && (
              <Card className="border-blue-200 bg-blue-50/50">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    Summary Insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Significance counts */}
                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium">{significantCount} significant</span>
                      <span className="text-xs text-muted-foreground">(p &lt; 0.05)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MinusCircle className="h-4 w-4 text-gray-400" />
                      <span className="text-sm font-medium">{results.length - significantCount} non-significant</span>
                    </div>
                  </div>

                  {/* Per-RQ traffic lights */}
                  {insightGroupedResults.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence per research question</p>
                      <div className="space-y-1.5">
                        {insightGroupedResults.map((group) => {
                          const light = rqTrafficLights.get(group.rqText) ?? "red";
                          return (
                            <div key={group.rqText} className="flex items-start gap-2">
                              {light === "green" && <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />}
                              {light === "yellow" && <MinusCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500" />}
                              {light === "red" && <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />}
                              <p className="text-sm text-muted-foreground line-clamp-1">{group.rqText}</p>
                              <Badge
                                className={`ml-auto flex-shrink-0 text-xs ${
                                  light === "green" ? "bg-green-100 text-green-800" :
                                  light === "yellow" ? "bg-yellow-100 text-yellow-800" :
                                  "bg-red-100 text-red-800"
                                }`}
                              >
                                {light === "green" ? "Evidence found" : light === "yellow" ? "Mixed" : "No evidence"}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Key predictors from regression results */}
                  {results.some((r) => {
                    const raw = r.raw_output as Record<string, unknown> | null;
                    const details = raw?.test_details as Record<string, unknown> | null;
                    return details && typeof details === "object" && "coefficients" in details;
                  }) && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key regression predictors</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="pb-1 pr-4 font-medium">Variable</th>
                              <th className="pb-1 pr-4 font-medium">Coefficient</th>
                              <th className="pb-1 font-medium">p-value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.flatMap((r) => {
                              const raw = r.raw_output as Record<string, unknown> | null;
                              const details = raw?.test_details as Record<string, unknown> | null;
                              if (!details || !("coefficients" in details)) return [];
                              const coeffs = details.coefficients as Record<string, { estimate: number; p_value: number }>;
                              return Object.entries(coeffs)
                                .filter(([k]) => k !== "const")
                                .slice(0, 3)
                                .map(([varName, c]) => (
                                  <tr key={`${r.id}-${varName}`} className="border-b last:border-0">
                                    <td className="py-1 pr-4 font-medium">{varName}</td>
                                    <td className="py-1 pr-4">{c.estimate > 0 ? "+" : ""}{c.estimate.toFixed(3)}</td>
                                    <td className={`py-1 ${c.p_value < 0.05 ? "font-semibold text-green-700" : "text-muted-foreground"}`}>
                                      {c.p_value < 0.001 ? "<0.001" : c.p_value.toFixed(3)}
                                      {c.p_value < 0.05 && " *"}
                                    </td>
                                  </tr>
                                ));
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Continue to Visualisation — visible when all plans completed */}
            {allCompleted && (
              <div className="flex justify-end border-t pt-4 mt-4">
                <Button onClick={() => { router.refresh(); router.push(`/projects/${projectId}/step/7`); }}>
                  Continue to Visualisation
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ============================================================ */}
        {/*  TAB: Diagnostics                                             */}
        {/* ============================================================ */}
        <TabsContent value="diagnostics">
          <DiagnosticsTab edaResults={edaResults} />
        </TabsContent>
      </Tabs>
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

/* ------------------------------------------------------------------ */
/*  Profile helpers                                                    */
/* ------------------------------------------------------------------ */

function getProfile(eda: EDAResult): Record<string, unknown> {
  if (!eda.profile || typeof eda.profile !== "object" || Array.isArray(eda.profile)) return {};
  return eda.profile as Record<string, unknown>;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: unknown, decimals = 2): string {
  const n = num(v);
  return n === null ? "—" : n.toFixed(decimals);
}

function pct(v: unknown): string {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(1)}%`;
}

function qualityColor(score: number | null): string {
  if (score === null) return "bg-gray-100 text-gray-600";
  if (score >= 80) return "bg-green-100 text-green-800";
  if (score >= 60) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

function qualityBarColor(score: number | null): string {
  if (score === null) return "bg-gray-300";
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function missingStatus(missingPct: number): { label: string; cls: string } {
  if (missingPct < 5) return { label: "OK", cls: "text-green-600" };
  if (missingPct <= 15) return { label: "Warning", cls: "text-yellow-600" };
  return { label: "Critical", cls: "text-red-600" };
}

/* ------------------------------------------------------------------ */
/*  Descriptive Analysis Tab                                           */
/* ------------------------------------------------------------------ */

function DescriptiveTab({ edaResults }: { edaResults: EDAResult[] }) {
  if (edaResults.length === 0) {
    return (
      <Card className="mt-4 border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Info className="mb-4 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Quality analysis not yet run — complete Step 4 first
          </p>
        </CardContent>
      </Card>
    );
  }

  const outcomes = edaResults.filter((e) => e.column_role === "outcome");
  const demographics = edaResults.filter((e) => e.column_role === "demographic");
  const covariates = edaResults.filter((e) => e.column_role === "covariate");

  const avgQuality =
    edaResults.reduce((sum, e) => sum + (e.quality_score ?? 0), 0) / edaResults.length;

  return (
    <div className="space-y-6 pt-2">
      {/* Dataset summary card */}
      <Card>
        <CardContent className="flex flex-wrap gap-6 p-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Total columns</p>
            <p className="text-lg font-semibold">{edaResults.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Outcome variables</p>
            <p className="text-lg font-semibold">{outcomes.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Demographics</p>
            <p className="text-lg font-semibold">{demographics.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Covariates</p>
            <p className="text-lg font-semibold">{covariates.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Avg quality score</p>
            <p className="text-lg font-semibold">
              <Badge className={qualityColor(avgQuality)}>{avgQuality.toFixed(0)}</Badge>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Outcome variables — detailed cards */}
      {outcomes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Outcome Variables
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {outcomes.map((eda) => (
              <OutcomeCard key={eda.id} eda={eda} />
            ))}
          </div>
        </div>
      )}

      {/* Demographic variables — summary table */}
      {demographics.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Demographic Variables
          </h3>
          <RoleSummaryTable items={demographics} />
        </div>
      )}

      {/* Covariate variables — summary table */}
      {covariates.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Covariate Variables
          </h3>
          <RoleSummaryTable items={covariates} />
        </div>
      )}
    </div>
  );
}

/* ---- Outcome card (detailed) ---- */

function OutcomeCard({ eda }: { eda: EDAResult }) {
  const p = getProfile(eda);
  const isContinuous = eda.data_type === "continuous";
  const isLikert = eda.data_type === "likert";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{eda.column_name}</CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-xs">{eda.data_type}</Badge>
            <Badge className={`text-xs ${qualityColor(eda.quality_score)}`}>
              {eda.quality_score ?? "—"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="text-xs space-y-2">
        {isContinuous ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Mean +/- Std</span>
            <span>{fmt(p.mean)} +/- {fmt(p.std)}</span>
            <span className="text-muted-foreground">Median</span>
            <span>{fmt(p.median)}</span>
            <span className="text-muted-foreground">Range</span>
            <span>[{fmt(p.min)} — {fmt(p.max)}]</span>
            <span className="text-muted-foreground">n</span>
            <span>{num(p.numeric_count) ?? "—"}</span>
            <span className="text-muted-foreground">Missing</span>
            <span>{pct(p.missing_pct)}</span>
          </div>
        ) : (
          <FrequencyList profile={p} isLikert={isLikert} />
        )}
      </CardContent>
    </Card>
  );
}

/* ---- Frequency list for categorical / likert ---- */

function FrequencyList({
  profile,
  isLikert,
}: {
  profile: Record<string, unknown>;
  isLikert: boolean;
}) {
  const freqRaw = isLikert
    ? (profile.frequency_table as Record<string, unknown> | undefined)
    : (profile.frequency_table_top10 as Record<string, unknown> | undefined) ??
      (profile.frequency_table as Record<string, unknown> | undefined);

  if (!freqRaw || typeof freqRaw !== "object") {
    return <p className="text-muted-foreground">No frequency data</p>;
  }

  const entries = Object.entries(freqRaw)
    .map(([value, stats]) => {
      const s = stats as Record<string, unknown> | null;
      return {
        value,
        count: num(s?.count) ?? 0,
        pctVal: num(s?.pct) ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div className="space-y-1">
      {entries.map((e) => (
        <div key={e.value} className="flex items-center justify-between gap-2">
          <span className="truncate">{e.value}</span>
          <span className="shrink-0 text-muted-foreground">
            {e.count} ({e.pctVal.toFixed(1)}%)
          </span>
        </div>
      ))}
      {isLikert && (
        <p className="text-muted-foreground pt-1">Median: {fmt(profile.median)}</p>
      )}
    </div>
  );
}

/* ---- Summary table for demographics / covariates ---- */

function RoleSummaryTable({ items }: { items: EDAResult[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Column</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium text-right">n</th>
            <th className="px-3 py-2 font-medium">Key stat</th>
            <th className="px-3 py-2 font-medium text-right">Missing %</th>
          </tr>
        </thead>
        <tbody>
          {items.map((eda) => {
            const p = getProfile(eda);
            const isContinuous = eda.data_type === "continuous";
            const n = num(isContinuous ? p.numeric_count : p.non_null_count);
            const keyStat = isContinuous
              ? `mean ${fmt(p.mean)}, sd ${fmt(p.std)}`
              : `${num(p.n_unique) ?? "—"} unique`;
            const missingPctVal = num(p.missing_pct);
            return (
              <tr key={eda.id} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-medium">{eda.column_name}</td>
                <td className="px-3 py-1.5">
                  <Badge variant="outline" className="text-[10px]">{eda.data_type}</Badge>
                </td>
                <td className="px-3 py-1.5 text-right">{n ?? "—"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{keyStat}</td>
                <td className="px-3 py-1.5 text-right">{missingPctVal !== null ? `${missingPctVal.toFixed(1)}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diagnostics Tab                                                    */
/* ------------------------------------------------------------------ */

function DiagnosticsTab({ edaResults }: { edaResults: EDAResult[] }) {
  if (edaResults.length === 0) {
    return (
      <Card className="mt-4 border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Info className="mb-4 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Quality analysis not yet run — complete Step 4 first
          </p>
        </CardContent>
      </Card>
    );
  }

  // Missing data
  const missingRows = edaResults
    .map((eda) => {
      const p = getProfile(eda);
      return { eda, missingPct: num(p.missing_pct) ?? 0 };
    })
    .filter((r) => r.missingPct > 0)
    .sort((a, b) => b.missingPct - a.missingPct);

  // Outliers
  const outlierRows = edaResults
    .map((eda) => {
      const p = getProfile(eda);
      const outlierCount = num(p.outlier_count) ?? 0;
      const total = num(p.numeric_count) ?? num(p.non_null_count) ?? 0;
      const outlierPct = total > 0 ? (outlierCount / total) * 100 : 0;
      return { eda, outlierCount, outlierPct };
    })
    .filter((r) => r.outlierCount > 0)
    .sort((a, b) => b.outlierCount - a.outlierCount);

  // Quality scores sorted ascending (worst first)
  const qualitySorted = [...edaResults]
    .filter((e) => e.quality_score !== null)
    .sort((a, b) => (a.quality_score ?? 0) - (b.quality_score ?? 0));

  const noIssues = missingRows.length === 0 && outlierRows.length === 0;

  return (
    <div className="space-y-6 pt-2">
      {noIssues && qualitySorted.every((e) => (e.quality_score ?? 0) >= 80) && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-green-800">No data quality issues detected</p>
          </CardContent>
        </Card>
      )}

      {/* Missing Data */}
      {missingRows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Missing Data
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Column</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium text-right">Missing %</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {missingRows.map(({ eda, missingPct }) => {
                  const status = missingStatus(missingPct);
                  return (
                    <tr key={eda.id} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-medium">{eda.column_name}</td>
                      <td className="px-3 py-1.5">{eda.column_role ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right">{missingPct.toFixed(1)}%</td>
                      <td className={`px-3 py-1.5 font-medium ${status.cls}`}>{status.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Outliers */}
      {outlierRows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Outliers
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Column</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium text-right">Outlier count</th>
                  <th className="px-3 py-2 font-medium text-right">% of data</th>
                </tr>
              </thead>
              <tbody>
                {outlierRows.map(({ eda, outlierCount, outlierPct }) => (
                  <tr key={eda.id} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">{eda.column_name}</td>
                    <td className="px-3 py-1.5">{eda.column_role ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right">{outlierCount}</td>
                    <td className="px-3 py-1.5 text-right">{outlierPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Quality Overview */}
      {qualitySorted.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Data Quality Overview
          </h3>
          <div className="space-y-2">
            {qualitySorted.map((eda) => {
              const score = eda.quality_score ?? 0;
              return (
                <div key={eda.id} className="flex items-center gap-3">
                  <span className="w-36 truncate text-xs font-medium">{eda.column_name}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${qualityBarColor(eda.quality_score)}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs font-medium">{score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
