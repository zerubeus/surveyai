"use client";

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
  ErrorBar,
} from "recharts";
import type { Tables } from "@/lib/types/database";

type AnalysisPlan = Tables<"analysis_plans">;
type AnalysisResult = Tables<"analysis_results">;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export const CHART_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16",
];

export function formatTestName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function pValueColor(p: number | null): string {
  if (p === null) return "text-gray-500";
  if (p < 0.05) return "text-green-600";
  if (p < 0.1) return "text-yellow-600";
  return "text-gray-500";
}

export function effectSizeMagnitude(
  value: number,
  name: string,
): { label: string; className: string } {
  const abs = Math.abs(value);
  const lower = name.toLowerCase();

  if (lower.includes("cohen") && lower.includes("d")) {
    if (abs >= 0.8) return { label: "Large", className: "bg-red-100 text-red-800" };
    if (abs >= 0.5) return { label: "Medium", className: "bg-yellow-100 text-yellow-800" };
    return { label: "Small", className: "bg-blue-100 text-blue-800" };
  }

  if (lower.includes("eta") || lower.includes("η")) {
    if (abs >= 0.14) return { label: "Large", className: "bg-red-100 text-red-800" };
    if (abs >= 0.06) return { label: "Medium", className: "bg-yellow-100 text-yellow-800" };
    return { label: "Small", className: "bg-blue-100 text-blue-800" };
  }

  if (abs >= 0.5) return { label: "Large", className: "bg-red-100 text-red-800" };
  if (abs >= 0.3) return { label: "Medium", className: "bg-yellow-100 text-yellow-800" };
  return { label: "Small", className: "bg-blue-100 text-blue-800" };
}

/* ------------------------------------------------------------------ */
/*  ContingencyTable                                                   */
/* ------------------------------------------------------------------ */

export function ContingencyTable({
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
/*  ResultChart                                                        */
/* ------------------------------------------------------------------ */

export function ResultChart({
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
