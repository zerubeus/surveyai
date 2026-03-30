"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useQualityResults } from "@/hooks/useQualityResults";
import { useCleaningSuggestions } from "@/hooks/useCleaningSuggestions";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useProgressToast } from "@/hooks/useProgressToast";
import { LoadingSkeleton } from "@/components/workflow/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Undo2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import type { Tables, Json } from "@/lib/types/database";

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

type Severity = "critical" | "warning" | "info";

interface IssueItem {
  id: string;
  severity: Severity;
  title: string;
  columnName?: string;
  description: string;
  consequence: string;
  suggestedFixes: CleaningOperation[];
  dismissed: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function scoreRingColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#d97706";
  return "#dc2626";
}

function scoreVerdict(score: number): string {
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  return "Needs Attention";
}

function formatBiasType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function buildIssues(
  columnProfiles: Tables<"eda_results">[],
  consistencyChecks: Tables<"eda_results">[],
  biasFlags: Tables<"eda_results">[],
  cleaningOps: CleaningOperation[],
): IssueItem[] {
  const issues: IssueItem[] = [];

  // From consistency checks → critical
  for (const check of consistencyChecks) {
    const checkIssues = (check.issues ?? []) as Array<{
      check_type?: string;
      severity?: string;
      description?: string;
      affected_rows_count?: number;
      affected_rows?: number;
      recommendation?: string;
    }>;
    for (const [i, issue] of checkIssues.entries()) {
      issues.push({
        id: `consistency-${check.id}-${i}`,
        severity: "critical",
        title: (issue.check_type ?? "Consistency issue")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        description:
          issue.description ?? "A consistency issue was detected in the data",
        consequence:
          issue.recommendation ??
          "Inconsistent data may lead to unreliable analysis results",
        suggestedFixes: [],
        dismissed: false,
      });
    }
  }

  // From column profiles → missing values + outliers
  for (const result of columnProfiles) {
    const profile = result.profile as Record<string, Json> | null;
    const colName = result.column_name ?? "unknown";
    const missingPct = (profile?.missing_pct as number) ?? 0;
    const outlierCount = (profile?.outlier_count as number) ?? 0;
    const colOps = cleaningOps.filter((op) => op.column_name === colName);

    if (missingPct > 0.15) {
      issues.push({
        id: `missing-critical-${result.id}`,
        severity: "critical",
        title: "High missing value rate",
        columnName: colName,
        description: `${(missingPct * 100).toFixed(1)}% of values are missing`,
        consequence:
          "Significant data loss may bias your results and reduce statistical power",
        suggestedFixes: colOps.filter(
          (op) =>
            op.operation_type === "standardize_missing" ||
            op.operation_type === "impute_value",
        ),
        dismissed: false,
      });
    } else if (missingPct > 0.05) {
      issues.push({
        id: `missing-warning-${result.id}`,
        severity: "warning",
        title: "Notable missing values",
        columnName: colName,
        description: `${(missingPct * 100).toFixed(1)}% of values are missing`,
        consequence:
          "Missing data may introduce bias in downstream analysis",
        suggestedFixes: colOps.filter(
          (op) =>
            op.operation_type === "standardize_missing" ||
            op.operation_type === "impute_value",
        ),
        dismissed: false,
      });
    }

    if (outlierCount > 0) {
      issues.push({
        id: `outlier-${result.id}`,
        severity: "warning",
        title: "Outliers detected",
        columnName: colName,
        description: `${outlierCount} outlier value${outlierCount !== 1 ? "s" : ""} found`,
        consequence:
          "Outliers may skew means, correlations, and regression results",
        suggestedFixes: colOps.filter(
          (op) => op.operation_type === "fix_outlier",
        ),
        dismissed: false,
      });
    }
  }

  // From bias flags → warning
  for (const flag of biasFlags) {
    const evidence = flag.bias_evidence as Record<string, Json> | null;
    issues.push({
      id: `bias-${flag.id}`,
      severity: "warning",
      title: formatBiasType(flag.bias_type ?? "unknown"),
      columnName: flag.column_name ?? undefined,
      description:
        (evidence?.description as string) ?? "Potential bias detected in data",
      consequence:
        flag.bias_recommendation ??
        "Analysis results may not be representative of the target population",
      suggestedFixes: flag.column_name
        ? cleaningOps.filter((op) => op.column_name === flag.column_name)
        : [],
      dismissed: false,
    });
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return issues;
}

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

  useProgressToast(edaProgress, { label: "Column profiling", thresholds: [50] });
  useProgressToast(consistencyProgress, { label: "Consistency checks" });
  useProgressToast(biasProgress, { label: "Bias detection" });
  useProgressToast(interpretProgress, { label: "AI interpretation" });

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

  /* ---------- Auto-dispatch interpretation + cleaning suggestions ---------- */
  const interpretDispatched = useRef(false);
  const cleaningDispatched = useRef(false);
  const [cleaningSuggestionsTaskId, setCleaningSuggestionsTaskId] = useState<string | null>(null);
  const cleaningSuggestionsProgress = useTaskProgress(cleaningSuggestionsTaskId);

  useEffect(() => {
    if (
      edaProgress.status === "completed" &&
      consistencyProgress.status === "completed" &&
      biasProgress.status === "completed" &&
      datasetId
    ) {
      // Auto-dispatch interpretation (best-effort)
      if (!interpretDispatched.current && !interpretTaskId) {
        interpretDispatched.current = true;
        dispatchTask(
          project.id,
          "interpret_results",
          { dataset_id: datasetId, project_id: project.id },
          datasetId,
        )
          .then(({ taskId }) => setInterpretTaskId(taskId))
          .catch(() => {});
      }
      // Auto-dispatch cleaning suggestions (so Step4 shows AI-suggested fixes per issue)
      if (!cleaningDispatched.current && cleaning.all.length === 0 && !cleaningSuggestionsTaskId) {
        cleaningDispatched.current = true;
        dispatchTask(
          project.id,
          "generate_cleaning_suggestions",
          { dataset_id: datasetId },
          datasetId,
        )
          .then(({ taskId }) => setCleaningSuggestionsTaskId(taskId))
          .catch(() => {});
      }
    }
  }, [
    edaProgress.status,
    consistencyProgress.status,
    biasProgress.status,
    interpretTaskId,
    cleaningSuggestionsTaskId,
    cleaning.all.length,
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
  const totalIssues = columnProfiles.reduce((sum, r) => {
    const issues = (r.issues as Array<Record<string, string>>) ?? [];
    return sum + issues.length;
  }, 0);

  /* ---------- Issue cards state ---------- */
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [selectedFixes, setSelectedFixes] = useState<Record<string, string>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [applyingIssueId, setApplyingIssueId] = useState<string | null>(null);
  const [fixApplyTaskId, setFixApplyTaskId] = useState<string | null>(null);
  const fixApplyProgress = useTaskProgress(fixApplyTaskId);

  /* ---------- Reset apply tracking ---------- */
  useEffect(() => {
    if (
      fixApplyProgress.status === "completed" ||
      fixApplyProgress.status === "failed"
    ) {
      if (fixApplyProgress.status === "completed") {
        toast("Fix applied successfully", { variant: "success" });
      } else {
        toast("Failed to apply fix", { variant: "error" });
      }
      setApplyingIssueId(null);
      setFixApplyTaskId(null);
    }
  }, [fixApplyProgress.status]);

  /* ---------- Build issues list ---------- */
  const allIssues = useMemo(
    () =>
      buildIssues(
        columnProfiles,
        consistencyChecks,
        biasFlags,
        cleaning.all,
      ),
    [columnProfiles, consistencyChecks, biasFlags, cleaning.all],
  );

  const activeIssues = useMemo(
    () => allIssues.filter((i) => !dismissedIds.has(i.id)),
    [allIssues, dismissedIds],
  );

  const dismissedIssues = useMemo(
    () => allIssues.filter((i) => dismissedIds.has(i.id)),
    [allIssues, dismissedIds],
  );

  const dismissedCriticalCount = useMemo(
    () => dismissedIssues.filter((i) => i.severity === "critical").length,
    [dismissedIssues],
  );

  /* ---------- Handlers ---------- */
  const handleDismiss = useCallback((issueId: string) => {
    setDismissedIds((prev) => new Set([...prev, issueId]));
  }, []);

  const handleUndismiss = useCallback((issueId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.delete(issueId);
      return next;
    });
  }, []);

  const handleApplyFix = useCallback(
    async (issue: IssueItem) => {
      if (!datasetId) return;
      const selected = selectedFixes[issue.id];
      if (!selected) return;

      setApplyingIssueId(issue.id);

      try {
        if (selected === "custom") {
          const customText = customTexts[issue.id];
          if (!customText?.trim()) {
            setApplyingIssueId(null);
            return;
          }
          // Insert a cleaning_operation record for the custom description,
          // then apply it via the standard task type (no custom enum needed)
          const { data: opData, error: opError } = await supabase
            .from("cleaning_operations")
            // @ts-ignore — supabase insert type inference
            .insert({
              dataset_id: datasetId,
              operation_type: "fix_encoding",
              column_name: issue.columnName ?? null,
              description: customText,
              rationale: "User-defined fix",
              status: "approved",
              priority: 99,
            })
            .select("id")
            .single();
          if (opError || !opData) {
            toast("Failed to save custom fix", { variant: "error" });
            setApplyingIssueId(null);
            return;
          }
          const { taskId } = await dispatchTask(
            project.id,
            "apply_cleaning_operation",
            { operation_id: (opData as { id: string }).id, dataset_id: datasetId },
            datasetId,
          );
          setFixApplyTaskId(taskId);
        } else {
          const { taskId } = await dispatchTask(
            project.id,
            "apply_cleaning_operation",
            { operation_id: selected, dataset_id: datasetId },
            datasetId,
          );
          setFixApplyTaskId(taskId);
        }
      } catch {
        toast("Failed to apply fix", { variant: "error" });
        setApplyingIssueId(null);
      }
    },
    [datasetId, selectedFixes, customTexts, dispatchTask, project.id, supabase],
  );

  const handleContinue = useCallback(() => {
    router.refresh();
    router.push(`/projects/${project.id}/step/5`);
  }, [router, project.id]);

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
                  Profiling your{" "}
                  {Object.keys(mappingsByColumn).length || "\u2026"} columns...
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
  /*  No results yet                                                   */
  /* ================================================================ */

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

  /* ================================================================ */
  /*  Main render                                                      */
  /* ================================================================ */

  const rowCount = dataset.row_count ?? 0;
  const colCount = dataset.column_count ?? columnProfiles.length;

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
                {consistencyProgress.error && (
                  <p>Consistency: {consistencyProgress.error}</p>
                )}
                {biasProgress.error && <p>Bias: {biasProgress.error}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============================================================ */}
      {/*  1. Header card — quality score                               */}
      {/* ============================================================ */}
      {overallQuality !== null && (
        <Card>
          <CardContent className="flex items-center gap-6 p-6">
            <ScoreRing score={overallQuality} />
            <div>
              <p className={`text-lg font-semibold ${scoreColor(overallQuality)}`}>
                {scoreVerdict(overallQuality)}
              </p>
              <p className="text-sm text-muted-foreground">
                {rowCount.toLocaleString()} rows &middot;{" "}
                {colCount} columns &middot;{" "}
                {allIssues.length} issue{allIssues.length !== 1 ? "s" : ""} found
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============================================================ */}
      {/*  2. Issue cards                                               */}
      {/* ============================================================ */}
      {activeIssues.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Issues ({activeIssues.length})
          </h3>
          <Accordion type="multiple" className="space-y-2">
            {activeIssues.map((issue) => (
              <AccordionItem
                key={issue.id}
                value={issue.id}
                className="rounded-lg border"
              >
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex flex-1 items-center gap-3 text-left">
                    <SeverityPill severity={issue.severity} />
                    {issue.columnName && (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                        {issue.columnName}
                      </code>
                    )}
                    <span className="text-sm font-medium">{issue.title}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4">
                  <div className="space-y-4">
                    {/* Consequence callout */}
                    <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                      If left unresolved: {issue.consequence}
                    </div>

                    {/* Suggested fixes */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Suggested fixes:</p>
                      <div className="space-y-2">
                        {issue.suggestedFixes.map((fix) => (
                          <label
                            key={fix.id}
                            className="flex items-start gap-2 rounded-md border p-2.5 text-sm cursor-pointer hover:bg-muted/30 transition-colors"
                          >
                            <input
                              type="radio"
                              name={`fix-${issue.id}`}
                              value={fix.id}
                              checked={selectedFixes[issue.id] === fix.id}
                              onChange={() =>
                                setSelectedFixes((prev) => ({
                                  ...prev,
                                  [issue.id]: fix.id,
                                }))
                              }
                              className="mt-0.5"
                            />
                            <span>{fix.description}</span>
                          </label>
                        ))}
                        <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm cursor-pointer hover:bg-muted/30 transition-colors">
                          <input
                            type="radio"
                            name={`fix-${issue.id}`}
                            value="custom"
                            checked={selectedFixes[issue.id] === "custom"}
                            onChange={() =>
                              setSelectedFixes((prev) => ({
                                ...prev,
                                [issue.id]: "custom",
                              }))
                            }
                            className="mt-0.5"
                          />
                          <span>Describe your own fix:</span>
                        </label>
                        {selectedFixes[issue.id] === "custom" && (
                          <Textarea
                            placeholder="e.g. Replace missing ages with the median age per job level"
                            value={customTexts[issue.id] ?? ""}
                            onChange={(e) =>
                              setCustomTexts((prev) => ({
                                ...prev,
                                [issue.id]: e.target.value,
                              }))
                            }
                            className="mt-1"
                          />
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleApplyFix(issue)}
                        disabled={
                          applyingIssueId === issue.id ||
                          !selectedFixes[issue.id] ||
                          (selectedFixes[issue.id] === "custom" &&
                            !customTexts[issue.id]?.trim())
                        }
                      >
                        {applyingIssueId === issue.id && (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        )}
                        Apply selected fix
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDismiss(issue.id)}
                      >
                        Ignore this issue
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}

      {activeIssues.length === 0 && hasResults && (
        <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="flex items-center gap-3 py-4 px-6">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              No issues found. Your data looks good!
            </p>
          </CardContent>
        </Card>
      )}

      {/* ============================================================ */}
      {/*  Dismissed issues collapsible                                 */}
      {/* ============================================================ */}
      {dismissedIssues.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-muted-foreground"
            >
              <span>
                {dismissedIssues.length} issue
                {dismissedIssues.length !== 1 ? "s" : ""} dismissed
              </span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {dismissedIssues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-center justify-between rounded-lg border bg-muted/20 p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <SeverityPill severity={issue.severity} />
                  {issue.columnName && (
                    <code className="text-xs font-mono text-muted-foreground">
                      {issue.columnName}
                    </code>
                  )}
                  <span className="text-muted-foreground">{issue.title}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleUndismiss(issue.id)}
                >
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                  Undo
                </Button>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* ============================================================ */}
      {/*  3. Footer                                                    */}
      {/* ============================================================ */}
      {dismissedCriticalCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            You have {dismissedCriticalCount} critical issue
            {dismissedCriticalCount !== 1 ? "s" : ""} dismissed — this may
            affect your analysis
          </span>
        </div>
      )}

      {hasResults && (
        <div className="flex justify-end border-t pt-4">
          <Button onClick={handleContinue}>
            Continue to Step 5: Cleaning
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = scoreRingColor(score);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/20"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

function SeverityPill({ severity }: { severity: Severity }) {
  if (severity === "critical")
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs">
        critical
      </Badge>
    );
  if (severity === "warning")
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-xs">
        warning
      </Badge>
    );
  return (
    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs">
      info
    </Badge>
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
