"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useAnalysisResults } from "@/hooks/useAnalysisResults";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { LoadingSkeleton } from "@/components/workflow/LoadingSkeleton";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Shield,
  TrendingUp,
  XCircle,
  MinusCircle,
  RefreshCw,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Cell,
  ErrorBar,
} from "recharts";
import { toast } from "@/lib/toast";
import type { Tables, Json } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Project = Tables<"projects">;
type Dataset = Tables<"datasets">;
type AnalysisPlan = Tables<"analysis_plans">;
type AnalysisResult = Tables<"analysis_results">;
type Chart = Tables<"charts">;
type PipelineStatus = Record<string, string>;

interface Step6ResultsProps {
  project: Project;
  dataset: Dataset | null;
  initialRunningTaskId: string | null;
}

interface ResultWithPlan {
  result: AnalysisResult;
  plan: AnalysisPlan;
  chart: Chart | null;
}

interface RQGroup {
  rqText: string;
  items: ResultWithPlan[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTestName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function pValueColor(p: number | null): string {
  if (p === null) return "text-gray-500";
  if (p < 0.05) return "text-green-600";
  if (p < 0.1) return "text-yellow-600";
  return "text-gray-500";
}

function effectSizeMagnitude(
  value: number,
  name: string,
): { label: string; className: string } {
  const abs = Math.abs(value);
  const lower = name.toLowerCase();

  // Cohen's d
  if (lower.includes("cohen") && lower.includes("d")) {
    if (abs >= 0.8) return { label: "Large", className: "bg-red-100 text-red-800" };
    if (abs >= 0.5) return { label: "Medium", className: "bg-yellow-100 text-yellow-800" };
    return { label: "Small", className: "bg-blue-100 text-blue-800" };
  }

  // Eta-squared
  if (lower.includes("eta") || lower.includes("η")) {
    if (abs >= 0.14) return { label: "Large", className: "bg-red-100 text-red-800" };
    if (abs >= 0.06) return { label: "Medium", className: "bg-yellow-100 text-yellow-800" };
    return { label: "Small", className: "bg-blue-100 text-blue-800" };
  }

  // r / Cramér's V
  if (abs >= 0.5) return { label: "Large", className: "bg-red-100 text-red-800" };
  if (abs >= 0.3) return { label: "Medium", className: "bg-yellow-100 text-yellow-800" };
  return { label: "Small", className: "bg-blue-100 text-blue-800" };
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function Step6Results({
  project,
  dataset,
  initialRunningTaskId,
}: Step6ResultsProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const projectId = project.id;
  const datasetId = dataset?.id ?? null;

  /* ---------- Task tracking ---------- */
  const [taskId] = useState<string | null>(initialRunningTaskId);
  const taskProgress = useTaskProgress(taskId);
  const { dispatchTask } = useDispatchTask();
  const [rerunningTestIds, setRerunningTestIds] = useState<Set<string>>(new Set());
  const RESULTS_PER_PAGE = 5;
  const [expandedRQs, setExpandedRQs] = useState<Set<string>>(new Set());

  /* ---------- Analysis data ---------- */
  const { plans, results, isLoading } = useAnalysisResults(datasetId);

  /* ---------- Charts ---------- */
  const [charts, setCharts] = useState<Chart[]>([]);
  const [chartUrls, setChartUrls] = useState<Record<string, string>>({});

  /* ---------- UI state ---------- */
  const [includedIds, setIncludedIds] = useState<Set<string> | null>(null);
  const [editingInterpretations, setEditingInterpretations] = useState<
    Record<string, string>
  >({});
  const [expandedAssumptions, setExpandedAssumptions] = useState<Set<string>>(
    new Set(),
  );
  const [isAdvancing, setIsAdvancing] = useState(false);

  /* ---------- Derived ---------- */
  const isRunning =
    taskProgress.status === "running" ||
    taskProgress.status === "claimed" ||
    taskProgress.status === "pending";

  const included = includedIds ?? new Set(results.map((r) => r.id));

  /* ---------- Fetch charts ---------- */
  useEffect(() => {
    if (results.length === 0) return;

    const resultIds = results.map((r) => r.id);
    let cancelled = false;

    (async () => {
      // @ts-ignore — supabase select type inference
      const { data: chartsRaw } = await supabase
        .from("charts")
        .select("*")
        .in("analysis_result_id", resultIds);

      const data = chartsRaw as Chart[] | null;
      if (cancelled || !data) return;
      setCharts(data);

      const urls: Record<string, string> = {};
      for (const chart of data) {
        if (chart.file_path) {
          const { data: urlData } = await supabase.storage
            .from("charts")
            .createSignedUrl(chart.file_path, 3600);
          if (urlData?.signedUrl) {
            urls[chart.id] = urlData.signedUrl;
          }
        }
      }
      if (!cancelled) setChartUrls(urls);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  /* ---------- Default all results included ---------- */
  useEffect(() => {
    if (results.length > 0 && includedIds === null) {
      setIncludedIds(new Set(results.map((r) => r.id)));
    }
  }, [results, includedIds]);

  /* ---------- Group results by RQ ---------- */
  const groupedResults = useMemo((): RQGroup[] => {
    const planMap = new Map(plans.map((p) => [p.id, p]));
    const chartMap = new Map<string, Chart>();
    for (const chart of charts) {
      if (chart.analysis_result_id) {
        chartMap.set(chart.analysis_result_id, chart);
      }
    }

    const groups = new Map<string, ResultWithPlan[]>();
    for (const result of results) {
      const plan = planMap.get(result.plan_id);
      if (!plan) continue;

      const key = plan.research_question_text ?? "Ungrouped analyses";
      const items = groups.get(key) ?? [];
      items.push({
        result,
        plan,
        chart: chartMap.get(result.id) ?? null,
      });
      groups.set(key, items);
    }

    return Array.from(groups.entries()).map(([rqText, items]) => ({
      rqText,
      items,
    }));
  }, [plans, results, charts]);

  const significantCount = useMemo(
    () =>
      results.filter((r) => r.p_value !== null && r.p_value < 0.05).length,
    [results],
  );

  /** Traffic light per RQ: green=significant found, yellow=mixed, red=none */
  const rqTrafficLights = useMemo((): Map<string, "green" | "yellow" | "red"> => {
    const map = new Map<string, "green" | "yellow" | "red">();
    for (const group of groupedResults) {
      const total = group.items.length;
      const sig = group.items.filter((i) => i.result.p_value !== null && i.result.p_value < 0.05).length;
      if (sig === total && total > 0) map.set(group.rqText, "green");
      else if (sig > 0) map.set(group.rqText, "yellow");
      else map.set(group.rqText, "red");
    }
    return map;
  }, [groupedResults]);

  /* ---------- Handlers ---------- */

  const handleToggleInclude = useCallback((resultId: string) => {
    setIncludedIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  }, []);

  const handleInterpretationChange = useCallback(
    (resultId: string, value: string) => {
      setEditingInterpretations((prev) => ({ ...prev, [resultId]: value }));
    },
    [],
  );

  const handleInterpretationBlur = useCallback(
    async (resultId: string) => {
      const value = editingInterpretations[resultId];
      if (value === undefined) return;

      const { error } = await supabase
        .from("analysis_results")
        // @ts-expect-error — supabase update type inference
        .update({ interpretation: value, interpretation_validated: true })
        .eq("id", resultId);

      if (error) {
        toast("Failed to save interpretation", { variant: "error" });
      } else {
        toast("Interpretation saved", { variant: "success" });
      }
    },
    [editingInterpretations, supabase],
  );

  const toggleAssumptions = useCallback((id: string) => {
    setExpandedAssumptions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRerunTest = useCallback(async (planId: string, resultId: string) => {
    if (!datasetId) return;
    setRerunningTestIds((prev) => new Set([...Array.from(prev), resultId]));
    try {
      // Re-approve the plan and dispatch a targeted analysis run
      const supabase = createBrowserClient();
      // @ts-ignore — supabase update type inference
      await supabase.from("analysis_plans").update({ status: "approved" }).eq("id", planId);
      await dispatchTask(project.id, "run_analysis", {
        dataset_id: datasetId,
        project_id: project.id,
        plan_ids: [planId],
        rerun: true,
      }, datasetId);
      toast("Test queued for re-run", { variant: "success" });
    } catch {
      toast("Failed to queue re-run", { variant: "error" });
    } finally {
      setRerunningTestIds((prev) => {
        const next = new Set(prev);
        next.delete(resultId);
        return next;
      });
    }
  }, [datasetId, project.id, dispatchTask]);

  const handleProceedToReport = useCallback(async () => {
    setIsAdvancing(true);
    try {
      const pipelineStatus: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "7": "completed",
      };

      await supabase
        .from("projects")
        // @ts-expect-error — supabase update type inference
        .update({
          current_step: 7,
          pipeline_status: pipelineStatus as unknown as Json,
        })
        .eq("id", projectId);

      router.refresh();
      router.push(`/projects/${projectId}/report`);
    } catch {
      toast("Failed to proceed", { variant: "error" });
    } finally {
      setIsAdvancing(false);
    }
  }, [project.pipeline_status, projectId, supabase, router]);

  /* ================================================================ */
  /*  Guards                                                           */
  /* ================================================================ */

  if (!dataset) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/50" />
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
  /*  Running state — analysis in progress                             */
  /* ================================================================ */

  if (isRunning && results.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <div>
                <p className="font-medium">
                  Running statistical tests...
                </p>
                <p className="text-sm text-muted-foreground">
                  {taskProgress.progressMessage ??
                    "This may take 1\u20133 minutes."}
                </p>
              </div>
            </div>
            <Progress value={taskProgress.progress} className="h-2" />
          </CardContent>
        </Card>
        <LoadingSkeleton type="card" count={3} />
      </div>
    );
  }

  /* ================================================================ */
  /*  Failed state                                                     */
  /* ================================================================ */

  if (taskProgress.status === "failed" && results.length === 0) {
    return (
      <Card className="border-red-200">
        <CardContent className="flex flex-col items-center py-8">
          <AlertCircle className="mb-3 h-10 w-10 text-red-500" />
          <p className="font-medium text-red-700">Analysis failed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {taskProgress.error ?? "An unexpected error occurred."}
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push(`/projects/${projectId}/step/6`)}
          >
            Return to Step 5
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ================================================================ */
  /*  Loading                                                          */
  /* ================================================================ */

  if (isLoading) {
    return <LoadingSkeleton type="card" count={3} />;
  }

  /* ================================================================ */
  /*  No results yet                                                   */
  /* ================================================================ */

  if (results.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="mb-1 font-medium">No results yet</p>
          <p className="text-sm text-muted-foreground">
            Go to Step 5 to run analysis.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push(`/projects/${projectId}/step/6`)}
          >
            Go to Step 5
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ================================================================ */
  /*  Main results view                                                */
  /* ================================================================ */

  return (
    <div className="space-y-6">
      {/* Still-running overlay */}
      {isRunning && results.length > 0 && (
        <Card className="border-blue-200">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm">
                {taskProgress.progressMessage ??
                  "Running additional tests..."}
              </span>
            </div>
            <Progress value={taskProgress.progress} className="h-1.5" />
          </CardContent>
        </Card>
      )}

      {/* Summary Insights Panel */}
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
            {groupedResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence per research question</p>
                <div className="space-y-1.5">
                  {groupedResults.map((group) => {
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

      {/* Results grouped by RQ */}
      {groupedResults.map((group) => {
        const isExpanded = expandedRQs.has(group.rqText);
        const visibleItems = isExpanded ? group.items : group.items.slice(0, RESULTS_PER_PAGE);
        const hasMore = group.items.length > RESULTS_PER_PAGE;
        return (
          <Card key={group.rqText}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-sm font-medium leading-snug flex-1">
                  {group.rqText}
                </CardTitle>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {group.items.length} test{group.items.length !== 1 ? "s" : ""}
                  {" · "}
                  {group.items.filter(({ result }) => (result.p_value ?? 1) < 0.05).length} significant
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {visibleItems.map(({ result, plan, chart }) => (
                <ResultCard
                  key={result.id}
                  result={result}
                  plan={plan}
                  chart={chart}
                  chartUrl={chart ? chartUrls[chart.id] : undefined}
                  isIncluded={included.has(result.id)}
                  interpretationValue={editingInterpretations[result.id]}
                  isAssumptionsExpanded={expandedAssumptions.has(result.id)}
                  onToggleInclude={() => handleToggleInclude(result.id)}
                  onInterpretationChange={(v) =>
                    handleInterpretationChange(result.id, v)
                  }
                  onInterpretationBlur={() =>
                    handleInterpretationBlur(result.id)
                  }
                  onToggleAssumptions={() => toggleAssumptions(result.id)}
                  onRerunTest={() => handleRerunTest(plan.id, result.id)}
                  isRerunning={rerunningTestIds.has(result.id)}
                />
              ))}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setExpandedRQs(prev => {
                    const next = new Set(prev);
                    if (isExpanded) next.delete(group.rqText);
                    else next.add(group.rqText);
                    return next;
                  })}
                  className="w-full rounded-lg border border-dashed py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  {isExpanded
                    ? `↑ Show fewer`
                    : `↓ Show ${group.items.length - RESULTS_PER_PAGE} more tests`}
                </button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Summary panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {groupedResults.map((group) => (
            <div key={group.rqText} className="text-sm">
              <span className="font-medium">{group.rqText}:</span>{" "}
              {group.items
                .map(({ result }) =>
                  result.p_value !== null && result.p_value < 0.05
                    ? "significant"
                    : "not significant",
                )
                .join(", ")}
            </div>
          ))}
          <Separator />
          <p className="text-sm font-medium">
            {significantCount} significant finding
            {significantCount !== 1 ? "s" : ""} out of {results.length}{" "}
            analys{results.length !== 1 ? "es" : "is"}
          </p>
        </CardContent>
      </Card>

      {/* Proceed button */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleProceedToReport}
          disabled={isAdvancing || isRunning}
        >
          {isAdvancing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="mr-2 h-4 w-4" />
          )}
          Proceed to Report
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ContingencyTable sub-component                                     */
/* ------------------------------------------------------------------ */

function ContingencyTable({
  contingencyTable,
  indepVar,
  depVar,
}: {
  contingencyTable: Record<string, Record<string, number>>;
  indepVar: string;
  depVar: string;
}) {
  const depCategories = Object.keys(contingencyTable);
  if (depCategories.length === 0) return null;
  const indepCategories = Object.keys(contingencyTable[depCategories[0]] ?? {});

  // Compute row totals
  const rowTotals: Record<string, number> = {};
  for (const row of indepCategories) {
    rowTotals[row] = depCategories.reduce(
      (sum, col) => sum + (contingencyTable[col]?.[row] ?? 0),
      0,
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-2 text-left font-medium text-muted-foreground">
              {indepVar} \ {depVar}
            </th>
            {depCategories.map((col) => (
              <th key={col} className="p-2 text-right font-medium text-muted-foreground">
                {String(col)}
              </th>
            ))}
            <th className="p-2 text-right font-medium text-muted-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          {indepCategories.map((row) => {
            const total = rowTotals[row] ?? 1;
            return (
              <tr key={row} className="border-b last:border-0">
                <td className="p-2 font-medium">{String(row)}</td>
                {depCategories.map((col) => {
                  const count = contingencyTable[col]?.[row] ?? 0;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <td key={col} className="p-2 text-right tabular-nums">
                      {count}{" "}
                      <span className="text-muted-foreground">({pct}%)</span>
                    </td>
                  );
                })}
                <td className="p-2 text-right font-medium tabular-nums">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ResultChart sub-component                                          */
/* ------------------------------------------------------------------ */

const CHART_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16",
];

function ResultChart({
  result,
  plan,
  chartUrl,
  chartTitle,
}: {
  result: AnalysisResult;
  plan: AnalysisPlan;
  chartUrl?: string;
  chartTitle?: string;
}) {
  const raw = result.raw_output as Record<string, unknown> | null;
  const chartData = raw?.chart_data as Record<string, unknown> | null;
  const testName = result.test_name;
  const indepVar = plan.independent_variable;
  const depVar = plan.dependent_variable;
  const pValue = result.p_value;

  // Categorical tests — contingency table bar chart + pivot table
  if (
    (testName === "chi_square" || testName === "fishers_exact" || testName === "chi-square") &&
    chartData?.contingency_table
  ) {
    const ct = chartData.contingency_table as Record<string, Record<string, number>>;
    const depCategories = Object.keys(ct);
    const indepCategories = Object.keys(ct[depCategories[0]] ?? {});

    const barData = indepCategories.map((row) => {
      const entry: Record<string, string | number> = { name: String(row) };
      for (const col of depCategories) {
        entry[String(col)] = ct[col]?.[row] ?? 0;
      }
      return entry;
    });

    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border bg-white p-4">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {depCategories.map((col, i) => (
                <Bar
                  key={col}
                  dataKey={String(col)}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.6}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {pValue !== null && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              p = {pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}
            </p>
          )}
        </div>
        <ContingencyTable contingencyTable={ct} indepVar={indepVar} depVar={depVar} />
      </div>
    );
  }

  // Group comparison tests — bar chart with mean + std error bars
  if (
    (testName === "t_test" || testName === "mann_whitney" || testName === "welchs_t" ||
     testName === "anova" || testName === "kruskal_wallis") &&
    chartData?.group_stats
  ) {
    const gs = chartData.group_stats as Record<string, { mean: number; median: number; std: number; n: number }>;
    const barData = Object.entries(gs).map(([group, s]) => ({
      name: String(group),
      mean: s.mean,
      std: s.std,
      n: s.n,
      errorY: [s.std, s.std],
    }));

    return (
      <div className="overflow-hidden rounded-lg border bg-white p-4">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={barData}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} label={{ value: indepVar, position: "insideBottom", offset: -2, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: depVar, angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === "mean") return [value.toFixed(2), "Mean"];
                return [value, name];
              }}
            />
            <Bar dataKey="mean" fill="#3b82f6" fillOpacity={0.6} name="Mean">
              <ErrorBar dataKey="errorY" width={4} strokeWidth={1.5} stroke="#1e40af" />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        {pValue !== null && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            p = {pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}
          </p>
        )}
      </div>
    );
  }

  // Correlation — scatter chart
  if (
    (testName === "pearson" || testName === "spearman" || testName === "kendall_tau") &&
    chartData?.scatter_sample
  ) {
    const scatter = chartData.scatter_sample as { x: number; y: number }[];

    return (
      <div className="overflow-hidden rounded-lg border bg-white p-4">
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis type="number" dataKey="x" name={indepVar} tick={{ fontSize: 11 }} label={{ value: indepVar, position: "insideBottom", offset: -2, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name={depVar} tick={{ fontSize: 11 }} label={{ value: depVar, angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={scatter} fill="#3b82f6" fillOpacity={0.6} r={3} />
          </ScatterChart>
        </ResponsiveContainer>
        {pValue !== null && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            p = {pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}
            {" · "}r = {result.test_statistic?.toFixed(3) ?? "N/A"}
          </p>
        )}
      </div>
    );
  }

  // Linear regression — scatter + regression line
  if (testName === "linear_regression" && chartData?.scatter_sample) {
    const scatter = chartData.scatter_sample as { x: number; y: number }[];
    const regLine = chartData.regression_line as { slope: number; intercept: number } | null;

    // Build line points from min/max x
    let lineData: { x: number; y: number }[] = [];
    if (regLine && scatter.length > 0) {
      const xs = scatter.map((p) => p.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      lineData = [
        { x: minX, y: regLine.slope * minX + regLine.intercept },
        { x: maxX, y: regLine.slope * maxX + regLine.intercept },
      ];
    }

    return (
      <div className="overflow-hidden rounded-lg border bg-white p-4">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis type="number" dataKey="x" name={indepVar} tick={{ fontSize: 11 }} label={{ value: indepVar, position: "insideBottom", offset: -2, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name={depVar} tick={{ fontSize: 11 }} label={{ value: depVar, angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip />
            <Scatter data={scatter} fill="#3b82f6" fillOpacity={0.5} r={3} />
            {lineData.length > 0 && (
              <Line data={lineData} dataKey="y" stroke="#ef4444" strokeWidth={2} dot={false} type="linear" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {pValue !== null && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            p = {pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}
            {regLine && ` · y = ${regLine.slope.toFixed(3)}x + ${regLine.intercept.toFixed(3)}`}
          </p>
        )}
      </div>
    );
  }

  // Fallback: show PNG image if available
  if (chartUrl) {
    return (
      <div className="overflow-hidden rounded-lg border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={chartUrl}
          alt={chartTitle ?? "Result chart"}
          className="max-h-64 w-full object-contain"
        />
      </div>
    );
  }

  // No chart data and no PNG
  if (!chartData && !chartUrl) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed bg-muted/30 py-8">
        <p className="text-xs text-muted-foreground">Chart will be generated with report</p>
      </div>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  ResultCard sub-component                                           */
/* ------------------------------------------------------------------ */

interface ResultCardProps {
  result: AnalysisResult;
  plan: AnalysisPlan;
  chart: Chart | null;
  chartUrl?: string;
  isIncluded: boolean;
  interpretationValue?: string;
  isAssumptionsExpanded: boolean;
  onToggleInclude: () => void;
  onInterpretationChange: (value: string) => void;
  onInterpretationBlur: () => void;
  onToggleAssumptions: () => void;
  onRerunTest?: () => void;
  isRerunning?: boolean;
}

function ResultCard({
  result,
  plan,
  chart,
  chartUrl,
  isIncluded,
  interpretationValue,
  isAssumptionsExpanded,
  onToggleInclude,
  onInterpretationChange,
  onInterpretationBlur,
  onToggleAssumptions,
  onRerunTest,
  isRerunning = false,
}: ResultCardProps) {
  const magnitude = effectSizeMagnitude(
    result.effect_size_value,
    result.effect_size_name,
  );
  const limitations = Array.isArray(result.limitations)
    ? (result.limitations as string[])
    : [];

  return (
    <div className="rounded-lg border p-4 space-y-4">
      {/* Header: variables + test badge */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {plan.dependent_variable}{" "}
          <span className="text-muted-foreground">&times;</span>{" "}
          {plan.independent_variable}
        </span>
        <Badge variant="outline">{formatTestName(result.test_name)}</Badge>
        {result.fallback_used && (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-amber-800 hover:bg-amber-100"
          >
            fallback
          </Badge>
        )}
      </div>

      {/* Key stats row */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {result.test_statistic !== null && (
          <div>
            <span className="text-muted-foreground">Statistic: </span>
            <span className="font-mono font-medium">
              {result.test_statistic.toFixed(3)}
            </span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">p-value: </span>
          <span
            className={`font-mono font-medium ${pValueColor(result.p_value)}`}
          >
            {result.p_value !== null
              ? result.p_value < 0.001
                ? "< 0.001"
                : result.p_value.toFixed(4)
              : "N/A"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">
            {result.effect_size_name}:
          </span>
          <span className="font-mono font-medium">
            {result.effect_size_value.toFixed(3)}
          </span>
          <Badge
            className={`text-xs ${magnitude.className} hover:${magnitude.className}`}
          >
            {magnitude.label}
          </Badge>
        </div>
        <div>
          <span className="text-muted-foreground">n = </span>
          <span className="font-mono">{result.sample_size}</span>
        </div>
        {/* Confidence interval */}
        {result.confidence_interval && (() => {
          const ci = result.confidence_interval as Record<string, number | string> | null;
          if (!ci) return null;
          const lower = typeof ci.lower === 'number' ? ci.lower.toFixed(3) : '?';
          const upper = typeof ci.upper === 'number' ? ci.upper.toFixed(3) : '?';
          const metric = ci.metric as string || '';
          return (
            <div title={`95% CI for ${metric}`}>
              <span className="text-muted-foreground">95% CI: </span>
              <span className="font-mono text-xs">[{lower}, {upper}]</span>
            </div>
          );
        })()}
      </div>

      {/* Assumption warnings */}
      {result.raw_output && (() => {
        const raw = result.raw_output as Record<string, unknown> | null;
        const assump = raw?.assumptions_checked as Record<string, unknown> | null;
        if (!assump) return null;
        const warnings: string[] = [];
        if (assump.normality_passed === false) warnings.push("Normality assumption violated — consider non-parametric test");
        if (assump.equal_variance_passed === false) warnings.push("Unequal variances detected (Levene p < 0.05) — Welch correction applied");
        if (assump.homogeneity_passed === false) warnings.push("Heterogeneity of variance (Levene p < 0.05) — interpret F-statistic cautiously");
        if (typeof assump.low_expected_cells_pct === 'number' && assump.low_expected_cells_pct > 0.2) warnings.push(`${Math.round((assump.low_expected_cells_pct as number) * 100)}% of expected cells < 5 — χ² may be unreliable`);
        if (warnings.length === 0) return null;
        return (
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-700">
                <span className="mt-0.5 flex-shrink-0">⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Missing data warning */}
      {typeof result.missing_data_rate === 'number' && result.missing_data_rate > 0.15 && (
        <div className="flex items-start gap-1.5 text-xs text-orange-700">
          <span className="mt-0.5 flex-shrink-0">⚠</span>
          <span>{Math.round(result.missing_data_rate * 100)}% missing data on outcome — interpret with caution</span>
        </div>
      )}

      {/* Chart */}
      <ResultChart
        result={result}
        plan={plan}
        chartUrl={chartUrl}
        chartTitle={chart?.title ?? undefined}
      />

      {/* AI Interpretation */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Pencil className="h-3 w-3" />
          AI-generated &mdash; click to edit
        </div>
        <textarea
          className="w-full rounded-md border bg-muted/30 p-3 text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          rows={3}
          value={interpretationValue ?? result.interpretation ?? ""}
          onChange={(e) => onInterpretationChange(e.target.value)}
          onBlur={onInterpretationBlur}
        />
      </div>

      {/* Limitations */}
      {limitations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Limitations
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {limitations.map((lim, i) => (
              <li key={i}>{String(lim)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Missing data */}
      {result.missing_data_rate > 0 && (
        <p className="text-xs text-muted-foreground">
          Missing: {(result.missing_data_rate * 100).toFixed(1)}% of
          observations
        </p>
      )}

      {/* Expandable: Assumption checks */}
      <Collapsible
        open={isAssumptionsExpanded}
        onOpenChange={onToggleAssumptions}
      >
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {isAssumptionsExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Shield className="mr-0.5 h-3 w-3" />
          Assumption checks
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 rounded bg-muted/50 p-3 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Assumptions met:</span>
              {result.assumptions_met ? (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs">
                  <Check className="mr-1 h-3 w-3" />
                  Yes
                </Badge>
              ) : (
                <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-xs">
                  <AlertCircle className="mr-1 h-3 w-3" />
                  No
                </Badge>
              )}
            </div>
            {!result.assumptions_met && result.fallback_used && (
              <p className="text-muted-foreground">
                Assumptions failed &rarr; fallback test (
                {formatTestName(result.test_name)}) was used
              </p>
            )}
            {result.effect_size_interpretation && (
              <p className="text-muted-foreground">
                {result.effect_size_interpretation}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Include in report toggle */}
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-xs text-muted-foreground">
          Include in report
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isIncluded}
          onClick={onToggleInclude}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            isIncluded ? "bg-blue-600" : "bg-gray-200"
          }`}
        >
          <span
            className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
              isIncluded ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>

        {/* Re-run button */}
        {onRerunTest && (
          <button
            type="button"
            onClick={onRerunTest}
            disabled={isRerunning}
            className="ml-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="Re-run this test"
          >
            {isRerunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Re-run
          </button>
        )}
      </div>
    </div>
  );
}
