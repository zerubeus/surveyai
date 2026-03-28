"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useAnalysisResults } from "@/hooks/useAnalysisResults";
import { useTaskProgress } from "@/hooks/useTaskProgress";
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
} from "lucide-react";
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

  const handleProceedToReport = useCallback(async () => {
    setIsAdvancing(true);
    try {
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

      router.push(`/projects/${projectId}/step/7`);
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
            onClick={() => router.push(`/projects/${projectId}/step/5`)}
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
            onClick={() => router.push(`/projects/${projectId}/step/5`)}
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
      {groupedResults.map((group) => (
        <Card key={group.rqText}>
          <CardHeader>
            <CardTitle className="text-sm font-medium leading-snug">
              {group.rqText}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {group.items.map(({ result, plan, chart }) => (
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
              />
            ))}
          </CardContent>
        </Card>
      ))}

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
      </div>

      {/* Chart */}
      {chartUrl && (
        <div className="overflow-hidden rounded-lg border bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={chartUrl}
            alt={chart?.title ?? "Result chart"}
            className="max-h-64 w-full object-contain"
          />
        </div>
      )}

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
      </div>
    </div>
  );
}
