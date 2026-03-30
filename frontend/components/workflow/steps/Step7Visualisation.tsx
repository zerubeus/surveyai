"use client";

import { useCallback, useMemo, useState } from "react";
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
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Line,
} from "recharts";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  PieChart as PieChartIcon,
  Plus,
  BarChart2,
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
type EDAResult = Tables<"eda_results">;
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
  edaResults: EDAResult[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16",
  "#f97316", "#6366f1",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pLabel(p: number | null): string {
  if (p === null) return "";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(3)}`;
}

/* ------------------------------------------------------------------ */
/*  Chart builders from EDA profile data                              */
/* ------------------------------------------------------------------ */

/** Categorical / Likert frequency bar chart */
function FrequencyBarChart({ freqTable, columnName }: {
  freqTable: Record<string, { count: number; pct: number }>;
  columnName: string;
}) {
  const data = Object.entries(freqTable)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([name, v]) => ({ name, count: v.count, pct: v.pct }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          angle={data.length > 5 ? -35 : 0}
          textAnchor={data.length > 5 ? "end" : "middle"}
          interval={0}
        />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number, n: string) => [n === "pct" ? `${v}%` : v, n === "pct" ? "%" : "Count"]}
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Categorical pie chart */
function FrequencyPieChart({ freqTable }: {
  freqTable: Record<string, { count: number; pct: number }>;
}) {
  const data = Object.entries(freqTable)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([name, v]) => ({ name, value: v.count, pct: v.pct }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={85}
          label={({ name, pct }) => `${String(name).slice(0, 10)} ${pct}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => [v, "Count"]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Continuous distribution bar chart (box-plot-like using p25/median/p75) */
function ContinuousChart({ profile, columnName }: {
  profile: Record<string, unknown>;
  columnName: string;
}) {
  const mean = profile.mean as number | undefined;
  const median = profile.median as number | undefined;
  const std = profile.std as number | undefined;
  const min = profile.min as number | undefined;
  const max = profile.max as number | undefined;
  const p25 = profile.p25 as number | undefined;
  const p75 = profile.p75 as number | undefined;

  if (mean === undefined) return null;

  // Bar chart: min, p25, median, mean, p75, max
  const data = [
    { label: "Min", value: min ?? 0 },
    { label: "Q1 (25%)", value: p25 ?? 0 },
    { label: "Median", value: median ?? 0 },
    { label: "Mean", value: mean },
    { label: "Q3 (75%)", value: p75 ?? 0 },
    { label: "Max", value: max ?? 0 },
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => [v.toFixed(2), columnName]} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.label === "Mean" || entry.label === "Median" ? COLORS[0] : "#94a3b8"}
              fillOpacity={0.75}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Cross-tab stacked bar chart from analysis_result + group_stats */
function GroupComparisonChart({ result, plan }: {
  result: AnalysisResult;
  plan: AnalysisPlan;
}) {
  const raw = result.raw_output as Record<string, unknown> | null;
  const chartData = raw?.chart_data as Record<string, unknown> | null;

  // group_stats: { groupName: { mean, median, std, n } }
  const groupStats = chartData?.group_stats as Record<string, { mean: number; std: number; n: number }> | null;
  // contingency_table: { depCategory: { indepCategory: count } }
  const contingencyTable = chartData?.contingency_table as Record<string, Record<string, number>> | null;
  // scatter_sample
  const scatterSample = chartData?.scatter_sample as { x: number; y: number }[] | null;
  const regressionLine = chartData?.regression_line as { slope: number; intercept: number } | null;

  const pValue = result.p_value;
  const testName = result.test_name;
  const depVar = plan.dependent_variable;
  const indepVar = plan.independent_variable;

  // Contingency table → grouped bar chart
  if (contingencyTable) {
    const depCategories = Object.keys(contingencyTable);
    const indepCategories = Array.from(
      new Set(depCategories.flatMap((d) => Object.keys(contingencyTable[d] ?? {})))
    );
    const barData = indepCategories.map((row) => {
      const entry: Record<string, string | number> = { name: String(row) };
      for (const col of depCategories) {
        entry[String(col)] = contingencyTable[col]?.[row] ?? 0;
      }
      return entry;
    });

    return (
      <div className="space-y-2">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {depCategories.map((col, i) => (
              <Bar key={col} dataKey={col} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} stackId="a" radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        {pValue !== null && <p className="text-center text-xs text-muted-foreground">{pLabel(pValue)}</p>}
      </div>
    );
  }

  // Group stats → bar chart with error bars
  if (groupStats) {
    const barData = Object.entries(groupStats).map(([group, s]) => ({
      name: group,
      mean: s.mean,
      error: [s.std, s.std] as [number, number],
      n: s.n,
    }));
    return (
      <div className="space-y-2">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} label={{ value: indepVar, position: "insideBottom", offset: -5, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: `Mean ${depVar}`, angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip formatter={(v: number) => [v.toFixed(3), "Mean"]} />
            <Bar dataKey="mean" fill={COLORS[0]} fillOpacity={0.8} radius={[3, 3, 0, 0]}>
              <ErrorBar dataKey="error" width={4} strokeWidth={1.5} stroke="#1e40af" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {pValue !== null && <p className="text-center text-xs text-muted-foreground">{pLabel(pValue)}</p>}
      </div>
    );
  }

  // Scatter sample → scatter chart
  if (scatterSample && scatterSample.length > 0) {
    let lineData: { x: number; y: number }[] = [];
    if (regressionLine) {
      const xs = scatterSample.map((p) => p.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      lineData = [
        { x: minX, y: regressionLine.slope * minX + regressionLine.intercept },
        { x: maxX, y: regressionLine.slope * maxX + regressionLine.intercept },
      ];
    }
    return (
      <div className="space-y-2">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis type="number" dataKey="x" name={indepVar} tick={{ fontSize: 11 }} label={{ value: indepVar, position: "insideBottom", offset: -5, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name={depVar} tick={{ fontSize: 11 }} label={{ value: depVar, angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={scatterSample} fill={COLORS[0]} fillOpacity={0.5} r={3} />
            {lineData.length > 0 && (
              <Line data={lineData} dataKey="y" stroke="#ef4444" strokeWidth={2} dot={false} type="linear" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {pValue !== null && <p className="text-center text-xs text-muted-foreground">{pLabel(pValue)} · r = {result.test_statistic?.toFixed(3)}</p>}
      </div>
    );
  }

  // Final fallback: stat summary card
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-4 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Test: {testName?.replace(/_/g, " ")}</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-bold tabular-nums">{pLabel(pValue)}</p>
          <p className="text-xs text-muted-foreground">significance</p>
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums">{result.effect_size_value.toFixed(3)}</p>
          <p className="text-xs text-muted-foreground">{result.effect_size_name} (effect)</p>
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums">{result.sample_size}</p>
          <p className="text-xs text-muted-foreground">n (sample)</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground italic text-center">
        Run analysis again to generate charts
      </p>
    </div>
  );
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
  edaResults,
}: Step7VisualisationProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const projectId = project.id;
  const datasetId = dataset?.id ?? null;

  const { dispatchTask, isDispatching } = useDispatchTask();
  const [customTaskId, setCustomTaskId] = useState<string | null>(null);
  const customTaskProgress = useTaskProgress(customTaskId);

  const [includedResultIds, setIncludedResultIds] = useState<Set<string>>(
    new Set(results.map((r) => r.id))
  );
  const [includedEdaIds, setIncludedEdaIds] = useState<Set<string>>(
    new Set(edaResults.map((e) => e.id))
  );
  const [commentsByResultId, setCommentsByResultId] = useState<Record<string, string>>({});
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customForm, setCustomForm] = useState({
    title: "", xVar: "", yVar: "", chartType: "bar", description: "",
  });

  // Maps
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const handleToggleResult = useCallback((id: string) => {
    setIncludedResultIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleEda = useCallback((id: string) => {
    setIncludedEdaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleIncludeAll = useCallback(() => {
    setIncludedResultIds(new Set(results.map((r) => r.id)));
    setIncludedEdaIds(new Set(edaResults.map((e) => e.id)));
  }, [results, edaResults]);

  const handleExcludeAll = useCallback(() => {
    setIncludedResultIds(new Set());
    setIncludedEdaIds(new Set());
  }, []);

  const handleCustomSubmit = useCallback(async () => {
    if (!datasetId || !customForm.xVar || !customForm.yVar) return;
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_chart" as Parameters<typeof dispatchTask>[1],
        {
          dataset_id: datasetId,
          x_var: customForm.xVar,
          y_var: customForm.yVar,
          chart_type: customForm.chartType,
          title: customForm.title || `${customForm.yVar} by ${customForm.xVar}`,
          description: customForm.description,
        },
        datasetId,
      );
      setCustomTaskId(taskId);
      toast("Generating custom chart…", { variant: "default" });
    } catch {
      toast("Failed to dispatch chart generation", { variant: "error" });
    }
  }, [datasetId, projectId, customForm, dispatchTask]);

  const handleFinalize = useCallback(async () => {
    setIsAdvancing(true);
    try {
      const newPipeline: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "7": "completed",
        "8": "active",
      };
      await supabase
        .from("projects")
        // @ts-ignore
        .update({ current_step: 8, pipeline_status: newPipeline as unknown as Json })
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
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No dataset found.</p>
        </CardContent>
      </Card>
    );
  }

  /* ================================================================ */
  /*  Separate EDA results into categorical vs continuous              */
  /* ================================================================ */

  const categoricalEdas = edaResults.filter((e) => {
    const p = e.profile as Record<string, unknown> | null;
    return p?.frequency_table_top10 || p?.frequency_table;
  });

  const continuousEdas = edaResults.filter((e) => {
    const p = e.profile as Record<string, unknown> | null;
    return p?.mean !== undefined && p?.std !== undefined;
  });

  const totalSelected = includedResultIds.size + includedEdaIds.size;
  const totalCharts = results.length + edaResults.length;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Visualisations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select which charts to include in your report
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground">{totalSelected}</strong> / {totalCharts} selected
          </span>
          <Button size="sm" variant="outline" onClick={handleIncludeAll}>Include All</Button>
          <Button size="sm" variant="ghost" onClick={handleExcludeAll}>Exclude All</Button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* SECTION 1: Statistical Test Results                          */}
      {/* ============================================================ */}
      {results.length > 0 && (
        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <BarChart2 className="h-4 w-4 text-blue-500" />
            Statistical Test Results
            <Badge variant="outline">{results.length}</Badge>
          </h3>
          <div className="grid gap-6 md:grid-cols-2">
            {results.map((result) => {
              const plan = planMap.get(result.plan_id);
              if (!plan) return null;
              const isIncluded = includedResultIds.has(result.id);
              const isSignificant = result.p_value !== null && result.p_value < 0.05;

              return (
                <Card
                  key={result.id}
                  className={`transition-all ${isIncluded ? "border-blue-400 shadow-sm" : "border-muted"}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm font-semibold">
                          {plan.dependent_variable}{" "}
                          <span className="font-normal text-muted-foreground">by</span>{" "}
                          {plan.independent_variable}
                        </CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {result.test_name?.replace(/_/g, " ")}
                        </p>
                      </div>
                      <Badge
                        className={isSignificant
                          ? "bg-green-100 text-green-800 hover:bg-green-100 shrink-0"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-100 shrink-0"
                        }
                      >
                        {isSignificant ? "Significant" : "Not significant"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <GroupComparisonChart result={result} plan={plan} />

                    {result.interpretation && (
                      <p className="line-clamp-3 text-xs text-muted-foreground">
                        {result.interpretation}
                      </p>
                    )}

                    <Textarea
                      placeholder="Add a note for this chart…"
                      rows={2}
                      className="text-xs"
                      value={commentsByResultId[result.id] ?? ""}
                      onChange={(e) =>
                        setCommentsByResultId((prev) => ({ ...prev, [result.id]: e.target.value }))
                      }
                    />

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant={isIncluded ? "default" : "outline"}
                        onClick={() => handleToggleResult(result.id)}
                      >
                        {isIncluded ? (
                          <><Check className="mr-1.5 h-3.5 w-3.5" />Included</>
                        ) : (
                          "Include in report"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/* SECTION 2: Categorical Distributions                         */}
      {/* ============================================================ */}
      {categoricalEdas.length > 0 && (
        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <PieChartIcon className="h-4 w-4 text-purple-500" />
            Categorical Distributions
            <Badge variant="outline">{categoricalEdas.length}</Badge>
          </h3>
          <div className="grid gap-6 md:grid-cols-2">
            {categoricalEdas.map((eda) => {
              const profile = eda.profile as Record<string, unknown> | null;
              const freqTable = (profile?.frequency_table_top10 ?? profile?.frequency_table) as
                Record<string, { count: number; pct: number }> | null;
              if (!freqTable) return null;
              const isIncluded = includedEdaIds.has(eda.id);
              const colName = eda.column_name ?? "Unknown";
              const nUnique = profile?.n_unique as number | undefined;

              return (
                <Card
                  key={eda.id}
                  className={`transition-all ${isIncluded ? "border-purple-400 shadow-sm" : "border-muted"}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm font-semibold">{colName}</CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {nUnique} unique values ·{" "}
                          {eda.column_role?.replace(/_/g, " ") ?? "categorical"}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Show pie if ≤ 8 categories, bar if more */}
                    {nUnique !== undefined && nUnique <= 8 ? (
                      <FrequencyPieChart freqTable={freqTable} />
                    ) : (
                      <FrequencyBarChart freqTable={freqTable} columnName={colName} />
                    )}

                    {/* Frequency table */}
                    <div className="overflow-x-auto rounded border text-xs">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-2 py-1 text-left font-medium">Value</th>
                            <th className="px-2 py-1 text-right font-medium">Count</th>
                            <th className="px-2 py-1 text-right font-medium">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(freqTable)
                            .sort((a, b) => b[1].count - a[1].count)
                            .slice(0, 8)
                            .map(([val, v]) => (
                              <tr key={val} className="border-b last:border-0">
                                <td className="px-2 py-1 font-mono">{val}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{v.count}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{v.pct}%</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant={isIncluded ? "default" : "outline"}
                        onClick={() => handleToggleEda(eda.id)}
                      >
                        {isIncluded ? (
                          <><Check className="mr-1.5 h-3.5 w-3.5" />Included</>
                        ) : "Include in report"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/* SECTION 3: Numeric Distributions                             */}
      {/* ============================================================ */}
      {continuousEdas.length > 0 && (
        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <BarChart2 className="h-4 w-4 text-amber-500" />
            Numeric Distributions
            <Badge variant="outline">{continuousEdas.length}</Badge>
          </h3>
          <div className="grid gap-6 md:grid-cols-2">
            {continuousEdas.map((eda) => {
              const profile = eda.profile as Record<string, unknown> | null;
              if (!profile) return null;
              const isIncluded = includedEdaIds.has(eda.id);
              const colName = eda.column_name ?? "Unknown";
              const mean = profile.mean as number | undefined;
              const median = profile.median as number | undefined;
              const std = profile.std as number | undefined;

              return (
                <Card
                  key={eda.id}
                  className={`transition-all ${isIncluded ? "border-amber-400 shadow-sm" : "border-muted"}`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{colName}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Mean {mean?.toFixed(2)} · Median {median?.toFixed(2)} · SD {std?.toFixed(2)}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ContinuousChart profile={profile} columnName={colName} />

                    {/* Stats table */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      {[
                        ["Min", profile.min],
                        ["Q1", profile.p25],
                        ["Median", median],
                        ["Mean", mean],
                        ["Q3", profile.p75],
                        ["Max", profile.max],
                      ].map(([label, val]) => (
                        <div key={String(label)} className="rounded border bg-muted/30 px-2 py-1">
                          <p className="font-bold tabular-nums">{typeof val === "number" ? val.toFixed(2) : "—"}</p>
                          <p className="text-muted-foreground">{String(label)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant={isIncluded ? "default" : "outline"}
                        onClick={() => handleToggleEda(eda.id)}
                      >
                        {isIncluded ? (
                          <><Check className="mr-1.5 h-3.5 w-3.5" />Included</>
                        ) : "Include in report"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/* Empty state                                                  */}
      {/* ============================================================ */}
      {results.length === 0 && edaResults.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12">
            <PieChartIcon className="mb-4 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">No visualisation data yet</p>
            <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">
              Complete the Quality (step 4) and Analysis (step 6) steps to generate charts.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => router.push(`/projects/${projectId}/step/4`)}>
              Go to Quality Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ============================================================ */}
      {/* Custom chart                                                 */}
      {/* ============================================================ */}
      {columns.length > 0 && (
        <Collapsible open={customOpen} onOpenChange={setCustomOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              Add custom chart
              <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${customOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2">
              <CardContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">X-axis variable</label>
                    <Select value={customForm.xVar} onValueChange={(v) => setCustomForm((f) => ({ ...f, xVar: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select column…" /></SelectTrigger>
                      <SelectContent>
                        {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Y-axis variable</label>
                    <Select value={customForm.yVar} onValueChange={(v) => setCustomForm((f) => ({ ...f, yVar: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select column…" /></SelectTrigger>
                      <SelectContent>
                        {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Chart type</label>
                    <Select value={customForm.chartType} onValueChange={(v) => setCustomForm((f) => ({ ...f, chartType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["bar", "scatter", "line", "box", "histogram"].map((t) => (
                          <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Title (optional)</label>
                    <input
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      placeholder={`${customForm.yVar || "Y"} by ${customForm.xVar || "X"}`}
                      value={customForm.title}
                      onChange={(e) => setCustomForm((f) => ({ ...f, title: e.target.value }))}
                    />
                  </div>
                </div>
                <Textarea
                  placeholder="Optional: describe what you want to show (e.g. 'Compare job satisfaction across departments')"
                  rows={2}
                  value={customForm.description}
                  onChange={(e) => setCustomForm((f) => ({ ...f, description: e.target.value }))}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={handleCustomSubmit}
                    disabled={isDispatching || !customForm.xVar || !customForm.yVar || customTaskProgress.status === "running"}
                  >
                    {isDispatching || customTaskProgress.status === "running" ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating…</>
                    ) : (
                      <><Plus className="mr-2 h-4 w-4" />Generate Chart</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* ============================================================ */}
      {/* Finalize                                                     */}
      {/* ============================================================ */}
      <div className="flex items-center justify-between border-t pt-4">
        <p className="text-sm text-muted-foreground">
          {totalSelected} chart{totalSelected !== 1 ? "s" : ""} will be included in your report
        </p>
        <Button onClick={handleFinalize} disabled={isAdvancing}>
          {isAdvancing ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Proceeding…</>
          ) : (
            <>Continue to Report <ArrowRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </div>
    </div>
  );
}
