"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Hash,
  Layers,
  BarChart3,
  Target,
  GitBranch,
  MessageSquare,
  FileText,
  Eye,
  EyeOff,
  Users,
  Weight,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useColumnMappings } from "@/hooks/useColumnMappings";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { toast } from "@/lib/toast";
import type { Tables, Enums, PipelineStatus, Json } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Step3ColumnRolesProps {
  project: Tables<"projects">;
  dataset: Tables<"datasets"> | null;
  initialMappings: Tables<"column_mappings">[];
}

type ColumnRole = Enums<"column_role">;

type FilterTab = "all" | "needs_review" | "confirmed";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ROLE_OPTIONS: { value: ColumnRole; label: string; icon: typeof Hash }[] = [
  { value: "identifier", label: "Identifier", icon: Hash },
  { value: "weight", label: "Weight", icon: Weight },
  { value: "cluster_id", label: "Cluster ID", icon: Layers },
  { value: "stratum", label: "Stratum", icon: Layers },
  { value: "demographic", label: "Demographic", icon: Users },
  { value: "outcome", label: "Outcome", icon: Target },
  { value: "covariate", label: "Covariate", icon: BarChart3 },
  { value: "skip_logic", label: "Skip Logic", icon: GitBranch },
  { value: "metadata", label: "Metadata", icon: FileText },
  { value: "open_text", label: "Open Text", icon: MessageSquare },
  { value: "ignore", label: "Ignore", icon: EyeOff },
];

const ROLE_CHANGE_TOASTS: Partial<Record<ColumnRole, string>> = {
  weight: "All analyses will now account for survey weights",
  cluster_id: "Standard errors will be adjusted for clustering",
  stratum: "Stratification will be applied in weighted analysis",
  identifier: "This column will be excluded from analysis",
};

const DATA_TYPE_LABELS: Record<string, string> = {
  continuous: "Continuous",
  categorical: "Categorical",
  binary: "Binary",
  ordinal: "Ordinal",
  likert: "Likert",
  date: "Date",
  text: "Text",
  identifier: "Identifier",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSampleValues(
  dataset: Tables<"datasets"> | null,
  columnName: string,
): string[] {
  if (!dataset?.columns) return [];
  const cols = dataset.columns as Array<{
    name: string;
    sample_values?: string[];
  }>;
  const col = cols.find((c) => c.name === columnName);
  return col?.sample_values?.slice(0, 3) ?? [];
}

function confidenceColor(confidence: number | null): string {
  if (confidence === null) return "bg-gray-400";
  if (confidence >= 0.85) return "bg-green-500";
  if (confidence >= 0.5) return "bg-yellow-500";
  return "bg-red-500";
}

function confidenceLabel(confidence: number | null): string {
  if (confidence === null) return "Unknown";
  return `${Math.round(confidence * 100)}%`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Step3ColumnRoles({
  project,
  dataset,
  initialMappings,
}: Step3ColumnRolesProps) {
  const router = useRouter();
  const supabase = createBrowserClient();

  // Column mappings hook (Realtime)
  const {
    mappings,
    isLoading: mappingsLoading,
    updateRole,
    confirmAll,
    refetch,
  } = useColumnMappings(dataset?.id ?? null);

  // Use initial mappings until hook loads
  const effectiveMappings = mappingsLoading ? initialMappings : mappings;

  // Task dispatching
  const { dispatchTask, isDispatching } = useDispatchTask();

  // Detection task tracking
  const [detectTaskId, setDetectTaskId] = useState<string | null>(null);
  const detectProgress = useTaskProgress(detectTaskId);
  const hasDispatched = useRef(false);

  // UI state
  const [filter, setFilter] = useState<FilterTab>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRedetecting, setIsRedetecting] = useState(false);

  // ---- Auto-dispatch detect_column_roles on first visit ----
  useEffect(() => {
    if (hasDispatched.current) return;
    if (!dataset?.id) return;
    // Only dispatch if no mappings exist yet
    if (initialMappings.length > 0) return;

    hasDispatched.current = true;

    dispatchTask(project.id, "detect_column_roles", {}, dataset.id)
      .then(({ taskId }) => setDetectTaskId(taskId))
      .catch((err) => {
        console.error("Failed to dispatch detect_column_roles:", err);
        toast("Failed to start column detection", { variant: "error" });
      });
  }, [dataset?.id, project.id, initialMappings.length, dispatchTask]);

  // When detection completes, refetch mappings
  useEffect(() => {
    if (detectProgress.status === "completed") {
      refetch();
    }
  }, [detectProgress.status, refetch]);

  // ---- Computed values ----
  const counts = useMemo(() => {
    const total = effectiveMappings.length;
    const confirmed = effectiveMappings.filter((m) => m.confirmed_by).length;
    const needsReview = effectiveMappings.filter(
      (m) => !m.confirmed_by && (m.detection_confidence ?? 0) < 0.85,
    ).length;
    return { total, confirmed, needsReview };
  }, [effectiveMappings]);

  const filteredMappings = useMemo(() => {
    let list = [...effectiveMappings];

    if (filter === "needs_review") {
      list = list.filter(
        (m) => !m.confirmed_by && (m.detection_confidence ?? 0) < 0.85,
      );
    } else if (filter === "confirmed") {
      list = list.filter((m) => m.confirmed_by);
    }

    // Sort: low confidence first
    list.sort(
      (a, b) =>
        (a.detection_confidence ?? 0) - (b.detection_confidence ?? 0),
    );

    return list;
  }, [effectiveMappings, filter]);

  // Auto-select "Needs review" tab if there are items
  useEffect(() => {
    if (counts.needsReview > 0 && effectiveMappings.length > 0 && filter === "all") {
      setFilter("needs_review");
    }
  }, [counts.needsReview, effectiveMappings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Weight warning ----
  const unconfirmedWeight = effectiveMappings.find(
    (m) => m.role === "weight" && !m.confirmed_by,
  );

  // ---- Handlers ----

  const handleRoleChange = useCallback(
    async (mappingId: string, newRole: ColumnRole) => {
      try {
        await updateRole(mappingId, newRole);
        const toastMsg = ROLE_CHANGE_TOASTS[newRole];
        if (toastMsg) {
          toast(toastMsg, { variant: "default" });
        }
      } catch (err) {
        console.error("Role update failed:", err);
        toast("Failed to update role", { variant: "error" });
      }
    },
    [updateRole],
  );

  const handleSelectToggle = useCallback((mappingId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mappingId)) {
        next.delete(mappingId);
      } else {
        next.add(mappingId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const ids = filteredMappings.map((m) => m.id);
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) {
        // Deselect all in current view
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      // Select all in current view
      return new Set([...prev, ...ids]);
    });
  }, [filteredMappings]);

  const handleConfirmSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setIsConfirming(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("column_mappings")
        .update({ confirmed_by: user.id, confirmed_at: now })
        .in("id", [...selected]);

      if (error) throw new Error(error.message);
      setSelected(new Set());
      refetch();
      toast(`${selected.size} column(s) confirmed`, { variant: "success" });
    } catch (err) {
      console.error("Confirm selected failed:", err);
      toast("Failed to confirm columns", { variant: "error" });
    } finally {
      setIsConfirming(false);
    }
  }, [selected, supabase, refetch]);

  const handleRedetectSelected = useCallback(async () => {
    if (selected.size === 0 || !dataset?.id) return;
    setIsRedetecting(true);
    try {
      const columnNames = effectiveMappings
        .filter((m) => selected.has(m.id))
        .map((m) => m.column_name);

      const { taskId } = await dispatchTask(
        project.id,
        "detect_column_roles",
        { columns: columnNames },
        dataset.id,
      );
      setDetectTaskId(taskId);
      setSelected(new Set());
      toast("Re-detecting roles for selected columns...", { variant: "default" });
    } catch (err) {
      console.error("Re-detect failed:", err);
      toast("Failed to re-detect roles", { variant: "error" });
    } finally {
      setIsRedetecting(false);
    }
  }, [selected, dataset?.id, effectiveMappings, dispatchTask, project.id]);

  const handleConfirmAllAndContinue = useCallback(async () => {
    if (!dataset?.id) return;
    setIsConfirming(true);

    try {
      // 1. Confirm all unconfirmed mappings
      await confirmAll();

      // 2. Dispatch 3 analysis tasks in parallel
      const taskPromises = [
        dispatchTask(project.id, "run_eda", {}, dataset.id),
        dispatchTask(project.id, "run_consistency_checks", {}, dataset.id),
        dispatchTask(project.id, "run_bias_detection", {}, dataset.id),
      ];
      await Promise.all(taskPromises);

      // 3. Update pipeline status
      const pipelineStatus: PipelineStatus = {
        ...((project.pipeline_status as PipelineStatus) ?? {}),
        "3": "completed",
        "4": "active",
      };

      await supabase
        .from("projects")
        .update({
          current_step: 4,
          pipeline_status: pipelineStatus as unknown as Json,
        })
        .eq("id", project.id);

      toast("Analysis started. Continue to Data Quality to see results.", {
        variant: "success",
      });

      router.push(`/projects/${project.id}/step/4`);
    } catch (err) {
      console.error("Confirm all failed:", err);
      toast("Failed to confirm roles", { variant: "error" });
    } finally {
      setIsConfirming(false);
    }
  }, [dataset?.id, confirmAll, dispatchTask, project, supabase, router]);

  /* ================================================================ */
  /*  Detection in-progress state                                     */
  /* ================================================================ */

  const isDetecting =
    detectTaskId !== null &&
    detectProgress.status !== null &&
    detectProgress.status !== "completed" &&
    detectProgress.status !== "failed";

  if (!dataset) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          No dataset found. Please upload data in Step 2 first.
        </CardContent>
      </Card>
    );
  }

  if (isDetecting) {
    return (
      <Card>
        <CardContent className="space-y-6 p-8">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-blue-500" />
            <h2 className="text-lg font-semibold">Detecting column roles...</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {detectProgress.progressMessage ?? "Initializing..."}
            </p>
          </div>
          <Progress value={detectProgress.progress} />
          <div className="flex justify-center gap-8 text-xs text-muted-foreground">
            <StageLabel
              label="Loading dataset"
              active={detectProgress.progress < 30}
              done={detectProgress.progress >= 30}
            />
            <StageLabel
              label="Analyzing with AI"
              active={detectProgress.progress >= 30 && detectProgress.progress < 70}
              done={detectProgress.progress >= 70}
            />
            <StageLabel
              label="Applying heuristics"
              active={detectProgress.progress >= 70 && detectProgress.progress < 100}
              done={detectProgress.progress >= 100}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (detectProgress.status === "failed") {
    return (
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <h2 className="text-lg font-semibold">Detection failed</h2>
          <p className="text-sm text-muted-foreground">
            {detectProgress.error ?? "An unknown error occurred"}
          </p>
          <Button
            onClick={() => {
              hasDispatched.current = false;
              setDetectTaskId(null);
              dispatchTask(project.id, "detect_column_roles", {}, dataset.id)
                .then(({ taskId }) => setDetectTaskId(taskId))
                .catch(() =>
                  toast("Failed to retry detection", { variant: "error" }),
                );
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry Detection
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (effectiveMappings.length === 0 && !mappingsLoading) {
    return (
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm text-muted-foreground">
            Loading column mappings...
          </p>
        </CardContent>
      </Card>
    );
  }

  /* ================================================================ */
  /*  Main table UI                                                    */
  /* ================================================================ */

  const allInViewSelected =
    filteredMappings.length > 0 &&
    filteredMappings.every((m) => selected.has(m.id));

  return (
    <div className="space-y-4">
      {/* Weight warning banner */}
      {unconfirmedWeight && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600" />
          <p className="text-sm text-yellow-800">
            A weight column was detected. Confirm it to enable weighted
            analysis.
          </p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Show:</span>
        <FilterButton
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label={`All (${counts.total})`}
        />
        <FilterButton
          active={filter === "needs_review"}
          onClick={() => setFilter("needs_review")}
          label={`Needs review (${counts.needsReview})`}
        />
        <FilterButton
          active={filter === "confirmed"}
          onClick={() => setFilter("confirmed")}
          label={`Confirmed (${counts.confirmed})`}
        />
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-2">
          <span className="text-sm font-medium text-blue-700">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleConfirmSelected}
            disabled={isConfirming}
          >
            {isConfirming ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Confirm selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRedetectSelected}
            disabled={isRedetecting}
          >
            {isRedetecting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Re-detect selected
          </Button>
        </div>
      )}

      {/* Column table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-10 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allInViewSelected}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium">Column</th>
                <th className="px-3 py-3 text-left font-medium">Samples</th>
                <th className="px-3 py-3 text-left font-medium">Type</th>
                <th className="px-3 py-3 text-left font-medium">Role</th>
                <th className="w-24 px-3 py-3 text-center font-medium">
                  Confidence
                </th>
                <th className="w-20 px-3 py-3 text-center font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMappings.map((mapping) => {
                const samples = getSampleValues(dataset, mapping.column_name);
                const isSelected = selected.has(mapping.id);

                return (
                  <tr
                    key={mapping.id}
                    className={`border-b transition-colors hover:bg-muted/30 ${
                      isSelected ? "bg-blue-50/50" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectToggle(mapping.id)}
                        className="rounded border-gray-300"
                      />
                    </td>

                    {/* Column name */}
                    <td className="px-3 py-2.5">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {mapping.column_name}
                      </code>
                    </td>

                    {/* Sample values */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {samples.length > 0 ? (
                          samples.map((val, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="max-w-[8rem] truncate text-xs font-normal"
                            >
                              {val}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Data type */}
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground">
                        {mapping.data_type
                          ? DATA_TYPE_LABELS[mapping.data_type] ??
                            mapping.data_type
                          : "—"}
                      </span>
                    </td>

                    {/* Role dropdown */}
                    <td className="px-3 py-2.5">
                      <Select
                        value={mapping.role ?? undefined}
                        onValueChange={(val) =>
                          handleRoleChange(mapping.id, val as ColumnRole)
                        }
                      >
                        <SelectTrigger className="h-8 w-[10rem] text-xs">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((opt) => (
                            <SelectItem
                              key={opt.value}
                              value={opt.value}
                              className="text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <opt.icon className="h-3.5 w-3.5 text-muted-foreground" />
                                {opt.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>

                    {/* Confidence */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${confidenceColor(mapping.detection_confidence)}`}
                          title={confidenceLabel(mapping.detection_confidence)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {confidenceLabel(mapping.detection_confidence)}
                        </span>
                      </div>
                    </td>

                    {/* Confirmed status */}
                    <td className="px-3 py-2.5 text-center">
                      {mapping.confirmed_by ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-green-500" />
                      ) : (
                        <Eye className="mx-auto h-4 w-4 text-muted-foreground/50" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Confirm All & Continue */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="flex items-center gap-4 p-6">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {counts.confirmed} of {counts.total} columns confirmed
              </span>
              {counts.needsReview > 0 && (
                <Badge variant="outline" className="text-yellow-700">
                  {counts.needsReview} need review
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Confirming will lock roles and start EDA, consistency checks, and
              bias detection in the background.
            </p>
          </div>
          <Button
            onClick={handleConfirmAllAndContinue}
            disabled={isConfirming || effectiveMappings.length === 0}
          >
            {isConfirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                Confirm All Roles
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StageLabel({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      className={`flex items-center gap-1.5 ${
        active
          ? "font-medium text-blue-600"
          : done
            ? "text-green-600"
            : "text-muted-foreground"
      }`}
    >
      {done ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : active ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <span className="inline-block h-3.5 w-3.5 rounded-full border border-current" />
      )}
      {label}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm transition-colors ${
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {label}
    </button>
  );
}
