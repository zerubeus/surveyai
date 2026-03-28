"use client";

import { useCallback, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, ChevronsUpDown } from "lucide-react";
import type { Tables } from "@/lib/types/database";

type AnalysisPlan = Tables<"analysis_plans">;

interface AnalysisPlanReviewProps {
  plans: AnalysisPlan[];
  columns: string[];
  onRefetch: () => void;
  onRunAnalysis: () => void;
  isRunDisabled: boolean;
}

const TEST_OPTIONS = [
  { value: "t_test", label: "t-test" },
  { value: "mann_whitney", label: "Mann-Whitney U" },
  { value: "anova", label: "ANOVA" },
  { value: "kruskal_wallis", label: "Kruskal-Wallis" },
  { value: "chi_square", label: "Chi-square" },
  { value: "fishers_exact", label: "Fisher's exact" },
  { value: "pearson", label: "Pearson correlation" },
  { value: "spearman", label: "Spearman correlation" },
  { value: "logistic_regression", label: "Logistic regression" },
];

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  running: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

export function AnalysisPlanReview({
  plans,
  columns,
  onRefetch,
  onRunAnalysis,
  isRunDisabled,
}: AnalysisPlanReviewProps) {
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const supabase = createBrowserClient();

  const plannedPlans = plans.filter((p) => p.status === "planned");
  const approvedCount = plans.filter((p) => p.status === "approved").length;

  const updatePlan = useCallback(
    async (planId: string, data: Partial<AnalysisPlan>) => {
      setUpdating((prev) => new Set(prev).add(planId));
      try {
        await supabase
          .from("analysis_plans")
          // @ts-expect-error — supabase update type inference
          .update(data)
          .eq("id", planId);
        onRefetch();
      } finally {
        setUpdating((prev) => {
          const next = new Set(prev);
          next.delete(planId);
          return next;
        });
      }
    },
    [supabase, onRefetch],
  );

  const handleApprove = useCallback(
    async (planId: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await updatePlan(planId, {
        status: "approved",
        approved_by: user?.id ?? null,
        approved_at: new Date().toISOString(),
      });
    },
    [supabase, updatePlan],
  );

  const handleSkip = useCallback(
    async (planId: string) => {
      await supabase
        .from("analysis_plans")
        .delete()
        .eq("id", planId);
      onRefetch();
    },
    [supabase, onRefetch],
  );

  const handleApproveAll = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    for (const plan of plannedPlans) {
      await supabase
        .from("analysis_plans")
        // @ts-expect-error — supabase update type inference
        .update({
          status: "approved",
          approved_by: user?.id ?? null,
          approved_at: now,
        })
        .eq("id", plan.id);
    }
    onRefetch();
  }, [supabase, plannedPlans, onRefetch]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Proposed Analyses</CardTitle>
          <div className="flex items-center gap-2">
            {plannedPlans.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleApproveAll}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Approve All ({plannedPlans.length})
              </Button>
            )}
            <Button
              size="sm"
              onClick={onRunAnalysis}
              disabled={isRunDisabled || approvedCount === 0}
            >
              Run Analysis ({approvedCount})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="flex items-start gap-4 rounded-lg border p-4"
            >
              {/* Research question + rationale */}
              <div className="min-w-0 flex-1 space-y-1">
                {plan.research_question_text && (
                  <p className="text-sm font-medium">
                    {plan.research_question_text}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{plan.independent_variable}</span>
                  <span>→</span>
                  <span className="font-mono">{plan.dependent_variable}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {plan.test_rationale}
                </p>
              </div>

              {/* Test selector */}
              <div className="w-48 shrink-0">
                {plan.status === "planned" ? (
                  <Select
                    value={plan.selected_test}
                    onValueChange={(value) =>
                      updatePlan(plan.id, { selected_test: value })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEST_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs font-medium">
                    {TEST_OPTIONS.find((t) => t.value === plan.selected_test)
                      ?.label ?? plan.selected_test}
                  </span>
                )}
              </div>

              {/* Variable selectors for planned items */}
              {plan.status === "planned" && (
                <div className="flex shrink-0 gap-1">
                  <Select
                    value={plan.independent_variable}
                    onValueChange={(value) =>
                      updatePlan(plan.id, { independent_variable: value })
                    }
                  >
                    <SelectTrigger className="h-8 w-32 text-xs">
                      <SelectValue placeholder="X variable" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((col) => (
                        <SelectItem key={col} value={col}>
                          {col}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ChevronsUpDown className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <Select
                    value={plan.dependent_variable}
                    onValueChange={(value) =>
                      updatePlan(plan.id, { dependent_variable: value })
                    }
                  >
                    <SelectTrigger className="h-8 w-32 text-xs">
                      <SelectValue placeholder="Y variable" />
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
              )}

              {/* Status + actions */}
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  variant="secondary"
                  className={STATUS_COLORS[plan.status] ?? ""}
                >
                  {plan.status}
                </Badge>
                {plan.status === "planned" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-green-600"
                      onClick={() => handleApprove(plan.id)}
                      disabled={updating.has(plan.id)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-red-500"
                      onClick={() => handleSkip(plan.id)}
                      disabled={updating.has(plan.id)}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}

          {plans.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No analysis plans yet. Generate a plan to get started.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
