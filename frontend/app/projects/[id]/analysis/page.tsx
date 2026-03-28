"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useAnalysisResults } from "@/hooks/useAnalysisResults";
import { AnalysisPlanReview } from "@/components/analysis/AnalysisPlanReview";
import { AnalysisResultsTable } from "@/components/analysis/AnalysisResultsTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft,
  Loader2,
  FlaskConical,
  Info,
  Sparkles,
  FileText,
} from "lucide-react";
import type { Tables } from "@/lib/types/database";

type Dataset = Tables<"datasets">;
type Project = Tables<"projects">;
type ColumnMapping = Tables<"column_mappings">;

export default function AnalysisPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [loading, setLoading] = useState(true);

  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  const [runTaskId, setRunTaskId] = useState<string | null>(null);

  const { dispatchTask, isDispatching } = useDispatchTask();
  const planProgress = useTaskProgress(planTaskId);
  const runProgress = useTaskProgress(runTaskId);

  const {
    plans,
    results,
    isLoading: analysisLoading,
    refetch: refetchAnalysis,
  } = useAnalysisResults(dataset?.id ?? null);

  // Detect weight column
  const hasWeightColumn = columnMappings.some((m) => m.role === "weight");
  const columnNames = columnMappings
    .filter((m) => m.role !== "ignore" && m.role !== "identifier" && m.role !== "metadata")
    .map((m) => m.column_name);

  // Load project + current dataset + column mappings
  useEffect(() => {
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data: projRaw } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      const proj = projRaw as Project | null;

      if (!proj) {
        router.push("/projects" as never);
        return;
      }
      setProject(proj);

      const { data: datasetsRaw } = await supabase
        .from("datasets")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1);
      const datasets = datasetsRaw as Dataset[] | null;

      const ds = datasets?.[0] ?? null;
      if (!ds) {
        router.push(`/projects/${projectId}` as never);
        return;
      }
      setDataset(ds);

      // Load column mappings for variable dropdowns
      const { data: mappingsRaw } = await supabase
        .from("column_mappings")
        .select("*")
        .eq("dataset_id", ds.id);
      const mappings = mappingsRaw as Tables<"column_mappings">[] | null;

      setColumnMappings(mappings ?? []);
      setLoading(false);
    }

    load();
  }, [projectId, router]);

  // Refetch when plan generation completes
  useEffect(() => {
    if (planProgress.status === "completed") {
      refetchAnalysis();
      setPlanTaskId(null);
    }
  }, [planProgress.status, refetchAnalysis]);

  // Refetch when analysis run completes
  useEffect(() => {
    if (runProgress.status === "completed") {
      refetchAnalysis();
      setRunTaskId(null);
    }
  }, [runProgress.status, refetchAnalysis]);

  const handleGeneratePlan = useCallback(async () => {
    if (!dataset) return;
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_analysis_plan",
        {
          dataset_id: dataset.id,
          project_id: projectId,
        },
        dataset.id,
      );
      setPlanTaskId(taskId);
    } catch {
      // Error handled by useDispatchTask
    }
  }, [dataset, projectId, dispatchTask]);

  const handleRunAnalysis = useCallback(async () => {
    if (!dataset) return;
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "run_analysis",
        {
          dataset_id: dataset.id,
          project_id: projectId,
        },
        dataset.id,
      );
      setRunTaskId(taskId);
    } catch {
      // Error handled by useDispatchTask
    }
  }, [dataset, projectId, dispatchTask]);

  const isPlanGenerating =
    planProgress.status === "running" || planProgress.status === "claimed";
  const isAnalysisRunning =
    runProgress.status === "running" || runProgress.status === "claimed";

  const hasPlans = plans.length > 0;
  const hasResults = results.length > 0;

  if (loading) {
    return (
      <div className="container py-10">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${projectId}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <span className="text-muted-foreground">/</span>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${projectId}/quality`}>
            Data Quality
          </Link>
        </Button>
        <span className="text-muted-foreground">/</span>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${projectId}/cleaning`}>
            Cleaning
          </Link>
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">Analysis</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Statistical Analysis</h1>
          {dataset && (
            <Badge variant="outline" className="text-xs">
              v{dataset.version}
            </Badge>
          )}
        </div>
        {dataset && (
          <p className="mt-1 text-muted-foreground">
            {dataset.name} —{" "}
            {dataset.row_count?.toLocaleString("en-US") ?? "?"} rows,{" "}
            {dataset.column_count ?? "?"} columns
          </p>
        )}
      </div>

      <div className="space-y-6">
        {/* Weights banner (Q3) */}
        {!hasWeightColumn && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
            <CardContent className="flex items-center gap-3 p-4">
              <Info className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
              <p className="text-sm text-blue-800 dark:text-blue-300">
                No survey weights detected — analysis will use unweighted tests.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Generate plan button */}
        {!hasPlans && !isPlanGenerating && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FlaskConical className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="mb-2 text-sm font-medium">
                Generate an AI-powered analysis plan
              </p>
              <p className="mb-4 max-w-md text-center text-xs text-muted-foreground">
                The AI will read your research questions and column roles to
                propose appropriate statistical tests for each question.
              </p>
              <Button
                onClick={handleGeneratePlan}
                disabled={isDispatching || isPlanGenerating}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Analysis Plan
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Re-generate button when plans exist */}
        {hasPlans && !isPlanGenerating && !isAnalysisRunning && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGeneratePlan}
              disabled={isDispatching}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Re-generate Plan
            </Button>
          </div>
        )}

        {/* Plan generation progress */}
        {isPlanGenerating && (
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating analysis plan...
              </div>
              <Progress value={planProgress.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {planProgress.progressMessage ?? "Analyzing research questions..."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Plan generation error */}
        {planProgress.error && (
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="p-4">
              <p className="text-sm text-red-600 dark:text-red-400">
                {planProgress.error}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Plan review */}
        {hasPlans && !analysisLoading && (
          <AnalysisPlanReview
            plans={plans}
            columns={columnNames}
            onRefetch={refetchAnalysis}
            onRunAnalysis={handleRunAnalysis}
            isRunDisabled={isDispatching || isAnalysisRunning}
          />
        )}

        {/* Analysis running progress */}
        {isAnalysisRunning && (
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running statistical analyses...
              </div>
              <Progress value={runProgress.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {runProgress.progressMessage ?? "Processing..."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Analysis run error */}
        {runProgress.error && (
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="p-4">
              <p className="text-sm text-red-600 dark:text-red-400">
                {runProgress.error}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results table */}
        {hasResults && (
          <AnalysisResultsTable results={results} plans={plans} />
        )}

        {/* Generate Report CTA — shown after results */}
        {hasResults && !isAnalysisRunning && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col items-center justify-center py-8 sm:flex-row sm:justify-between sm:py-6">
              <div className="mb-4 text-center sm:mb-0 sm:text-left">
                <p className="text-sm font-medium">
                  Ready to generate a report from these results?
                </p>
                <p className="text-xs text-muted-foreground">
                  Choose a template and let AI draft your report sections.
                </p>
              </div>
              <Button onClick={() => router.push(`/projects/${projectId}/report` as never)}>
                <FileText className="mr-2 h-4 w-4" />
                Generate Report
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
