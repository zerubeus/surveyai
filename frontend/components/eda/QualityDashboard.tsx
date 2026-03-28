"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useQualityResults } from "@/hooks/useQualityResults";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  PlayCircle,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  Shield,
  Brain,
  Loader2,
  Sparkles,
  ListChecks,
} from "lucide-react";
import type { Tables, Json } from "@/lib/types/database";

type ColumnMapping = Tables<"column_mappings">;

interface QualityDashboardProps {
  datasetId: string;
  projectId: string;
}

export function QualityDashboard({ datasetId, projectId }: QualityDashboardProps) {
  const [mappingsByColumn, setMappingsByColumn] = useState<
    Record<string, ColumnMapping>
  >({});

  // Task tracking
  const [edaTaskId, setEdaTaskId] = useState<string | null>(null);
  const [consistencyTaskId, setConsistencyTaskId] = useState<string | null>(null);
  const [biasTaskId, setBiasTaskId] = useState<string | null>(null);
  const [interpretTaskId, setInterpretTaskId] = useState<string | null>(null);

  const edaProgress = useTaskProgress(edaTaskId);
  const consistencyProgress = useTaskProgress(consistencyTaskId);
  const biasProgress = useTaskProgress(biasTaskId);
  const interpretProgress = useTaskProgress(interpretTaskId);

  const { dispatchTask, isDispatching } = useDispatchTask();

  // Quality results (with Realtime subscription)
  const {
    columnProfiles,
    datasetSummary,
    consistencyChecks,
    biasFlags,
    interpretation,
    isLoading: resultsLoading,
    clear: clearResults,
  } = useQualityResults(datasetId);

  // Load column mappings for role badges
  useEffect(() => {
    const supabase = createBrowserClient();
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
  }, [datasetId]);

  // When all 3 core tasks complete, dispatch AI interpretation
  const interpretDispatched = useRef(false);
  useEffect(() => {
    if (
      edaProgress.status === "completed" &&
      consistencyProgress.status === "completed" &&
      biasProgress.status === "completed" &&
      !interpretDispatched.current &&
      !interpretTaskId
    ) {
      interpretDispatched.current = true;
      dispatchTask(projectId, "interpret_results", {
        dataset_id: datasetId,
        project_id: projectId,
      }, datasetId).then(({ taskId }) => {
        setInterpretTaskId(taskId);
      }).catch(() => {
        // Interpretation is best-effort; dashboard still works without it
      });
    }
  }, [
    edaProgress.status,
    consistencyProgress.status,
    biasProgress.status,
    interpretTaskId,
    datasetId,
    projectId,
    dispatchTask,
  ]);

  const handleStartAnalysis = useCallback(async () => {
    try {
      const payload = { dataset_id: datasetId, project_id: projectId };

      // Reset state
      clearResults();
      interpretDispatched.current = false;
      setInterpretTaskId(null);

      // Dispatch all three tasks in parallel
      const [eda, consistency, bias] = await Promise.all([
        dispatchTask(projectId, "run_eda", payload, datasetId),
        dispatchTask(projectId, "run_consistency_checks", payload, datasetId),
        dispatchTask(projectId, "run_bias_detection", payload, datasetId),
      ]);

      setEdaTaskId(eda.taskId);
      setConsistencyTaskId(consistency.taskId);
      setBiasTaskId(bias.taskId);
    } catch {
      // Error handled by useDispatchTask
    }
  }, [datasetId, projectId, dispatchTask, clearResults]);

  const isRunning =
    edaProgress.status === "running" ||
    edaProgress.status === "claimed" ||
    consistencyProgress.status === "running" ||
    consistencyProgress.status === "claimed" ||
    biasProgress.status === "running" ||
    biasProgress.status === "claimed";

  const isInterpreting =
    interpretProgress.status === "running" ||
    interpretProgress.status === "claimed";

  const hasResults = columnProfiles.length > 0;
  const summary = datasetSummary?.profile as Record<string, Json> | null;
  const overallQuality = (summary?.overall_quality as number) ?? null;

  // AI interpretation data
  const interpretData = interpretation?.interpretation as Record<string, Json> | null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Data Quality Analysis</h3>
          <p className="text-sm text-muted-foreground">
            Profile columns, check consistency, and detect bias
          </p>
        </div>
        <Button
          onClick={handleStartAnalysis}
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
              {hasResults ? "Re-analyse Data Quality" : "Analyse Data Quality"}
            </>
          )}
        </Button>
      </div>

      {/* Progress bars during run */}
      {(isRunning || isInterpreting) && (
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
            {interpretTaskId && (
              <TaskProgressRow
                label="AI interpretation"
                progress={interpretProgress.progress}
                message={interpretProgress.progressMessage}
                status={interpretProgress.status}
              />
            )}
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

      {/* Overall quality score */}
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

      {/* AI Interpretation card */}
      {interpretData && (
        <Card className="border-purple-200 dark:border-purple-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-purple-500" />
              AI Quality Interpretation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Dataset summary */}
            {interpretData.dataset_summary && (
              <p className="text-sm leading-relaxed">
                {String(interpretData.dataset_summary)}
              </p>
            )}

            {/* Recommended next steps */}
            {Array.isArray(interpretData.recommended_next_steps) &&
              (interpretData.recommended_next_steps as string[]).length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <ListChecks className="h-3.5 w-3.5" />
                    Recommended Next Steps
                  </p>
                  <ul className="space-y-1.5">
                    {(interpretData.recommended_next_steps as string[]).map(
                      (step, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-medium text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                            {i + 1}
                          </span>
                          <span>{String(step)}</span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}

            {/* Column interpretations */}
            {Array.isArray(interpretData.column_interpretations) &&
              (interpretData.column_interpretations as Array<Record<string, string>>).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    Notable Column Findings
                  </p>
                  <div className="space-y-2">
                    {(interpretData.column_interpretations as Array<Record<string, string>>).map(
                      (ci, i) => (
                        <div key={i} className="rounded-lg border p-2.5">
                          <p className="text-xs font-medium font-mono">
                            {ci.column_name}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {ci.finding}
                          </p>
                          {ci.implication && (
                            <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">
                              {ci.implication}
                            </p>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}

            {/* Bias explanations */}
            {Array.isArray(interpretData.bias_explanations) &&
              (interpretData.bias_explanations as Array<Record<string, string>>).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    Bias Risk Assessment
                  </p>
                  <div className="space-y-1.5">
                    {(interpretData.bias_explanations as Array<Record<string, string>>).map(
                      (be, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <RiskBadge level={be.risk_level ?? "low"} />
                          <div className="min-w-0 flex-1">
                            <span className="font-medium">
                              {formatBiasType(be.bias_type ?? "")}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {be.plain_language}
                            </p>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {/* Bias Detection */}
      {biasFlags.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Bias Detection
            </CardTitle>
            <CardDescription>
              {biasFlags.length} bias flag(s) detected
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {biasFlags.map((flag) => {
              const evidence = flag.bias_evidence as Record<string, Json> | null;
              return (
                <div key={flag.id} className="rounded-lg border p-3">
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
      {consistencyChecks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4" />
              Consistency Checks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {consistencyChecks.map((check) => {
              const issues = (check.issues ?? []) as Array<{
                check_type?: string;
                severity?: string;
                description?: string;
                affected_rows_count?: number;
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
                      {(issue.affected_rows_count ?? issue.affected_rows) != null && (
                        <span className="ml-2 text-muted-foreground">
                          ({issue.affected_rows_count ?? issue.affected_rows} rows)
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

      {/* Column profiles — Accordion */}
      {columnProfiles.length > 0 && (
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" />
            Column Quality ({columnProfiles.length})
          </h4>
          <Accordion type="multiple" className="rounded-lg border">
            {columnProfiles
              .sort((a, b) => (a.quality_score ?? 100) - (b.quality_score ?? 100))
              .map((result) => {
                const colName = result.column_name ?? "?";
                const mapping = mappingsByColumn[colName];
                const score = result.quality_score ?? 100;
                const scoreColor =
                  score >= 80 ? "text-green-600" : score >= 60 ? "text-yellow-600" : "text-red-600";
                const issues = (result.issues as Array<{type?: string; severity?: string; description?: string}>) ?? [];
                const criticalIssues = issues.filter(i => i.severity === "critical").length;
                return (
                  <AccordionItem key={result.id} value={result.id ?? colName}>
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex flex-1 items-center gap-3 text-left">
                        <span className={`text-sm font-mono font-semibold ${scoreColor} w-8 shrink-0`}>
                          {score}
                        </span>
                        <span className="font-medium">{colName}</span>
                        {mapping?.role && (
                          <Badge variant="outline" className="text-xs font-normal">
                            {mapping.role}
                          </Badge>
                        )}
                        {criticalIssues > 0 && (
                          <Badge variant="destructive" className="ml-auto mr-4 text-xs">
                            {criticalIssues} critical
                          </Badge>
                        )}
                        {issues.length > 0 && criticalIssues === 0 && (
                          <Badge variant="secondary" className="ml-auto mr-4 text-xs">
                            {issues.length} issue{issues.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4">
                      <QualityCard
                        columnName={colName}
                        role={mapping?.role ?? null}
                        dataType={mapping?.data_type ?? null}
                        qualityScore={result.quality_score}
                        profile={result.profile as Record<string, Json> | null}
                        issues={issues}
                        inline
                      />
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
          </Accordion>
        </div>
      )}

      {/* Empty state */}
      {!hasResults && !isRunning && !resultsLoading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No quality analysis results yet. Click &quot;Analyse Data
              Quality&quot; to profile your dataset.
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

function RiskBadge({ level }: { level: string }) {
  if (level === "high")
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
        high
      </Badge>
    );
  if (level === "medium")
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
        medium
      </Badge>
    );
  return (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
      low
    </Badge>
  );
}

function formatBiasType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
