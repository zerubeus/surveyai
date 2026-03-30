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
import { ChangesSheet } from "@/components/workflow/ChangesSheet";
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
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Eye,
  Loader2,
  Undo2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import type { Tables, Json } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Project = Tables<"projects">;
type Dataset = Tables<"datasets">;
type ColumnMapping = Tables<"column_mappings">;
type CleaningOperation = Tables<"cleaning_operations">;
type EdaResult = Tables<"eda_results">;
type PipelineStatus = Record<string, string>;

interface Step4QualityProps {
  project: Project;
  dataset: Dataset | null;
  initialRunningTaskIds: Record<string, string>;
}

type Severity = "critical" | "warning" | "info";

interface AuditIssue {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  columnName?: string;
  affectedRowsCount?: number;
  recommendation: string;
  matchingOpId?: string; // cleaning_operation id that can fix this
  infoOnly?: boolean; // step-1 items have no ignore/apply
}

type AuditStepKey =
  | "step-1"
  | "step-2"
  | "step-3"
  | "step-4"
  | "step-5"
  | "step-6"
  | "step-7";

interface AuditSection {
  key: AuditStepKey;
  stepNum: number;
  name: string;
  issues: AuditIssue[];
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

function worstSeverity(issues: AuditIssue[]): Severity | null {
  if (issues.some((i) => i.severity === "critical")) return "critical";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  if (issues.some((i) => i.severity === "info")) return "info";
  return null;
}

/* ------------------------------------------------------------------ */
/*  Build 7 audit sections                                             */
/* ------------------------------------------------------------------ */

function buildAuditSections(
  columnProfiles: EdaResult[],
  datasetSummary: EdaResult | null,
  consistencyChecks: EdaResult[],
  biasFlags: EdaResult[],
  cleaningOps: CleaningOperation[],
  rowCount: number,
  colCount: number,
): AuditSection[] {
  const sections: AuditSection[] = [];

  // Helper: extract all consistency issues
  const allConsistencyIssues: Array<Record<string, unknown>> = [];
  for (const check of consistencyChecks) {
    const issues = (check.issues ?? []) as Array<Record<string, unknown>>;
    for (const issue of issues) {
      allConsistencyIssues.push(issue);
    }
  }

  // Helper: find a cleaning op for a column + type
  const findOp = (
    opTypes: string[],
    colName?: string | null,
  ): string | undefined => {
    const match = cleaningOps.find(
      (op) =>
        opTypes.includes(op.operation_type) &&
        (colName ? op.column_name === colName : true) &&
        (op.status === "pending" || op.status === "approved"),
    );
    return match?.id;
  };

  /* Step 1 — Initial Data Audit (informational) */
  const summaryProfile = datasetSummary?.profile as Record<string, unknown> | null;
  const overallQuality = (summaryProfile?.overall_quality as number) ?? null;

  // Data types breakdown
  const dataTypeMap: Record<string, number> = {};
  for (const cp of columnProfiles) {
    const dt = cp.data_type ?? "unknown";
    dataTypeMap[dt] = (dataTypeMap[dt] ?? 0) + 1;
  }
  const dtBreakdown = Object.entries(dataTypeMap)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");

  // Top 3 columns by missing %
  const colsByMissing = columnProfiles
    .map((cp) => {
      const p = cp.profile as Record<string, unknown> | null;
      return {
        name: cp.column_name ?? "unknown",
        missingPct: (p?.missing_pct as number) ?? 0,
      };
    })
    .filter((c) => c.missingPct > 0)
    .sort((a, b) => b.missingPct - a.missingPct)
    .slice(0, 3);

  const step1Issues: AuditIssue[] = [];
  step1Issues.push({
    id: "s1-overview",
    severity: "info",
    title: "Dataset Overview",
    description: `${rowCount.toLocaleString()} rows, ${colCount} columns${overallQuality != null ? `, quality score ${Math.round(overallQuality)}/100` : ""}`,
    recommendation: dtBreakdown ? `Data types: ${dtBreakdown}` : "No column profiles available yet",
    infoOnly: true,
  });
  if (colsByMissing.length > 0) {
    step1Issues.push({
      id: "s1-missing-top",
      severity: "info",
      title: "Columns with Most Missing Data",
      description: colsByMissing
        .map((c) => `${c.name}: ${(c.missingPct * 100).toFixed(1)}%`)
        .join(" · "),
      recommendation: "Review these columns in the Missing Data section below",
      infoOnly: true,
    });
  }

  sections.push({ key: "step-1", stepNum: 1, name: "Initial Data Audit", issues: step1Issues });

  /* Step 2 — Duplicate Detection */
  const dupIssues: AuditIssue[] = [];
  for (const ci of allConsistencyIssues) {
    const checkType = ci.check_type as string | undefined;
    if (checkType === "duplicate_rows" || checkType === "identifier_duplicates") {
      dupIssues.push({
        id: `s2-${checkType}-${dupIssues.length}`,
        severity: (ci.severity as Severity) ?? "critical",
        title: (checkType ?? "Duplicate").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: (ci.description as string) ?? "Duplicate entries detected",
        affectedRowsCount: (ci.affected_rows_count as number) ?? (ci.affected_rows as number) ?? undefined,
        recommendation: (ci.recommendation as string) ?? "Remove duplicate rows before analysis",
        matchingOpId: findOp(["remove_duplicates"], ci.column_name as string | undefined),
      });
    }
  }
  sections.push({ key: "step-2", stepNum: 2, name: "Duplicate Detection", issues: dupIssues });

  /* Step 3 — Response Quality */
  const rqIssues: AuditIssue[] = [];
  for (const flag of biasFlags) {
    const evidence = flag.bias_evidence as Record<string, unknown> | null;
    rqIssues.push({
      id: `s3-bias-${flag.id}`,
      severity: "warning",
      title: formatBiasType(flag.bias_type ?? "unknown"),
      columnName: flag.column_name ?? undefined,
      description: (evidence?.description as string) ?? "Potential bias detected",
      recommendation: flag.bias_recommendation ?? "Review data collection methodology",
      infoOnly: true, // Bias flags require methodology review, not data fixes
    });
  }
  for (const ci of allConsistencyIssues) {
    if ((ci.check_type as string) === "enumerator_entropy") {
      rqIssues.push({
        id: `s3-entropy-${rqIssues.length}`,
        severity: (ci.severity as Severity) ?? "warning",
        title: "Enumerator Entropy",
        columnName: ci.column_name as string | undefined,
        description: (ci.description as string) ?? "Unusual response patterns detected",
        recommendation: (ci.recommendation as string) ?? "Investigate enumerator data quality",
      });
    }
  }
  sections.push({ key: "step-3", stepNum: 3, name: "Response Quality", issues: rqIssues });

  /* Step 4 — Standardization & Recoding */
  const stdOps = cleaningOps.filter(
    (op) =>
      ["fix_encoding", "recode_values", "rename_column", "fix_data_type"].includes(op.operation_type) &&
      (op.status === "pending" || op.status === "approved"),
  );
  const stdIssues: AuditIssue[] = stdOps.map((op) => ({
    id: `s4-op-${op.id}`,
    severity: op.severity as Severity,
    title: op.description,
    columnName: op.column_name ?? undefined,
    description: op.reasoning,
    recommendation: op.description,
    matchingOpId: op.id,
  }));
  sections.push({ key: "step-4", stepNum: 4, name: "Standardization & Recoding", issues: stdIssues });

  /* Step 5 — Missing Data */
  const missingIssues: AuditIssue[] = [];
  const colsMissing = columnProfiles
    .map((cp) => {
      const p = cp.profile as Record<string, unknown> | null;
      return {
        result: cp,
        missingPct: (p?.missing_pct as number) ?? 0,
        missingCount: (p?.missing_count as number) ?? 0,
      };
    })
    .filter((c) => c.missingPct > 0.05)
    .sort((a, b) => b.missingPct - a.missingPct);

  for (const col of colsMissing) {
    const colName = col.result.column_name ?? "unknown";
    const sev: Severity = col.missingPct > 0.15 ? "critical" : "warning";
    missingIssues.push({
      id: `s5-missing-${col.result.id}`,
      severity: sev,
      title: `${colName} — ${(col.missingPct * 100).toFixed(1)}% missing`,
      columnName: colName,
      description: `${col.missingCount > 0 ? col.missingCount.toLocaleString() + " values" : (col.missingPct * 100).toFixed(1) + "%"} missing`,
      recommendation: col.missingPct > 0.15
        ? "Consider imputation or dropping this column"
        : "Impute or flag missing values",
      matchingOpId: findOp(["standardize_missing", "impute_value"], colName),
    });
  }
  // Also add high_missing_column consistency checks
  for (const ci of allConsistencyIssues) {
    if ((ci.check_type as string) === "high_missing_column") {
      const colName = ci.column_name as string | undefined;
      const alreadyListed = missingIssues.some((i) => i.columnName === colName);
      if (!alreadyListed) {
        missingIssues.push({
          id: `s5-hm-${missingIssues.length}`,
          severity: (ci.severity as Severity) ?? "warning",
          title: `${colName ?? "Column"} — high missing rate`,
          columnName: colName,
          description: (ci.description as string) ?? "High missing data rate",
          affectedRowsCount: (ci.affected_rows_count as number) ?? undefined,
          recommendation: (ci.recommendation as string) ?? "Investigate missing data pattern",
          matchingOpId: findOp(["standardize_missing", "impute_value"], colName),
        });
      }
    }
  }
  sections.push({ key: "step-5", stepNum: 5, name: "Missing Data", issues: missingIssues });

  /* Step 6 — Outlier Detection */
  const outlierIssues: AuditIssue[] = [];
  for (const cp of columnProfiles) {
    const p = cp.profile as Record<string, unknown> | null;
    const outlierCount = (p?.outlier_count as number) ?? 0;
    if (outlierCount <= 0) continue;
    const colName = cp.column_name ?? "unknown";
    const totalRows = rowCount || 1;
    const pct = ((outlierCount / totalRows) * 100).toFixed(1);
    outlierIssues.push({
      id: `s6-outlier-${cp.id}`,
      severity: "warning",
      title: `${colName} — ${outlierCount} outlier${outlierCount !== 1 ? "s" : ""}`,
      columnName: colName,
      description: `${outlierCount} outlier value${outlierCount !== 1 ? "s" : ""} (${pct}% of data)`,
      recommendation: "Cap, winsorize, or investigate outlier values",
      matchingOpId: findOp(["fix_outlier"], colName),
    });
  }
  // constraint_violation consistency checks
  for (const ci of allConsistencyIssues) {
    if ((ci.check_type as string) === "constraint_violation") {
      outlierIssues.push({
        id: `s6-constraint-${outlierIssues.length}`,
        severity: (ci.severity as Severity) ?? "warning",
        title: "Constraint Violation",
        columnName: ci.column_name as string | undefined,
        description: (ci.description as string) ?? "Data constraint violated",
        affectedRowsCount: (ci.affected_rows_count as number) ?? undefined,
        recommendation: (ci.recommendation as string) ?? "Fix out-of-range values",
        matchingOpId: findOp(["fix_outlier"], ci.column_name as string | undefined),
      });
    }
  }
  sections.push({ key: "step-6", stepNum: 6, name: "Outlier Detection", issues: outlierIssues });

  /* Step 7 — Skip Logic & Routing */
  const skipIssues: AuditIssue[] = [];
  for (const ci of allConsistencyIssues) {
    if ((ci.check_type as string) === "skip_logic_violation") {
      const matchingOp = findOp(["fix_skip_logic"], ci.column_name as string | undefined);
      skipIssues.push({
        id: `s7-skip-${skipIssues.length}`,
        severity: (ci.severity as Severity) ?? "warning",
        title: "Skip Logic Violation",
        columnName: ci.column_name as string | undefined,
        description: (ci.description as string) ?? "Skip logic was not applied correctly",
        affectedRowsCount: (ci.affected_rows_count as number) ?? undefined,
        recommendation: (ci.recommendation as string) ?? "Verify skip logic in data collection",
        matchingOpId: matchingOp,
        // Structural routing issues with no fix operation are info-only
        infoOnly: !matchingOp,
      });
    }
  }
  sections.push({ key: "step-7", stepNum: 7, name: "Skip Logic & Routing", issues: skipIssues });

  return sections;
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
  const cleaning = useCleaningSuggestions(datasetId, project.id);

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
      if (!interpretDispatched.current && !interpretTaskId) {
        interpretDispatched.current = true;
        dispatchTask(
          project.id,
          "interpret_results",
          { dataset_id: datasetId, project_id: project.id },
          datasetId,
        )
          .then(({ taskId }) => setInterpretTaskId(taskId))
          .catch((err) => console.error("Failed to dispatch interpret_results:", err));
      }
      if (!cleaningDispatched.current && cleaning.all.length === 0 && !cleaningSuggestionsTaskId) {
        cleaningDispatched.current = true;
        dispatchTask(
          project.id,
          "generate_cleaning_suggestions",
          { dataset_id: datasetId },
          datasetId,
        )
          .then(({ taskId }) => setCleaningSuggestionsTaskId(taskId))
          .catch((err) => console.error("Failed to dispatch generate_cleaning_suggestions:", err));
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

  /* ---------- Cleaning suggestions loading state ---------- */
  const cleaningSuggestionsLoading =
    (cleaningSuggestionsProgress.status === "running" ||
      cleaningSuggestionsProgress.status === "pending" ||
      cleaningSuggestionsProgress.status === "claimed") &&
    cleaning.all.length === 0;

  /* ---------- Dismissed + applying state ---------- */
  // Parse quality_dismissed_ids from project.additional_context on mount
  const initialDismissedIds = useMemo(() => {
    try {
      const ctx = project.additional_context
        ? JSON.parse(project.additional_context)
        : {};
      const ids = ctx.quality_dismissed_ids;
      return Array.isArray(ids) ? new Set<string>(ids) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  }, [project.additional_context]);

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(initialDismissedIds);
  const [applyingIssueId, setApplyingIssueId] = useState<string | null>(null);
  const [fixApplyTaskId, setFixApplyTaskId] = useState<string | null>(null);
  // Custom action text per issue
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({});
  const fixApplyProgress = useTaskProgress(fixApplyTaskId);

  // Track applied operation IDs for visual state
  const appliedOpIds = useMemo(() => {
    return new Set(cleaning.applied.map((op) => op.id));
  }, [cleaning.applied]);

  // Debounce-save dismissedIds to project.additional_context
  const dismissedIdsRef = useRef(dismissedIds);
  dismissedIdsRef.current = dismissedIds;

  useEffect(() => {
    // Skip if dismissedIds hasn't changed from initial
    if (dismissedIds.size === initialDismissedIds.size &&
        [...dismissedIds].every((id) => initialDismissedIds.has(id))) {
      return;
    }
    const t = setTimeout(async () => {
      try {
        const currentCtx = project.additional_context
          ? JSON.parse(project.additional_context)
          : {};
        const newCtx = {
          ...currentCtx,
          quality_dismissed_ids: [...dismissedIdsRef.current],
        };
        await supabase
          .from("projects")
          // @ts-ignore — supabase update type inference
          .update({ additional_context: JSON.stringify(newCtx) })
          .eq("id", project.id);
      } catch (e) {
        console.error("Failed to persist dismissed IDs:", e);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [dismissedIds, initialDismissedIds, project.additional_context, project.id, supabase]);

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

  /* ---------- Changes sheet state ---------- */
  const [isChangesSheetOpen, setIsChangesSheetOpen] = useState(false);

  /* ---------- Build 7 audit sections ---------- */
  const rowCount = dataset?.row_count ?? 0;
  const colCount = dataset?.column_count ?? columnProfiles.length;

  const auditSections = useMemo(
    () =>
      buildAuditSections(
        columnProfiles,
        datasetSummary,
        consistencyChecks,
        biasFlags,
        cleaning.all,
        rowCount,
        colCount,
      ),
    [columnProfiles, datasetSummary, consistencyChecks, biasFlags, cleaning.all, rowCount, colCount],
  );

  const totalIssueCount = useMemo(
    () => auditSections.reduce((sum, s) => sum + (s.key === "step-1" ? 0 : s.issues.length), 0),
    [auditSections],
  );

  /* ---------- Compute displayScore factoring in unresolved issues ---------- */
  const displayScore = useMemo(() => {
    const baseScore = overallQuality ?? 100;
    let penalty = 0;
    for (const section of auditSections) {
      if (section.key === "step-1") continue; // info-only section
      for (const issue of section.issues) {
        if (dismissedIds.has(issue.id)) continue; // already dismissed
        if (issue.infoOnly) continue;
        // Apply penalty based on severity
        if (issue.severity === "critical") penalty += 15;
        else if (issue.severity === "warning") penalty += 8;
        else penalty += 2; // info
      }
    }
    return Math.max(0, Math.min(100, Math.round(baseScore - penalty)));
  }, [overallQuality, auditSections, dismissedIds]);

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
    async (issue: AuditIssue) => {
      if (!datasetId) return;
      setApplyingIssueId(issue.id);
      try {
        const customText = customTexts[issue.id]?.trim();

        // Get current user for approved_by field
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const userId = user?.id;
        if (!userId) throw new Error("Not authenticated");

        if (customText) {
          // Insert custom cleaning operation
          // Use recode_values with title_case as a safe no-op transform for custom actions
          const { data: opData, error: opErr } = await supabase
            .from("cleaning_operations")
            // @ts-ignore
            .insert({
              dataset_id: datasetId,
              operation_type: "recode_values",
              column_name: issue.columnName ?? null,
              description: customText,
              reasoning: `User-defined action for: ${issue.title}`,
              severity: issue.severity,
              confidence: 1.0,
              status: "approved",
              approved_by: userId,
              priority: 99,
              parameters: { method: "title_case" },
            })
            .select("id")
            .single();
          if (opErr || !opData) throw new Error(opErr?.message ?? "Failed to save custom action");
          const { taskId } = await dispatchTask(
            project.id,
            "apply_cleaning_operation",
            { operation_id: (opData as { id: string }).id, dataset_id: datasetId, approved_by: userId },
            datasetId,
          );
          setFixApplyTaskId(taskId);
        } else if (issue.matchingOpId) {
          await supabase
            .from("cleaning_operations")
            // @ts-ignore
            .update({ status: "approved", approved_by: userId })
            .eq("id", issue.matchingOpId);
          const { taskId } = await dispatchTask(
            project.id,
            "apply_cleaning_operation",
            { operation_id: issue.matchingOpId, dataset_id: datasetId, approved_by: userId },
            datasetId,
          );
          setFixApplyTaskId(taskId);
        } else {
          // No op and no custom text — just mark dismissed
          handleDismiss(issue.id);
          setApplyingIssueId(null);
          return;
        }
        // Clear custom input after apply
        setCustomTexts((prev) => { const next = { ...prev }; delete next[issue.id]; return next; });
        setShowCustomInput((prev) => { const next = { ...prev }; delete next[issue.id]; return next; });
      } catch (e) {
        toast("Failed to apply fix", { variant: "error" });
        setApplyingIssueId(null);
      }
    },
    [datasetId, dispatchTask, project.id, supabase, customTexts, handleDismiss],
  );

  const handleContinue = useCallback(async () => {
    const newPipeline: PipelineStatus = {
      ...((project.pipeline_status as PipelineStatus) ?? {}),
      "4": "completed",
      "5": "active",
    };
    await supabase
      .from("projects")
      // @ts-ignore — supabase update type inference
      .update({ current_step: 5, pipeline_status: newPipeline as unknown as Json })
      .eq("id", project.id);
    router.refresh();
    router.push(`/projects/${project.id}/step/5`);
  }, [router, project.id, project.pipeline_status, supabase]);

  // Skip Step 5 and go directly to Analysis when all issues resolved
  const handleContinueToAnalysis = useCallback(async () => {
    const newPipeline: PipelineStatus = {
      ...((project.pipeline_status as PipelineStatus) ?? {}),
      "4": "completed",
      "5": "completed",
      "6": "active",
    };
    await supabase
      .from("projects")
      // @ts-ignore — supabase update type inference
      .update({ current_step: 6, pipeline_status: newPipeline as unknown as Json })
      .eq("id", project.id);
    toast("Dataset ready for analysis", { variant: "success" });
    router.refresh();
    router.push(`/projects/${project.id}/step/6`);
  }, [router, project.id, project.pipeline_status, supabase]);

  // Skip remaining issues and proceed to analysis
  const handleSkipRemaining = useCallback(async () => {
    // Dismiss all remaining unresolved issues
    const activeIssues = auditSections.flatMap((s) =>
      s.issues.filter((i) => !dismissedIds.has(i.id) && !i.infoOnly)
    );
    if (activeIssues.length > 0) {
      setDismissedIds((prev) => new Set([...prev, ...activeIssues.map((i) => i.id)]));
    }
    await handleContinueToAnalysis();
  }, [auditSections, dismissedIds, handleContinueToAnalysis]);

  const handleApproveAll = useCallback(async () => {
    // Get current user for approved_by field
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id;

    // Find all active non-info issues with matchingOpId
    const activeIssues = auditSections.flatMap((s) =>
      s.issues.filter((i) => !dismissedIds.has(i.id) && !i.infoOnly)
    );

    // Approve all matching cleaning operations
    const fixableIssues = activeIssues.filter((i) => i.matchingOpId);
    if (fixableIssues.length > 0 && userId) {
      const opIds = fixableIssues.map((i) => i.matchingOpId!);
      await supabase
        .from("cleaning_operations")
        // @ts-ignore
        .update({ status: "approved", approved_by: userId })
        .in("id", opIds);
    }

    // Dismiss all active issues (both fixable and non-fixable)
    if (activeIssues.length > 0) {
      setDismissedIds((prev) => new Set([...prev, ...activeIssues.map((i) => i.id)]));
    }
    await handleContinueToAnalysis();
  }, [auditSections, dismissedIds, handleContinueToAnalysis, supabase]);

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
  /*  Loading skeleton                                                 */
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
  /*  Main render — 7-step audit                                       */
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
                {consistencyProgress.error && (
                  <p>Consistency: {consistencyProgress.error}</p>
                )}
                {biasProgress.error && <p>Bias: {biasProgress.error}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header card — quality score + summary */}
      <Card>
        <CardContent className="flex items-center gap-6 p-6">
          {overallQuality !== null ? (
            <ScoreRing score={displayScore} />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-muted">
              <span className="text-lg font-bold text-muted-foreground">--</span>
            </div>
          )}
          <div>
            {overallQuality !== null && (
              <p className={`text-lg font-semibold ${scoreColor(displayScore)}`}>
                {scoreVerdict(displayScore)}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {rowCount.toLocaleString()} rows &middot;{" "}
              {colCount} columns &middot;{" "}
              {totalIssueCount} issue{totalIssueCount !== 1 ? "s" : ""} found
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 7-step audit accordion */}
      <Accordion type="multiple" defaultValue={["step-1"]} className="space-y-2">
        {auditSections.map((section) => {
          const activeIssues = section.issues.filter((i) => !dismissedIds.has(i.id));
          const sectionDismissed = section.issues.filter((i) => dismissedIds.has(i.id));
          const issueCount = section.key === "step-1" ? 0 : activeIssues.length;
          const sev = section.key === "step-1" ? null : worstSeverity(activeIssues);

          return (
            <AccordionItem
              key={section.key}
              value={section.key}
              className="rounded-lg border"
            >
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex flex-1 items-center gap-3 text-left">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {section.stepNum}
                  </span>
                  <span className="text-sm font-medium">{section.name}</span>
                  {issueCount > 0 && sev && (
                    <SeverityCountBadge severity={sev} count={issueCount} />
                  )}
                  {issueCount === 0 && section.key !== "step-1" && (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
                      All clear &#10003;
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {activeIssues.length === 0 && section.key !== "step-1" && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No issues in this category.
                  </p>
                )}

                <div className="space-y-3">
                  {activeIssues.map((issue) => {
                    // Find matching cleaning operation for suggested fix label
                    const matchingOp = issue.matchingOpId
                      ? cleaning.all.find((op) => op.id === issue.matchingOpId)
                      : null;
                    const suggestedFixLabel = matchingOp?.description ?? "Apply suggested fix";
                    // Check if this issue's fix has been applied
                    const isApplied = issue.matchingOpId && appliedOpIds.has(issue.matchingOpId);

                    // Transform recommendation to first-person expert voice
                    const expertVoice = issue.recommendation
                      .replace(/^Consider /i, "I'd suggest ")
                      .replace(/^Investigate /i, "I'd recommend investigating ")
                      .replace(/^Review /i, "I'd recommend reviewing ")
                      .replace(/^Verify /i, "I'd suggest verifying ")
                      .replace(/^Check /i, "I'd check ")
                      .replace(/^Remove /i, "I'll remove ")
                      .replace(/^Fix /i, "I'll fix ")
                      .replace(/^Cap /i, "I'll cap ")
                      .replace(/^Impute /i, "I'll impute ");

                    // Show applied confirmation card
                    if (isApplied) {
                      return (
                        <div
                          key={issue.id}
                          className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                            <span className="text-sm font-medium text-green-800 dark:text-green-200">
                              Fixed: {issue.title}
                            </span>
                            {issue.columnName && (
                              <code className="rounded bg-green-100 dark:bg-green-900 px-1.5 py-0.5 text-xs font-mono text-green-700 dark:text-green-300">
                                {issue.columnName}
                              </code>
                            )}
                          </div>
                          <p className="text-sm text-green-700 dark:text-green-300">
                            {suggestedFixLabel}
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={issue.id}
                        className="rounded-lg border p-4 space-y-3"
                      >
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <SeverityPill severity={issue.severity} />
                            <span className="text-sm font-medium">{issue.title}</span>
                            {issue.columnName && (
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                                {issue.columnName}
                              </code>
                            )}
                          </div>
                          {!issue.infoOnly && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => handleDismiss(issue.id)}
                              title="Dismiss this issue"
                            >
                              ×
                            </Button>
                          )}
                        </div>

                        {/* Description */}
                        <p className="text-sm text-muted-foreground">
                          {issue.description}
                          {issue.affectedRowsCount != null && (
                            <span className="ml-1.5 text-xs">
                              ({issue.affectedRowsCount.toLocaleString()} rows affected)
                            </span>
                          )}
                        </p>

                        {/* Expert voice explanation */}
                        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 p-3">
                          <p className="text-sm text-blue-900 dark:text-blue-100 italic">
                            "{expertVoice}"
                          </p>
                        </div>

                        {/* Action area */}
                        {issue.infoOnly ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="text-base">📌</span>
                            <span>Noted — no direct data fix available. Keep this in mind when interpreting results.</span>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* Suggested fix label */}
                            {issue.matchingOpId && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-primary">✦</span>
                                <span className="font-medium">Suggested fix:</span>
                                <span className="text-muted-foreground">{suggestedFixLabel}</span>
                              </div>
                            )}

                            {/* Custom action input */}
                            {showCustomInput[issue.id] && (
                              <div className="space-y-2 rounded border p-3 bg-muted/30">
                                <p className="text-xs font-medium text-muted-foreground">Describe what to do:</p>
                                <Textarea
                                  placeholder="e.g., Remove rows where age > 120, or impute with group median by region…"
                                  rows={2}
                                  className="text-sm"
                                  value={customTexts[issue.id] ?? ""}
                                  onChange={(e) =>
                                    setCustomTexts((prev) => ({ ...prev, [issue.id]: e.target.value }))
                                  }
                                />
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleApplyFix(issue)}
                                disabled={
                                  applyingIssueId === issue.id ||
                                  (!cleaningSuggestionsLoading && !issue.matchingOpId && !customTexts[issue.id]?.trim())
                                }
                              >
                                {applyingIssueId === issue.id ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : cleaningSuggestionsLoading && !issue.matchingOpId ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : null}
                                {applyingIssueId === issue.id
                                  ? "Applying…"
                                  : cleaningSuggestionsLoading && !issue.matchingOpId
                                    ? "Generating fix…"
                                    : customTexts[issue.id]?.trim()
                                      ? "Apply Custom"
                                      : "Apply this fix"}
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setShowCustomInput((prev) => ({ ...prev, [issue.id]: !prev[issue.id] }))
                                }
                              >
                                <ChevronDown className={`mr-1.5 h-3.5 w-3.5 transition-transform ${showCustomInput[issue.id] ? "rotate-180" : ""}`} />
                                {showCustomInput[issue.id] ? "Cancel" : "Use a different approach"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Dismissed issues footer */}
                {sectionDismissed.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 w-full justify-between text-muted-foreground"
                      >
                        <span>
                          {sectionDismissed.length} ignored{" "}
                          <ChevronDown className="inline h-3.5 w-3.5" />
                        </span>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-1 pt-1">
                      {sectionDismissed.map((issue) => (
                        <div
                          key={issue.id}
                          className="flex items-center justify-between rounded border bg-muted/20 px-3 py-1.5 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <SeverityPill severity={issue.severity} />
                            <span className="text-muted-foreground text-xs">
                              {issue.title}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleUndismiss(issue.id)}
                          >
                            <Undo2 className="mr-1 h-3 w-3" />
                            Undo
                          </Button>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Bottom action row */}
      {hasResults && (() => {
        // Count unresolved fixable issues (have matchingOpId, not dismissed, not infoOnly)
        const unresolvedFixable = auditSections.flatMap((s) =>
          s.issues.filter((i) => !dismissedIds.has(i.id) && !i.infoOnly && i.matchingOpId)
        );
        const hasUnresolvedFixable = unresolvedFixable.length > 0;

        // Count applied fixes and changed cells
        const appliedOps = cleaning.all.filter((op) => op.status === "applied");
        const appliedCount = appliedOps.length;
        const notedCount = auditSections.flatMap((s) =>
          s.issues.filter((i) => i.infoOnly && !dismissedIds.has(i.id))
        ).length;

        // Count total changed cells from applied operations
        const totalChangedCells = appliedOps.reduce((sum, op) => {
          const snapshot = op.after_snapshot as { changed_row_indices?: number[] } | null;
          return sum + (snapshot?.changed_row_indices?.length ?? 0);
        }, 0);

        return (
          <div className="space-y-3 border-t pt-4">
            {/* Expert summary when all clear */}
            {!hasUnresolvedFixable && (appliedCount > 0 || notedCount > 0) && (
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4">
                <p className="text-sm text-green-800 dark:text-green-200">
                  <CheckCircle2 className="inline mr-2 h-4 w-4" />
                  Your dataset is ready for analysis.
                  {appliedCount > 0 && ` ${appliedCount} fix${appliedCount !== 1 ? "es" : ""} applied`}
                  {appliedCount > 0 && notedCount > 0 && ","}
                  {notedCount > 0 && ` ${notedCount} issue${notedCount !== 1 ? "s" : ""} noted for interpretation`}.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-sm text-muted-foreground">
                  {totalIssueCount === 0
                    ? "No issues found"
                    : `${totalIssueCount} issue${totalIssueCount !== 1 ? "s" : ""} reviewed`}
                  {hasUnresolvedFixable && ` · ${unresolvedFixable.length} pending`}
                </div>
                {/* View applied changes button */}
                {appliedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsChangesSheetOpen(true)}
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    View applied changes
                    {totalChangedCells > 0 && ` (${totalChangedCells} cells)`}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {hasUnresolvedFixable ? (
                  <>
                    <Button variant="ghost" onClick={handleSkipRemaining}>
                      Skip remaining issues
                    </Button>
                    <Button onClick={handleContinueToAnalysis} disabled={true} title="Apply or dismiss all flagged issues first">
                      Continue to Analysis
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleContinueToAnalysis}>
                    Continue to Analysis
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Changes side sheet */}
      {dataset && (
        <ChangesSheet
          dataset={dataset}
          appliedOps={cleaning.applied}
          isOpen={isChangesSheetOpen}
          onClose={() => setIsChangesSheetOpen(false)}
        />
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

function SeverityCountBadge({
  severity,
  count,
}: {
  severity: Severity;
  count: number;
}) {
  const colors: Record<Severity, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };
  return (
    <Badge className={`${colors[severity]} text-xs`}>
      {count} issue{count !== 1 ? "s" : ""}
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
