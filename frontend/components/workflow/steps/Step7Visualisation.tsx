"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  PieChart,
  Plus,
} from "lucide-react";
import { ResultChart } from "@/components/workflow/ResultChart";
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

export interface Step7VisualisationProps {
  project: Project;
  dataset: Dataset | null;
  results: AnalysisResult[];
  plans: AnalysisPlan[];
  charts: Chart[];
  chartUrls: Record<string, string>;
  columns: string[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Step7Visualisation({
  project,
  dataset,
  results,
  plans,
  charts: initialCharts,
  chartUrls: initialChartUrls,
  columns,
}: Step7VisualisationProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const projectId = project.id;
  const datasetId = dataset?.id ?? null;

  /* ---------- State ---------- */
  const [includedIds, setIncludedIds] = useState<Set<string>>(
    () => new Set(results.map((r) => r.id)),
  );
  const [commentsByResultId, setCommentsByResultId] = useState<
    Record<string, string>
  >({});
  const [expandedInterpretations, setExpandedInterpretations] = useState<
    Set<string>
  >(new Set());
  const [isAdvancing, setIsAdvancing] = useState(false);

  /* ---------- Custom chart form ---------- */
  const [showCustomChart, setShowCustomChart] = useState(false);
  const [customForm, setCustomForm] = useState({
    title: "",
    xVar: "",
    yVar: "",
    chartType: "bar",
    description: "",
  });
  const { dispatchTask } = useDispatchTask();
  const [customTaskId, setCustomTaskId] = useState<string | null>(null);
  const customTaskProgress = useTaskProgress(customTaskId);
  const isCustomRunning =
    customTaskProgress.status === "running" ||
    customTaskProgress.status === "claimed" ||
    customTaskProgress.status === "pending";

  /* ---------- Plan / chart maps ---------- */
  const planMap = useMemo(
    () => new Map(plans.map((p) => [p.id, p])),
    [plans],
  );
  const chartByResultId = useMemo(() => {
    const m = new Map<string, Chart>();
    for (const c of initialCharts) {
      if (c.analysis_result_id) m.set(c.analysis_result_id, c);
    }
    return m;
  }, [initialCharts]);

  /* ---------- Derived ---------- */
  const totalCharts = results.length;
  const includedCount = includedIds.size;

  /* ---------- Handlers ---------- */

  const handleToggle = useCallback((id: string) => {
    setIncludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCommentChange = useCallback(
    (resultId: string, value: string) => {
      setCommentsByResultId((prev) => ({ ...prev, [resultId]: value }));
    },
    [],
  );

  const toggleInterpretation = useCallback((id: string) => {
    setExpandedInterpretations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddCustomChart = useCallback(async () => {
    if (!datasetId || !customForm.xVar || !customForm.yVar) return;
    try {
      const result = await dispatchTask(
        projectId,
        "generate_chart",
        {
          dataset_id: datasetId,
          project_id: projectId,
          x_var: customForm.xVar,
          y_var: customForm.yVar,
          chart_type: customForm.chartType,
          title: customForm.title || `${customForm.yVar} by ${customForm.xVar}`,
          description: customForm.description,
        },
        datasetId,
      );
      setCustomTaskId(result.taskId);
      toast("Chart generation started", { variant: "success" });
    } catch {
      toast("Failed to start chart generation", { variant: "error" });
    }
  }, [datasetId, projectId, customForm, dispatchTask]);

  // Reset custom form when task completes
  useEffect(() => {
    if (customTaskProgress.status === "completed") {
      setCustomForm({ title: "", xVar: "", yVar: "", chartType: "bar", description: "" });
      setCustomTaskId(null);
      toast("Custom chart generated — refresh to see it", { variant: "success" });
    }
  }, [customTaskProgress.status]);

  const handleFinalize = useCallback(async () => {
    setIsAdvancing(true);
    try {
      const pipelineStatus: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "7": "completed",
        "8": "active",
      };

      await supabase
        .from("projects")
        // @ts-expect-error — supabase update type inference
        .update({
          current_step: 8,
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
          <PieChart className="mb-4 h-12 w-12 text-muted-foreground/50" />
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

  if (results.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <PieChart className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="mb-1 font-medium">No results yet</p>
          <p className="text-sm text-muted-foreground">
            Go to Step 6 to run analysis first.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push(`/projects/${projectId}/step/6`)}
          >
            Go to Analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Visualisations</h2>
        <p className="text-sm text-muted-foreground">
          Review charts and select which to include in your report
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span>
          <strong className="text-foreground">{includedCount}</strong> of{" "}
          <strong className="text-foreground">{totalCharts}</strong> charts
          selected for report
        </span>
      </div>

      {/* Chart grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {results.map((result) => {
          const plan = planMap.get(result.plan_id);
          if (!plan) return null;
          const chart = chartByResultId.get(result.id);
          const chartUrl = chart ? initialChartUrls[chart.id] : undefined;
          const isIncluded = includedIds.has(result.id);
          const isExpanded = expandedInterpretations.has(result.id);
          const pValue = result.p_value;
          const isSignificant = pValue !== null && pValue < 0.05;

          return (
            <Card key={result.id} className={isIncluded ? "border-blue-200" : "border-muted"}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {plan.dependent_variable}{" "}
                  <span className="text-muted-foreground">by</span>{" "}
                  {plan.independent_variable}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Chart */}
                <ResultChart
                  result={result}
                  plan={plan}
                  chartUrl={chartUrl}
                  chartTitle={chart?.title ?? undefined}
                />

                {/* Significance badge */}
                <div className="flex items-center gap-2">
                  {isSignificant ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                      Significant p&lt;0.05
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 hover:bg-gray-100">
                      Not significant
                    </Badge>
                  )}
                  {pValue !== null && (
                    <span className="text-xs text-muted-foreground">
                      p = {pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}
                    </span>
                  )}
                </div>

                {/* AI interpretation (truncated, expandable) */}
                {result.interpretation && (
                  <div>
                    <p
                      className={`text-sm text-muted-foreground ${
                        isExpanded ? "" : "line-clamp-2"
                      }`}
                    >
                      {result.interpretation}
                    </p>
                    {result.interpretation.length > 120 && (
                      <button
                        type="button"
                        onClick={() => toggleInterpretation(result.id)}
                        className="text-xs text-blue-600 hover:underline mt-1"
                      >
                        {isExpanded ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                )}

                {/* Comment textarea */}
                <Textarea
                  placeholder="Add a comment for this chart..."
                  rows={2}
                  className="text-sm"
                  value={commentsByResultId[result.id] ?? ""}
                  onChange={(e) =>
                    handleCommentChange(result.id, e.target.value)
                  }
                />

                {/* Toggle button */}
                <div className="flex justify-end">
                  {isIncluded ? (
                    <Button
                      size="sm"
                      onClick={() => handleToggle(result.id)}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Included in report
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggle(result.id)}
                    >
                      Exclude
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Custom chart section */}
      <Collapsible open={showCustomChart} onOpenChange={setShowCustomChart}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700">
          {showCustomChart ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <Plus className="h-4 w-4" />
          Add a custom chart
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-3 border-purple-200 bg-purple-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <PieChart className="h-4 w-4 text-purple-600" />
                Add Custom Chart
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Chart title
                  </label>
                  <input
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    placeholder="e.g. Satisfaction by Department"
                    value={customForm.title}
                    onChange={(e) =>
                      setCustomForm((f) => ({ ...f, title: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Chart type
                  </label>
                  <Select
                    value={customForm.chartType}
                    onValueChange={(v) =>
                      setCustomForm((f) => ({ ...f, chartType: v }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bar">Bar</SelectItem>
                      <SelectItem value="box">Box</SelectItem>
                      <SelectItem value="scatter">Scatter</SelectItem>
                      <SelectItem value="line">Line</SelectItem>
                      <SelectItem value="histogram">Histogram</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    X-axis variable
                  </label>
                  <Select
                    value={customForm.xVar}
                    onValueChange={(v) =>
                      setCustomForm((f) => ({ ...f, xVar: v }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((col) => (
                        <SelectItem key={col} value={col}>
                          {col}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Y-axis variable
                  </label>
                  <Select
                    value={customForm.yVar}
                    onValueChange={(v) =>
                      setCustomForm((f) => ({ ...f, yVar: v }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((col) => (
                        <SelectItem key={col} value={col}>
                          {col}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Description / instructions for AI{" "}
                  <span className="font-normal">(optional)</span>
                </label>
                <Textarea
                  placeholder="e.g. Show grouped bars with error bars..."
                  rows={2}
                  value={customForm.description}
                  onChange={(e) =>
                    setCustomForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={handleAddCustomChart}
                  disabled={
                    isCustomRunning || !customForm.xVar || !customForm.yVar
                  }
                >
                  {isCustomRunning ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Add Chart
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCustomChart(false)}
                >
                  Cancel
                </Button>
              </div>

              {isCustomRunning && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating chart...
                </div>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Continue to Report */}
      <div className="flex justify-end border-t pt-4">
        <Button
          size="lg"
          onClick={handleFinalize}
          disabled={isAdvancing}
        >
          {isAdvancing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="mr-2 h-4 w-4" />
          )}
          Continue to Report
        </Button>
      </div>
    </div>
  );
}
