"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Filter } from "lucide-react";
import type { Tables, Json } from "@/lib/types/database";

type AnalysisResult = Tables<"analysis_results">;
type AnalysisPlan = Tables<"analysis_plans">;

interface AnalysisResultsTableProps {
  results: AnalysisResult[];
  plans: AnalysisPlan[];
}

const TEST_LABELS: Record<string, string> = {
  t_test: "Independent t-test",
  mann_whitney: "Mann-Whitney U",
  anova: "One-way ANOVA",
  kruskal_wallis: "Kruskal-Wallis H",
  chi_square: "Chi-square",
  fishers_exact: "Fisher's exact",
  pearson: "Pearson r",
  spearman: "Spearman ρ",
  logistic_regression: "Logistic regression",
};

function formatPValue(p: number | null): { text: string; color: string } {
  if (p === null) return { text: "N/A", color: "text-muted-foreground" };
  if (p < 0.001) return { text: "< .001", color: "text-green-600 dark:text-green-400" };
  if (p < 0.05) return { text: p.toFixed(3), color: "text-green-600 dark:text-green-400" };
  if (p < 0.1) return { text: p.toFixed(3), color: "text-yellow-600 dark:text-yellow-400" };
  return { text: p.toFixed(3), color: "text-muted-foreground" };
}

function effectSizeBadge(interpretation: string): {
  label: string;
  className: string;
} {
  switch (interpretation) {
    case "large":
      return {
        label: "Large",
        className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
      };
    case "medium":
      return {
        label: "Medium",
        className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      };
    case "small":
      return {
        label: "Small",
        className: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
      };
    default:
      return {
        label: interpretation || "N/A",
        className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
      };
  }
}

export function AnalysisResultsTable({
  results,
  plans,
}: AnalysisResultsTableProps) {
  const [showSignificantOnly, setShowSignificantOnly] = useState(false);

  const planById = useMemo(() => {
    const map = new Map<string, AnalysisPlan>();
    for (const p of plans) {
      map.set(p.id, p);
    }
    return map;
  }, [plans]);

  const displayResults = useMemo(() => {
    if (showSignificantOnly) {
      return results.filter((r) => r.p_value !== null && r.p_value < 0.05);
    }
    return results;
  }, [results, showSignificantOnly]);

  if (results.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Analysis Results</CardTitle>
          <Button
            variant={showSignificantOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setShowSignificantOnly((prev) => !prev)}
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            {showSignificantOnly ? "Showing significant only" : "All results"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Table header */}
        <div className="hidden border-b pb-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-11 md:gap-2">
          <div className="col-span-3">Research Question</div>
          <div className="col-span-2">Variables</div>
          <div className="col-span-2">Test Used</div>
          <div className="col-span-1 text-right">Statistic</div>
          <div className="col-span-1 text-right">p-value</div>
          <div className="col-span-2">Effect Size</div>
        </div>

        <Accordion type="multiple" className="w-full">
          {displayResults.map((result) => {
            const plan = planById.get(result.plan_id);
            const pFormatted = formatPValue(result.p_value);
            const esBadge = effectSizeBadge(result.effect_size_interpretation);
            const rawOutput = result.raw_output as Record<string, Json> | null;
            const assumptions = rawOutput?.assumptions_checked;

            return (
              <AccordionItem key={result.id} value={result.id}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="grid w-full grid-cols-11 gap-2 text-left text-sm">
                    <div className="col-span-3 truncate">
                      {plan?.research_question_text ?? "—"}
                    </div>
                    <div className="col-span-2 truncate font-mono text-xs">
                      {plan?.independent_variable ?? "?"} → {plan?.dependent_variable ?? "?"}
                    </div>
                    <div className="col-span-2 text-xs">
                      {TEST_LABELS[result.test_name] ?? result.test_name}
                      {result.fallback_used && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          fallback
                        </Badge>
                      )}
                    </div>
                    <div className="col-span-1 text-right font-mono text-xs">
                      {result.test_statistic !== null
                        ? result.test_statistic.toFixed(2)
                        : "—"}
                    </div>
                    <div
                      className={`col-span-1 text-right font-mono text-xs font-semibold ${pFormatted.color}`}
                    >
                      {pFormatted.text}
                    </div>
                    <div className="col-span-2">
                      <Badge variant="secondary" className={esBadge.className}>
                        {esBadge.label}
                      </Badge>
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        {result.effect_size_name}={result.effect_size_value.toFixed(3)}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pl-2">
                    {/* Interpretation */}
                    {result.interpretation && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                          Interpretation
                        </h4>
                        <p className="text-sm">{result.interpretation}</p>
                      </div>
                    )}

                    {/* Limitations */}
                    {result.limitations &&
                      Array.isArray(result.limitations) &&
                      (result.limitations as string[]).length > 0 && (
                        <div>
                          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                            Limitations
                          </h4>
                          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                            {(result.limitations as string[]).map(
                              (lim, i) => (
                                <li key={i}>{lim}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                    {/* Assumption checks */}
                    {assumptions && Array.isArray(assumptions) && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                          Assumption Checks
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {(
                            assumptions as Array<{
                              name: string;
                              passed: boolean;
                              details: string;
                            }>
                          ).map((a, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className={
                                a.passed
                                  ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                                  : "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                              }
                            >
                              {a.passed ? "✓" : "✗"} {a.name}
                              {a.details && (
                                <span className="ml-1 opacity-70">
                                  ({a.details})
                                </span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Data quality */}
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>n = {result.sample_size}</span>
                      <span>
                        Missing: {(result.missing_data_rate * 100).toFixed(1)}%
                      </span>
                      {result.degrees_of_freedom !== null && (
                        <span>df = {result.degrees_of_freedom}</span>
                      )}
                      {result.interpretation_validated && (
                        <Badge
                          variant="outline"
                          className="border-green-300 text-green-700"
                        >
                          Validated
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {displayResults.length === 0 && showSignificantOnly && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No statistically significant results (p &lt; 0.05).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
