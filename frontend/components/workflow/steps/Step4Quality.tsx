"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useQualityResults } from "@/hooks/useQualityResults";
import { useCleaningSuggestions } from "@/hooks/useCleaningSuggestions";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { QualityCard } from "@/components/eda/QualityCard";
import { LoadingSkeleton } from "@/components/workflow/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Lock,
  Loader2,
  Sparkles,
  Shield,
  Undo2,
  Wand2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import type { Tables, Json, Enums } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Project = Tables<"projects">;
type Dataset = Tables<"datasets">;
type ColumnMapping = Tables<"column_mappings">;
type CleaningOperation = Tables<"cleaning_operations">;
type PipelineStatus = Record<string, string>;

interface Step4QualityProps {
  project: Project;
  dataset: Dataset | null;
  initialRunningTaskIds: Record<string, string>;
}

type ReviewMode = "one-at-a-time" | "review-all";

type CleaningCategory =
  | "duplicates"
  | "missing"
  | "outliers"
  | "formatting"
  | "type_issues"
  | "other";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function scoreBgColor(score: number): string {
  if (score >= 80) return "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900";
  if (score >= 60) return "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-900";
  return "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900";
}

function formatBiasType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function categorizeOp(op: CleaningOperation): CleaningCategory {
  const t = op.operation_type;
  if (t === "remove_duplicates") return "duplicates";
  if (t === "standardize_missing" || t === "impute_value") return "missing";
  if (t === "fix_outlier") return "outliers";
  if (t === "fix_encoding" || t === "recode_values" || t === "rename_column")
    return "formatting";
  if (t === "fix_data_type" || t === "split_column" || t === "merge_columns")
    return "type_issues";
  return "other";
}

const CATEGORY_LABELS: Record<CleaningCategory, string> = {
  duplicates: "Duplicates",
  missing: "Missing Values",
  outliers: "Outliers",
  formatting: "Formatting",
  type_issues: "Type Issues",
  other: "Other",
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function Step4Quality({
  project,
  dataset,
  initialRunningTaskIds,
}: Step4QualityProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const datasetId = dataset?.id ?? null;

  /* ---------- Tab state ---------- */
  const [activeTab, setActiveTab] = useState("overview");
  const [hasVisitedTab1, setHasVisitedTab1] = useState(true); // starts on tab 1 → visited

  /* ---------- Task tracking ---------- */
  const [edaTaskId, setEdaTaskId] = useState<string | null>(
    initialRunningTaskIds["run_eda"] ?? null,
  );
  const [consistencyTaskId, setConsistencyTaskId] = useState<string | null>(
    initialRunningTaskIds["run_consistency_checks"] ?? null,
  );
  const [biasTaskId, setBiasTaskId] = useState<string | null>(
    initialRunningTaskIds["run_bias_detection"] ?? null,
  );
  const [interpretTaskId, setInterpretTaskId] = useState<string | null>(null);

  const edaProgress = useTaskProgress(edaTaskId);
  const consistencyProgress = useTaskProgress(consistencyTaskId);
  const biasProgress = useTaskProgress(biasTaskId);
  const interpretProgress = useTaskProgress(interpretTaskId);

  const { dispatchTask, isDispatching } = useDispatchTask();

  /* ---------- Quality results (Realtime) ---------- */
  const {
    columnProfiles,
    datasetSummary,
    consistencyChecks,
    biasFlags,
    interpretation,
    isLoading: resultsLoading,
  } = useQualityResults(datasetId);

  /* ---------- Cleaning suggestions (Realtime) ---------- */
  const cleaning = useCleaningSuggestions(datasetId);

  /* ---------- Column mappings for role badges ---------- */
  const [mappingsByColumn, setMappingsByColumn] = useState<
    Record<string, ColumnMapping>
  >({});

  useEffect(() => {
    if (!datasetId) return;
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
  }, [datasetId, supabase]);

  /* ---------- Auto-dispatch interpretation ---------- */
  const interpretDispatched = useRef(false);
  useEffect(() => {
    if (
      edaProgress.status === "completed" &&
      consistencyProgress.status === "completed" &&
      biasProgress.status === "completed" &&
      !interpretDispatched.current &&
      !interpretTaskId &&
      datasetId
    ) {
      interpretDispatched.current = true;
      dispatchTask(project.id, "interpret_results", {
        dataset_id: datasetId,
        project_id: project.id,
      }, datasetId)
        .then(({ taskId }) => setInterpretTaskId(taskId))
        .catch(() => {
          // Interpretation is best-effort
        });
    }
  }, [
    edaProgress.status,
    consistencyProgress.status,
    biasProgress.status,
    interpretTaskId,
    datasetId,
    project.id,
    dispatchTask,
  ]);

  /* ---------- Derived state ---------- */
  const isRunning =
    edaProgress.status === "running" ||
    edaProgress.status === "claimed" ||
    edaProgress.status === "pending" ||
    consistencyProgress.status === "running" ||
    consistencyProgress.status === "claimed" ||
    consistencyProgress.status === "pending" ||
    biasProgress.status === "running" ||
    biasProgress.status === "claimed" ||
    biasProgress.status === "pending";

  const isInterpreting =
    interpretProgress.status === "running" ||
    interpretProgress.status === "claimed";

  const hasResults = columnProfiles.length > 0;
  const summary = datasetSummary?.profile as Record<string, Json> | null;
  const overallQuality = (summary?.overall_quality as number) ?? null;
  const columnsProfiled = columnProfiles.length;
  const totalIssues = columnProfiles.reduce((sum, r) => {
    const issues = (r.issues as Array<Record<string, string>>) ?? [];
    return sum + issues.length;
  }, 0);

  const interpretData = interpretation?.interpretation as Record<string, Json> | null;

  /* ---------- Tab change handler ---------- */
  const handleTabChange = useCallback(
    (val: string) => {
      if (val === "cleaning" && !hasVisitedTab1) return;
      setActiveTab(val);
    },
    [hasVisitedTab1],
  );

  // Mark tab 1 as visited whenever user is on it
  useEffect(() => {
    if (activeTab === "overview") {
      setHasVisitedTab1(true);
    }
  }, [activeTab]);

  /* ================================================================ */
  /*  No dataset guard                                                 */
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
  /*  Loading skeleton (tasks still running, no results yet)           */
  /* ================================================================ */

  if (isRunning && !hasResults) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <div>
                <p className="font-medium">
                  Profiling your {Object.keys(mappingsByColumn).length || "…"}{" "}
                  columns...
                </p>
                <p className="text-sm text-muted-foreground">
                  This usually takes about 60 seconds.
                </p>
              </div>
            </div>
            <div className="space-y-3">
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
            </div>
          </CardContent>
        </Card>
        <LoadingSkeleton type="dashboard" count={4} />
      </div>
    );
  }

  /* ================================================================ */
  /*  Main two-tab layout                                              */
  /* ================================================================ */

  return (
    <div className="space-y-6">
      {/* Progress bars (tasks still running but we have partial results) */}
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
      {(edaProgress.error || consistencyProgress.error || biasProgress.error) && (
        <Card className="border-red-200 dark:border-red-900">
          <CardContent className="p-4">
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                {edaProgress.error && <p>EDA: {edaProgress.error}</p>}
                {consistencyProgress.error && <p>Consistency: {consistencyProgress.error}</p>}
                {biasProgress.error && <p>Bias: {biasProgress.error}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview">Quality Overview</TabsTrigger>
          <TabsTrigger
            value="cleaning"
            disabled={!hasVisitedTab1}
          >
            {!hasVisitedTab1 && <Lock className="mr-1.5 h-3.5 w-3.5" />}
            Cleaning Suggestions
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/*  TAB 1: Quality Overview                                      */}
        {/* ============================================================ */}
        <TabsContent value="overview">
          <QualityOverviewTab
            overallQuality={overallQuality}
            columnsProfiled={columnsProfiled}
            totalIssues={totalIssues}
            summary={summary}
            columnProfiles={columnProfiles}
            biasFlags={biasFlags}
            consistencyChecks={consistencyChecks}
            interpretData={interpretData}
            mappingsByColumn={mappingsByColumn}
            hasResults={hasResults}
            resultsLoading={resultsLoading}
            onGoToCleaning={() => handleTabChange("cleaning")}
          />
        </TabsContent>

        {/* ============================================================ */}
        {/*  TAB 2: Cleaning Suggestions                                  */}
        {/* ============================================================ */}
        <TabsContent value="cleaning">
          <CleaningSuggestionsTab
            projectId={project.id}
            datasetId={dataset.id}
            cleaning={cleaning}
            project={project}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ================================================================== */
/*  TAB 1: Quality Overview                                            */
/* ================================================================== */

interface QualityOverviewTabProps {
  overallQuality: number | null;
  columnsProfiled: number;
  totalIssues: number;
  summary: Record<string, Json> | null;
  columnProfiles: Tables<"eda_results">[];
  biasFlags: Tables<"eda_results">[];
  consistencyChecks: Tables<"eda_results">[];
  interpretData: Record<string, Json> | null;
  mappingsByColumn: Record<string, ColumnMapping>;
  hasResults: boolean;
  resultsLoading: boolean;
  onGoToCleaning: () => void;
}

function QualityOverviewTab({
  overallQuality,
  columnsProfiled,
  totalIssues,
  summary,
  columnProfiles,
  biasFlags,
  consistencyChecks,
  interpretData,
  mappingsByColumn,
  hasResults,
  resultsLoading,
  onGoToCleaning,
}: QualityOverviewTabProps) {
  if (!hasResults && !resultsLoading) {
    return (
      <Card className="border-dashed mt-4">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No quality analysis results yet. Analysis should start automatically
            after confirming column roles in Step 3.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {/* Global quality score header */}
      {overallQuality !== null && (
        <div className={`rounded-lg border p-6 ${scoreBgColor(overallQuality)}`}>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className={`text-5xl font-bold ${scoreColor(overallQuality)}`}>
                {overallQuality.toFixed(1)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">out of 100</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Overall Data Quality</h3>
              <p className="text-sm text-muted-foreground">
                {columnsProfiled} columns profiled, {totalIssues} issue
                {totalIssues !== 1 ? "s" : ""} found
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={<BarChart3 className="h-5 w-5" />}
            label="Overall Quality"
            value={`${overallQuality ?? "?"}/100`}
            color={overallQuality !== null ? scoreColor(overallQuality) : ""}
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Columns Profiled"
            value={String(summary.columns_profiled ?? columnsProfiled)}
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
            value={String((summary.warning_count as number ?? 0) + biasFlags.length)}
            color={
              ((summary.warning_count as number ?? 0) + biasFlags.length) > 0 ? "text-yellow-600" : ""
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
            {interpretData.dataset_summary && (
              <p className="text-sm leading-relaxed">
                {String(interpretData.dataset_summary)}
              </p>
            )}
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
                          <p className="text-xs font-medium font-mono">{ci.column_name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{ci.finding}</p>
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
              {biasFlags.length} bias flag{biasFlags.length !== 1 ? "s" : ""}{" "}
              detected
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
                      {(issue.affected_rows_count ?? issue.affected_rows) !=
                        null && (
                        <span className="ml-2 text-muted-foreground">
                          ({issue.affected_rows_count ?? issue.affected_rows}{" "}
                          rows)
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

      {/* Column quality grid — Accordion */}
      {columnProfiles.length > 0 && (
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" />
            Column Quality ({columnProfiles.length})
          </h4>
          <Accordion type="multiple" className="rounded-lg border">
            {columnProfiles
              .sort(
                (a, b) => (a.quality_score ?? 100) - (b.quality_score ?? 100),
              )
              .map((result) => {
                const colName = result.column_name ?? "?";
                const mapping = mappingsByColumn[colName];
                const score = result.quality_score ?? 100;
                const sColor =
                  score >= 80
                    ? "text-green-600"
                    : score >= 60
                      ? "text-yellow-600"
                      : "text-red-600";
                const issues =
                  (result.issues as Array<{
                    type?: string;
                    severity?: string;
                    description?: string;
                  }>) ?? [];
                const criticalIssues = issues.filter(
                  (i) => i.severity === "critical",
                ).length;

                return (
                  <AccordionItem key={result.id} value={result.id ?? colName}>
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex flex-1 items-center gap-3 text-left">
                        <span
                          className={`text-sm font-mono font-semibold ${sColor} w-8 shrink-0`}
                        >
                          {score}
                        </span>
                        <span className="font-medium">{colName}</span>
                        {mapping?.role && (
                          <Badge
                            variant="outline"
                            className="text-xs font-normal"
                          >
                            {mapping.role}
                          </Badge>
                        )}
                        {criticalIssues > 0 && (
                          <Badge
                            variant="destructive"
                            className="ml-auto mr-4 text-xs"
                          >
                            {criticalIssues} critical
                          </Badge>
                        )}
                        {issues.length > 0 && criticalIssues === 0 && (
                          <Badge
                            variant="secondary"
                            className="ml-auto mr-4 text-xs"
                          >
                            {issues.length} issue
                            {issues.length > 1 ? "s" : ""}
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
                        profile={
                          result.profile as Record<string, Json> | null
                        }
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

      {/* "Ready to clean" CTA */}
      {hasResults && (
        <Card className="border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium">
                Ready to clean your data
              </p>
              <p className="text-xs text-muted-foreground">
                Review AI-generated cleaning suggestions based on quality
                analysis
              </p>
            </div>
            <Button onClick={onGoToCleaning}>
              Go to Cleaning Suggestions
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== */
/*  TAB 2: Cleaning Suggestions                                        */
/* ================================================================== */

interface CleaningSuggestionsTabProps {
  projectId: string;
  datasetId: string;
  cleaning: ReturnType<typeof useCleaningSuggestions>;
  project: Project;
}

function CleaningSuggestionsTab({
  projectId,
  datasetId,
  cleaning,
  project,
}: CleaningSuggestionsTabProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const { dispatchTask, isDispatching } = useDispatchTask();

  /* ---------- Generate task tracking ---------- */
  const [generateTaskId, setGenerateTaskId] = useState<string | null>(null);
  const generateProgress = useTaskProgress(generateTaskId);

  /* ---------- Apply task tracking ---------- */
  const [applyingOpId, setApplyingOpId] = useState<string | null>(null);
  const [applyTaskId, setApplyTaskId] = useState<string | null>(null);
  const applyProgress = useTaskProgress(applyTaskId);

  /* ---------- Review mode + index ---------- */
  const [reviewMode, setReviewMode] = useState<ReviewMode>("one-at-a-time");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSampleData, setShowSampleData] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  /* ---------- Actionable suggestions ---------- */
  const actionable = useMemo(
    () => cleaning.all.filter((op) => op.status === "pending" || op.status === "approved"),
    [cleaning.all],
  );

  const reviewed = useMemo(
    () => cleaning.all.filter((op) => op.status === "applied" || op.status === "rejected"),
    [cleaning.all],
  );

  const appliedOps = useMemo(
    () => cleaning.all.filter((op) => op.status === "applied"),
    [cleaning.all],
  );

  const allReviewed = actionable.length === 0 && cleaning.all.length > 0;

  /* ---------- Grouped by category (for review-all mode) ---------- */
  const grouped = useMemo(() => {
    const groups: Record<CleaningCategory, CleaningOperation[]> = {
      duplicates: [],
      missing: [],
      outliers: [],
      formatting: [],
      type_issues: [],
      other: [],
    };
    for (const op of actionable) {
      groups[categorizeOp(op)].push(op);
    }
    return groups;
  }, [actionable]);

  /* ---------- Auto-check if generation task is running ---------- */
  useEffect(() => {
    if (cleaning.all.length > 0 || cleaning.isLoading) return;
    // Check if there's an existing generate task running
    supabase
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("task_type", "generate_cleaning_suggestions")
      .in("status", ["pending", "claimed", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setGenerateTaskId(data[0].id);
        }
      });
  }, [cleaning.all.length, cleaning.isLoading, projectId, supabase]);

  /* ---------- Reset apply tracking when task completes ---------- */
  useEffect(() => {
    if (applyProgress.status === "completed" || applyProgress.status === "failed") {
      if (applyProgress.status === "completed") {
        toast("Cleaning operation applied", { variant: "success" });
      } else {
        toast("Failed to apply operation", { variant: "error" });
      }
      setApplyingOpId(null);
      setApplyTaskId(null);
    }
  }, [applyProgress.status]);

  /* ---------- Handlers ---------- */
  const handleGenerate = useCallback(async () => {
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_cleaning_suggestions",
        { dataset_id: datasetId },
        datasetId,
      );
      setGenerateTaskId(taskId);
    } catch {
      toast("Failed to generate suggestions", { variant: "error" });
    }
  }, [projectId, datasetId, dispatchTask]);

  const handleApply = useCallback(
    async (op: CleaningOperation) => {
      setApplyingOpId(op.id);
      try {
        // First approve the operation
        await supabase
          .from("cleaning_operations")
          // @ts-expect-error — supabase update type inference
          .update({ status: "approved" as Enums<"cleaning_op_status"> })
          .eq("id", op.id);

        // Then dispatch the apply task
        const { taskId } = await dispatchTask(
          projectId,
          "apply_cleaning_operation",
          { operation_id: op.id, dataset_id: datasetId },
          datasetId,
        );
        setApplyTaskId(taskId);
      } catch {
        toast("Failed to apply operation", { variant: "error" });
        setApplyingOpId(null);
      }
    },
    [projectId, datasetId, dispatchTask, supabase],
  );

  const handleSkip = useCallback(
    async (op: CleaningOperation) => {
      await supabase
        .from("cleaning_operations")
        // @ts-expect-error — supabase update type inference
        .update({ status: "rejected" as Enums<"cleaning_op_status"> })
        .eq("id", op.id);
      // Move to next in one-at-a-time mode
      if (reviewMode === "one-at-a-time" && currentIndex >= actionable.length - 1) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    },
    [supabase, reviewMode, currentIndex, actionable.length],
  );

  const handleUndo = useCallback(
    async (op: CleaningOperation) => {
      await supabase
        .from("cleaning_operations")
        // @ts-expect-error — supabase update type inference
        .update({ status: "undone" as Enums<"cleaning_op_status"> })
        .eq("id", op.id);
      toast("Operation undone", { variant: "success" });
    },
    [supabase],
  );

  const handleBulkAction = useCallback(
    async (ops: CleaningOperation[], action: "apply" | "skip") => {
      if (action === "skip") {
        const ids = ops.map((o) => o.id);
        await supabase
          .from("cleaning_operations")
          // @ts-expect-error — supabase update type inference
          .update({ status: "rejected" as Enums<"cleaning_op_status"> })
          .in("id", ids);
        toast(`Skipped ${ids.length} operations`, { variant: "default" });
      } else {
        // Apply one-by-one (each needs a task)
        for (const op of ops) {
          await handleApply(op);
        }
      }
    },
    [supabase, handleApply],
  );

  const handleFinalize = useCallback(async () => {
    setIsFinalizing(true);
    try {
      const pipelineStatus: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "4": "completed",
        "5": "active",
      };

      await supabase
        .from("projects")
        // @ts-expect-error — supabase update type inference
        .update({
          current_step: 5,
          pipeline_status: pipelineStatus as unknown as Json,
        })
        .eq("id", projectId);

      toast("Data cleaning finalized! Moving to Step 5.", {
        variant: "success",
      });

      router.push(`/projects/${projectId}/step/5`);
    } catch {
      toast("Failed to finalize", { variant: "error" });
    } finally {
      setIsFinalizing(false);
    }
  }, [project.pipeline_status, supabase, projectId, router]);

  /* ---------- Generating state ---------- */
  const isGenerating =
    generateProgress.status === "running" ||
    generateProgress.status === "claimed" ||
    generateProgress.status === "pending";

  /* ================================================================ */
  /*  Render: No suggestions yet                                       */
  /* ================================================================ */

  if (cleaning.all.length === 0 && !isGenerating && !cleaning.isLoading) {
    return (
      <div className="mt-4 space-y-4">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wand2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="mb-4 text-sm text-muted-foreground">
              Generate AI-powered cleaning suggestions based on the quality
              analysis.
            </p>
            <Button onClick={handleGenerate} disabled={isDispatching}>
              {isDispatching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Dispatching...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  Generate Cleaning Suggestions
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Generating in progress                                   */
  /* ================================================================ */

  if (isGenerating && cleaning.all.length === 0) {
    return (
      <div className="mt-4 space-y-4">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <p className="font-medium">Generating cleaning suggestions...</p>
            </div>
            <Progress
              value={generateProgress.progress}
              className="h-2"
            />
            {generateProgress.progressMessage && (
              <p className="text-xs text-muted-foreground">
                {generateProgress.progressMessage}
              </p>
            )}
          </CardContent>
        </Card>
        <LoadingSkeleton type="card" count={3} />
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Clean data (0 suggestions generated)                     */
  /* ================================================================ */

  if (
    generateProgress.status === "completed" &&
    cleaning.all.length === 0
  ) {
    return (
      <div className="mt-4">
        <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="mb-4 h-12 w-12 text-green-500" />
            <p className="text-lg font-medium">Your data is clean!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No cleaning suggestions were generated.
            </p>
            <Button className="mt-6" onClick={handleFinalize} disabled={isFinalizing}>
              {isFinalizing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Finalize &amp; Continue to Step 5
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Suggestions exist — review flow                          */
  /* ================================================================ */

  const currentOp = actionable[currentIndex] ?? null;

  return (
    <div className="mt-4 space-y-4">
      {/* Review mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 rounded-lg bg-muted p-1">
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              reviewMode === "one-at-a-time"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setReviewMode("one-at-a-time")}
          >
            One at a time
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              reviewMode === "review-all"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setReviewMode("review-all")}
          >
            Review all
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {actionable.length} pending, {appliedOps.length} applied,{" "}
          {cleaning.rejected.length} skipped
        </p>
      </div>

      {/* ---------------------------------------------------------- */}
      {/*  One-at-a-time mode                                         */}
      {/* ---------------------------------------------------------- */}
      {reviewMode === "one-at-a-time" && currentOp && (
        <SuggestionCard
          op={currentOp}
          index={currentIndex}
          total={actionable.length}
          isApplying={applyingOpId === currentOp.id}
          applyProgress={applyingOpId === currentOp.id ? applyProgress.progress : 0}
          showSample={showSampleData}
          onToggleSample={() => setShowSampleData(!showSampleData)}
          onApply={() => handleApply(currentOp)}
          onSkip={() => handleSkip(currentOp)}
          onPrev={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
          onNext={() =>
            setCurrentIndex(Math.min(actionable.length - 1, currentIndex + 1))
          }
        />
      )}

      {reviewMode === "one-at-a-time" && !currentOp && actionable.length === 0 && cleaning.all.length > 0 && (
        <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="flex flex-col items-center py-8">
            <CheckCircle2 className="mb-3 h-8 w-8 text-green-500" />
            <p className="font-medium">All suggestions reviewed!</p>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------- */}
      {/*  Review-all mode                                             */}
      {/* ---------------------------------------------------------- */}
      {reviewMode === "review-all" && (
        <div className="space-y-6">
          {(Object.entries(grouped) as [CleaningCategory, CleaningOperation[]][])
            .filter(([, ops]) => ops.length > 0)
            .map(([category, ops]) => (
              <Card key={category}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {CATEGORY_LABELS[category]} ({ops.length})
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleBulkAction(ops, "skip")}
                      >
                        Skip all
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleBulkAction(ops, "apply")}
                      >
                        Accept all
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ops.map((op) => (
                    <CompactSuggestionCard
                      key={op.id}
                      op={op}
                      isApplying={applyingOpId === op.id}
                      onApply={() => handleApply(op)}
                      onSkip={() => handleSkip(op)}
                    />
                  ))}
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/*  Undo panel                                                  */}
      {/* ---------------------------------------------------------- */}
      {appliedOps.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="h-4 w-4 text-green-500" />
              Applied Operations ({appliedOps.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {appliedOps.map((op) => (
              <div
                key={op.id}
                className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50/50 p-3 dark:border-green-900 dark:bg-green-950/20"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">
                    {op.operation_type.replace(/_/g, " ")}
                  </span>
                  {op.column_name && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {op.column_name}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleUndo(op)}
                >
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                  Undo
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------- */}
      {/*  Finalize button                                             */}
      {/* ---------------------------------------------------------- */}
      {allReviewed && (
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium">Finalize Cleaned Dataset</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {appliedOps.length} operation
                  {appliedOps.length !== 1 ? "s" : ""} applied,{" "}
                  {cleaning.rejected.length} skipped
                </p>
              </div>
              <Button
                onClick={handleFinalize}
                disabled={isFinalizing}
              >
                {isFinalizing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                Finalize &amp; Continue to Step 5
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Suggestion cards                                                   */
/* ================================================================== */

interface SuggestionCardProps {
  op: CleaningOperation;
  index: number;
  total: number;
  isApplying: boolean;
  applyProgress: number;
  showSample: boolean;
  onToggleSample: () => void;
  onApply: () => void;
  onSkip: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function SuggestionCard({
  op,
  index,
  total,
  isApplying,
  applyProgress,
  showSample,
  onToggleSample,
  onApply,
  onSkip,
  onPrev,
  onNext,
}: SuggestionCardProps) {
  const impact = op.impact_preview as Record<string, string> | null;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-medium">
              {op.operation_type.replace(/_/g, " ")}
            </Badge>
            {op.column_name && (
              <span className="text-sm font-mono text-muted-foreground">
                {op.column_name}
              </span>
            )}
          </div>
          <SeverityBadge severity={op.severity} />
        </div>

        {/* Confidence bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-medium">{Math.round(op.confidence * 100)}%</span>
          </div>
          <Progress value={op.confidence * 100} className="h-2" />
        </div>

        {/* Stats row */}
        <div className="flex gap-4 text-sm">
          {op.affected_rows_estimate != null && (
            <div>
              <span className="text-muted-foreground">Affected rows: </span>
              <span className="font-medium">{op.affected_rows_estimate}</span>
            </div>
          )}
        </div>

        {/* AI reasoning */}
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            AI Reasoning
          </p>
          <p className="text-sm">{op.reasoning}</p>
        </div>

        {/* Impact on analysis */}
        {impact && (
          <div className="rounded-lg bg-blue-50/50 p-3 dark:bg-blue-950/20">
            <p className="mb-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
              Impact on Analysis
            </p>
            <p className="text-sm">{impact.description ?? op.description}</p>
          </div>
        )}

        {/* Sample data expandable */}
        <button
          onClick={onToggleSample}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showSample ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          Show sample data
        </button>

        {showSample && (
          <SampleDataPreview
            before={op.before_snapshot as Record<string, Json>[] | null}
            after={op.after_snapshot as Record<string, Json>[] | null}
          />
        )}

        {/* Apply progress */}
        {isApplying && (
          <div className="space-y-1">
            <Progress value={applyProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">Applying...</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex gap-2">
            <Button
              onClick={onApply}
              disabled={isApplying}
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isApplying ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              Apply
            </Button>
            <Button
              onClick={onSkip}
              disabled={isApplying}
              size="sm"
              variant="secondary"
            >
              Skip
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onPrev}
              disabled={index === 0}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {index + 1} of {total}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={onNext}
              disabled={index >= total - 1}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

interface CompactSuggestionCardProps {
  op: CleaningOperation;
  isApplying: boolean;
  onApply: () => void;
  onSkip: () => void;
}

function CompactSuggestionCard({
  op,
  isApplying,
  onApply,
  onSkip,
}: CompactSuggestionCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {op.operation_type.replace(/_/g, " ")}
          </Badge>
          {op.column_name && (
            <span className="text-xs font-mono text-muted-foreground">
              {op.column_name}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {Math.round(op.confidence * 100)}% confidence
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {op.reasoning}
        </p>
      </div>
      <div className="ml-3 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onSkip}
          disabled={isApplying}
        >
          Skip
        </Button>
        <Button
          size="sm"
          onClick={onApply}
          disabled={isApplying}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          {isApplying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Apply"
          )}
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Sample data preview                                                */
/* ================================================================== */

function SampleDataPreview({
  before,
  after,
}: {
  before: Record<string, Json>[] | null;
  after: Record<string, Json>[] | null;
}) {
  if (!before || before.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No sample data available
      </p>
    );
  }

  const cols = Object.keys(before[0]);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Before
        </p>
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                {cols.map((col) => (
                  <th key={col} className="px-2 py-1 text-left font-mono font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {before.slice(0, 3).map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {cols.map((col) => (
                    <td key={col} className="px-2 py-1 font-mono">
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {after && after.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-green-600 dark:text-green-400">
            After
          </p>
          <div className="overflow-x-auto rounded border border-green-200 dark:border-green-900">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-green-50/50 dark:bg-green-950/20">
                  {cols.map((col) => (
                    <th key={col} className="px-2 py-1 text-left font-mono font-medium">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {after.slice(0, 3).map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {cols.map((col) => (
                      <td key={col} className="px-2 py-1 font-mono">
                        {String(row[col] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Shared sub-components                                              */
/* ================================================================== */

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
