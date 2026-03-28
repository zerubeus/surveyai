"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useCleaningSuggestions } from "@/hooks/useCleaningSuggestions";
import { CleaningSuggestionFlow } from "@/components/cleaning/CleaningSuggestionFlow";
import { UndoPanel } from "@/components/cleaning/UndoPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft,
  Sparkles,
  Loader2,
  Wand2,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import type { Tables } from "@/lib/types/database";

type Dataset = Tables<"datasets">;
type Project = Tables<"projects">;

export default function CleaningPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [ranWithNoSuggestions, setRanWithNoSuggestions] = useState(false);
  const [generateTaskId, setGenerateTaskId] = useState<string | null>(null);

  const { dispatchTask, isDispatching } = useDispatchTask();
  const generateProgress = useTaskProgress(generateTaskId);

  const {
    pending,
    applied,
    all,
    isLoading: suggestionsLoading,
    refetch: refetchSuggestions,
  } = useCleaningSuggestions(dataset?.id ?? null);

  // Load project + current dataset
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
      setLoading(false);
    }

    load();
  }, [projectId, router]);

  const handleGenerate = useCallback(async () => {
    if (!dataset) return;
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_cleaning_suggestions",
        {
          dataset_id: dataset.id,
          project_id: projectId,
        },
        dataset.id,
      );
      setGenerateTaskId(taskId);
    } catch {
      // Error handled by useDispatchTask
    }
  }, [dataset, projectId, dispatchTask]);

  // Refetch when generation completes
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (generateProgress.status === "completed" && generateTaskId && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      refetchSuggestions();
      // After refetch settles, check if we got suggestions. Use timeout to let state update.
      setTimeout(() => {
        setGenerateTaskId(null);
      }, 500);
    }
  }, [generateProgress.status, generateTaskId, refetchSuggestions]);

  useEffect(() => {
    if (generateTaskId) {
      hasFetchedRef.current = false;
      setRanWithNoSuggestions(false);
    }
  }, [generateTaskId]);

  const isGenerating =
    generateTaskId !== null &&
    (generateProgress.status === "pending" ||
     generateProgress.status === "running" ||
     generateProgress.status === "claimed");

  const hasSuggestions = all.length > 0;

  // When task completes and we have no suggestions, mark as "ran clean"
  useEffect(() => {
    if (!generateTaskId && !suggestionsLoading && !hasSuggestions && hasFetchedRef.current) {
      setRanWithNoSuggestions(true);
    }
  }, [generateTaskId, suggestionsLoading, hasSuggestions]);

  // Task ran but produced 0 suggestions — data is already clean (stable state)
  const analysisRanClean = ranWithNoSuggestions && !hasSuggestions && !isGenerating;

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
        <span className="text-sm font-medium">Cleaning</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Data Cleaning</h1>
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
        {/* Clean data — no suggestions needed */}
        {analysisRanClean && (
          <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
            <CardContent className="flex items-center gap-4 py-6">
              <CheckCircle2 className="h-8 w-8 text-green-600 shrink-0" />
              <div>
                <p className="font-medium text-green-900 dark:text-green-100">Your data looks clean!</p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  No cleaning issues were detected. You can proceed directly to analysis.
                </p>
              </div>
              <Button className="ml-auto" onClick={() => router.push(`/projects/${projectId}/analysis` as never)}>
                Proceed to Analysis
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Generate button */}
        {!hasSuggestions && !isGenerating && !analysisRanClean && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Wand2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="mb-4 text-sm text-muted-foreground">
                Generate AI-powered cleaning suggestions based on your data quality
                analysis.
              </p>
              <Button
                onClick={handleGenerate}
                disabled={isDispatching || isGenerating}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Cleaning Suggestions
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Re-generate button when suggestions exist */}
        {hasSuggestions && !isGenerating && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={isDispatching}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Re-generate Suggestions
            </Button>
          </div>
        )}

        {/* Generation progress */}
        {isGenerating && (
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating cleaning suggestions...
              </div>
              <Progress
                value={generateProgress.progress}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                {generateProgress.progressMessage ?? "Analyzing dataset..."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Generation error */}
        {generateProgress.error && (
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="p-4">
              <p className="text-sm text-red-600 dark:text-red-400">
                {generateProgress.error}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Suggestion flow */}
        {hasSuggestions && !suggestionsLoading && dataset && (
          <CleaningSuggestionFlow
            suggestions={pending}
            datasetId={dataset.id}
            projectId={projectId}
            onRefetch={refetchSuggestions}
          />
        )}

        {/* Undo panel */}
        {applied.length > 0 && (
          <UndoPanel
            appliedOperations={applied}
            onRefetch={refetchSuggestions}
          />
        )}

        {/* Proceed to Analysis */}
        {hasSuggestions && (
          <div className="flex justify-end pt-4">
            <Button onClick={() => router.push(`/projects/${projectId}/analysis` as never)}>
              Proceed to Analysis
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
