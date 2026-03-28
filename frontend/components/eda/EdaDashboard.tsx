"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { QualityCard } from "@/components/eda/QualityCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  PlayCircle,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  Shield,
  Brain,
  Loader2,
} from "lucide-react";
import type { Tables, Json } from "@/lib/types/database";

type EdaResult = Tables<"eda_results">;
type ColumnMapping = Tables<"column_mappings">;

interface EdaDashboardProps {
  datasetId: string;
  projectId: string;
}

interface EdaState {
  columnProfiles: EdaResult[];
  datasetSummary: EdaResult | null;
  consistencyChecks: EdaResult[];
  biasFlags: EdaResult[];
  isLoading: boolean;
}

export function EdaDashboard({ datasetId, projectId }: EdaDashboardProps) {
  const [edaState, setEdaState] = useState<EdaState>({
    columnProfiles: [],
    datasetSummary: null,
    consistencyChecks: [],
    biasFlags: [],
    isLoading: true,
  });
  const [mappingsByColumn, setMappingsByColumn] = useState<
    Record<string, ColumnMapping>
  >({});

  // Task tracking
  const [edaTaskId, setEdaTaskId] = useState<string | null>(null);
  const [consistencyTaskId, setConsistencyTaskId] = useState<string | null>(
    null,
  );
  const [biasTaskId, setBiasTaskId] = useState<string | null>(null);

  const edaProgress = useTaskProgress(edaTaskId);
  const consistencyProgress = useTaskProgress(consistencyTaskId);
  const biasProgress = useTaskProgress(biasTaskId);

  const { dispatchTask, isDispatching } = useDispatchTask();

  // Load existing results and column mappings
  useEffect(() => {
    const supabase = createBrowserClient();

    // Load column mappings for role badges
    supabase
      .from("column_mappings")
      .select("*")
      .eq("dataset_id", datasetId)
      .then(({ data }) => {
        if (data) {
          const byCol: Record<string, ColumnMapping> = {};
          for (const m of data as ColumnMapping[]) {
            byCol[m.column_name] = m;
          }
          setMappingsByColumn(byCol);
        }
      });

    supabase
      .from("eda_results")
      .select("*")
      .eq("dataset_id", datasetId)
      .then(({ data, error }) => {
        if (error || !data) {
          setEdaState((s) => ({ ...s, isLoading: false }));
          return;
        }
        categorizeResults(data as EdaResult[]);
      });

    // Subscribe to real-time inserts for live updates during EDA run
    const channel = supabase
      .channel(`eda-results-${datasetId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eda_results",
          filter: `dataset_id=eq.${datasetId}`,
        },
        (payload) => {
          const row = payload.new as EdaResult;
          setEdaState((prev) => {
            const updated = { ...prev };
            if (row.result_type === "column_profile") {
              updated.columnProfiles = [...prev.columnProfiles, row];
            } else if (row.result_type === "dataset_summary") {
              updated.datasetSummary = row;
            } else if (row.result_type === "consistency_check") {
              updated.consistencyChecks = [...prev.consistencyChecks, row];
            } else if (row.result_type === "bias_check") {
              updated.biasFlags = [...prev.biasFlags, row];
            }
            return updated;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [datasetId]);

  function categorizeResults(data: EdaResult[]) {
    setEdaState({
      columnProfiles: data.filter((r) => r.result_type === "column_profile"),
      datasetSummary:
        data.find((r) => r.result_type === "dataset_summary") ?? null,
      consistencyChecks: data.filter(
        (r) => r.result_type === "consistency_check",
      ),
      biasFlags: data.filter((r) => r.result_type === "bias_check"),
      isLoading: false,
    });
  }

  const handleStartEda = useCallback(async () => {
    try {
      const payload = { dataset_id: datasetId, project_id: projectId };

      // Clear previous results from UI
      setEdaState({
        columnProfiles: [],
        datasetSummary: null,
        consistencyChecks: [],
        biasFlags: [],
        isLoading: false,
      });

      // Dispatch all three tasks
      const [eda, consistency, bias] = await Promise.all([
        dispatchTask(projectId, "run_eda", payload, datasetId),
        dispatchTask(
          projectId,
          "run_consistency_checks",
          payload,
          datasetId,
        ),
        dispatchTask(projectId, "run_bias_detection", payload, datasetId),
      ]);

      setEdaTaskId(eda.taskId);
      setConsistencyTaskId(consistency.taskId);
      setBiasTaskId(bias.taskId);
    } catch {
      // Error handled by useDispatchTask
    }
  }, [datasetId, projectId, dispatchTask]);

  const isRunning =
    edaProgress.status === "running" ||
    edaProgress.status === "claimed" ||
    consistencyProgress.status === "running" ||
    consistencyProgress.status === "claimed" ||
    biasProgress.status === "running" ||
    biasProgress.status === "claimed";

  const hasResults = edaState.columnProfiles.length > 0;
  const summary = edaState.datasetSummary?.profile as Record<
    string,
    Json
  > | null;
  const overallQuality = (summary?.overall_quality as number) ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Exploratory Data Analysis</h3>
          <p className="text-sm text-muted-foreground">
            Profile columns, check consistency, and detect bias
          </p>
        </div>
        <Button
          onClick={handleStartEda}
          disabled={isDispatching || isRunning}
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <PlayCircle className="mr-2 h-4 w-4" />
              {hasResults ? "Re-run EDA" : "Start EDA"}
            </>
          )}
        </Button>
      </div>

      {/* Progress bars during run */}
      {isRunning && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <TaskProgressRow
              label="Column profiling"
              progress={edaProgress.progress}
              message={edaProgress.progressMessage}
              status={edaProgress.status}
            />
            <TaskProgressRow
              label="Consistency checks"
              progress={consistencyProgress.progress}
              message={consistencyProgress.progressMessage}
              status={consistencyProgress.status}
            />
            <TaskProgressRow
              label="Bias detection"
              progress={biasProgress.progress}
              message={biasProgress.progressMessage}
              status={biasProgress.status}
            />
          </CardContent>
        </Card>
      )}

      {/* Error display */}
      {(edaProgress.error ||
        consistencyProgress.error ||
        biasProgress.error) && (
        <Card className="border-red-200 dark:border-red-900">
          <CardContent className="p-4">
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                {edaProgress.error && <p>EDA: {edaProgress.error}</p>}
                {consistencyProgress.error && (
                  <p>Consistency: {consistencyProgress.error}</p>
                )}
                {biasProgress.error && (
                  <p>Bias: {biasProgress.error}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dataset summary */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={<BarChart3 className="h-5 w-5" />}
            label="Overall Quality"
            value={`${overallQuality ?? "?"}/100`}
            color={
              overallQuality !== null
                ? overallQuality >= 80
                  ? "text-green-600"
                  : overallQuality >= 60
                    ? "text-yellow-600"
                    : "text-red-600"
                : ""
            }
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Columns Profiled"
            value={String(summary.columns_profiled ?? 0)}
          />
          <SummaryCard
            icon={<AlertCircle className="h-5 w-5 text-red-500" />}
            label="Critical Issues"
            value={String(summary.critical_count ?? 0)}
            color={
              (summary.critical_count as number) > 0 ? "text-red-600" : ""
            }
          />
          <SummaryCard
            icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
            label="Warnings"
            value={String(summary.warning_count ?? 0)}
            color={
              (summary.warning_count as number) > 0 ? "text-yellow-600" : ""
            }
          />
        </div>
      )}

      {/* Column profiles */}
      {edaState.columnProfiles.length > 0 && (
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" />
            Column Profiles ({edaState.columnProfiles.length})
          </h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {edaState.columnProfiles
              .sort(
                (a, b) => (a.quality_score ?? 100) - (b.quality_score ?? 100),
              )
              .map((result) => {
                const colName = result.column_name ?? "?";
                const mapping = mappingsByColumn[colName];
                return (
                  <QualityCard
                    key={result.id}
                    columnName={colName}
                    role={mapping?.role ?? null}
                    dataType={mapping?.data_type ?? null}
                    qualityScore={result.quality_score}
                    profile={result.profile as Record<string, Json> | null}
                    issues={
                      (result.issues as Array<{
                        type?: string;
                        severity?: string;
                        description?: string;
                      }>) ?? []
                    }
                  />
                );
              })}
          </div>
        </div>
      )}

      {/* Bias Detection */}
      {edaState.biasFlags.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Bias Detection
            </CardTitle>
            <CardDescription>
              {edaState.biasFlags.length} bias flag(s) detected
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {edaState.biasFlags.map((flag) => {
              const evidence = flag.bias_evidence as Record<
                string,
                Json
              > | null;
              return (
                <div
                  key={flag.id}
                  className="rounded-lg border p-3"
                >
                  <div className="flex items-start gap-2">
                    <SeverityBadge severity={flag.bias_severity} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {formatBiasType(flag.bias_type ?? "unknown")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {(evidence?.description as string) ?? ""}
                      </p>
                      {flag.bias_recommendation && (
                        <p className="mt-1.5 text-xs text-blue-600 dark:text-blue-400">
                          Recommendation: {flag.bias_recommendation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Consistency Checks */}
      {edaState.consistencyChecks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4" />
              Consistency Checks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {edaState.consistencyChecks.map((check) => {
              const issues = (check.issues ?? []) as Array<{
                check_type?: string;
                severity?: string;
                description?: string;
                affected_rows?: number;
                recommendation?: string;
              }>;
              return issues.map((issue, i) => (
                <div
                  key={`${check.id}-${i}`}
                  className="flex items-start gap-2 rounded-lg border p-3"
                >
                  <SeverityBadge severity={issue.severity ?? "info"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">
                      {issue.check_type?.replace(/_/g, " ")}
                      {issue.affected_rows != null && (
                        <span className="ml-2 text-muted-foreground">
                          ({issue.affected_rows} rows)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {issue.description}
                    </p>
                    {issue.recommendation && (
                      <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                        {issue.recommendation}
                      </p>
                    )}
                  </div>
                </div>
              ));
            })}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!hasResults && !isRunning && !edaState.isLoading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No EDA results yet. Click &quot;Start EDA&quot; to profile your
              dataset.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TaskProgressRow({
  label,
  progress,
  message,
  status,
}: {
  label: string;
  progress: number;
  message: string | null;
  status: string | null;
}) {
  const isDone = status === "completed";
  const isFailed = status === "failed";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          {label}
          {isDone && (
            <CheckCircle2 className="ml-1.5 inline h-3.5 w-3.5 text-green-500" />
          )}
          {isFailed && (
            <AlertCircle className="ml-1.5 inline h-3.5 w-3.5 text-red-500" />
          )}
        </span>
        <span className="text-muted-foreground">{message ?? ""}</span>
      </div>
      <Progress value={progress} className="h-2" />
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-lg font-bold ${color}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (severity === "critical")
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
        critical
      </Badge>
    );
  if (severity === "warning")
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
        warning
      </Badge>
    );
  return (
    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
      info
    </Badge>
  );
}

function formatBiasType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
