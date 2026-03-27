"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskProgressBar } from "@/components/tasks/TaskProgressBar";
import { useColumnMappings } from "@/hooks/useColumnMappings";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import type { Enums, Tables } from "@/lib/types/database";

const COLUMN_ROLES: { value: Enums<"column_role">; label: string }[] = [
  { value: "identifier", label: "Identifier" },
  { value: "weight", label: "Weight" },
  { value: "cluster_id", label: "Cluster ID" },
  { value: "stratum", label: "Stratum" },
  { value: "demographic", label: "Demographic" },
  { value: "outcome", label: "Outcome" },
  { value: "covariate", label: "Covariate" },
  { value: "skip_logic", label: "Skip Logic" },
  { value: "metadata", label: "Metadata" },
  { value: "open_text", label: "Open Text" },
  { value: "ignore", label: "Ignore" },
];

interface ColumnRoleMapperProps {
  datasetId: string;
  projectId: string;
  instrumentId: string | null;
}

export function ColumnRoleMapper({
  datasetId,
  projectId,
  instrumentId,
}: ColumnRoleMapperProps) {
  const { mappings, isLoading, updateRole, confirmAll } =
    useColumnMappings(datasetId);
  const { dispatchTask, isDispatching } = useDispatchTask();
  const [taskId, setTaskId] = useState<string | null>(null);
  const taskProgress = useTaskProgress(taskId);
  const [isConfirming, setIsConfirming] = useState(false);
  const hasDispatchedRef = useRef(false);

  // Auto-dispatch detection task if no mappings exist
  useEffect(() => {
    if (isLoading || hasDispatchedRef.current) return;
    if (mappings.length > 0) return;

    hasDispatchedRef.current = true;
    dispatchTask(projectId, "detect_column_roles", {
      dataset_id: datasetId,
      project_id: projectId,
      instrument_id: instrumentId,
    }).then(({ taskId: newId }) => {
      setTaskId(newId);
    });
  }, [
    isLoading,
    mappings.length,
    projectId,
    datasetId,
    instrumentId,
    dispatchTask,
  ]);

  const handleRedetect = useCallback(async () => {
    const { taskId: newId } = await dispatchTask(
      projectId,
      "detect_column_roles",
      {
        dataset_id: datasetId,
        project_id: projectId,
        instrument_id: instrumentId,
      },
    );
    setTaskId(newId);
  }, [dispatchTask, projectId, datasetId, instrumentId]);

  const handleConfirmAll = useCallback(async () => {
    setIsConfirming(true);
    try {
      await confirmAll();
    } finally {
      setIsConfirming(false);
    }
  }, [confirmAll]);

  const handleRoleChange = useCallback(
    (mappingId: string, newRole: string) => {
      updateRole(mappingId, newRole as Enums<"column_role">);
    },
    [updateRole],
  );

  // Show progress bar while task is running
  const isDetecting =
    taskId != null &&
    taskProgress.status != null &&
    taskProgress.status !== "completed" &&
    taskProgress.status !== "failed";

  if (isDetecting || isDispatching) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5" />
            Detecting Column Roles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {taskId ? (
            <TaskProgressBar taskId={taskId} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Dispatching detection task...
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Show error state
  if (taskProgress.status === "failed") {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">
            Column Role Detection Failed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {taskProgress.error ?? "Unknown error occurred"}
          </p>
          <Button variant="outline" onClick={handleRedetect}>
            Retry Detection
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading column mappings...
      </div>
    );
  }

  if (mappings.length === 0) {
    return null;
  }

  const weightMapping = mappings.find((m) => m.role === "weight");
  const allConfirmed = mappings.every((m) => m.confirmed_by != null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Column Role Mapping</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRedetect}>
              Re-detect
            </Button>
            {!allConfirmed && (
              <Button
                size="sm"
                onClick={handleConfirmAll}
                disabled={isConfirming}
              >
                {isConfirming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirm All Roles
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Weight column warning banner */}
        {weightMapping && !weightMapping.confirmed_by && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-100">
                Weight column detected: &quot;{weightMapping.column_name}&quot;
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                Confirm it to enable weighted analysis. All statistical tests
                will use survey weights when a weight column is confirmed.
              </p>
            </div>
          </div>
        )}

        {allConfirmed && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            <p className="text-sm font-medium text-green-900 dark:text-green-100">
              All column roles confirmed
            </p>
          </div>
        )}

        {/* Column mappings table */}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">
                  Column Name
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  Sample Values
                </th>
                <th className="px-4 py-3 text-left font-medium">Role</th>
                <th className="px-4 py-3 text-left font-medium">Confidence</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <ColumnRow
                  key={mapping.id}
                  mapping={mapping}
                  onRoleChange={handleRoleChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ColumnRow({
  mapping,
  onRoleChange,
}: {
  mapping: Tables<"column_mappings">;
  onRoleChange: (mappingId: string, newRole: string) => void;
}) {
  const confidence = mapping.detection_confidence ?? 0;

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {mapping.column_name}
        </code>
      </td>
      <td className="max-w-[200px] truncate px-4 py-3 text-xs text-muted-foreground">
        {mapping.ai_reasoning ?? "—"}
      </td>
      <td className="px-4 py-3">
        <Select
          value={mapping.role ?? "ignore"}
          onChange={(e) => onRoleChange(mapping.id, e.target.value)}
          className="h-8 w-[140px] text-xs"
        >
          {COLUMN_ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-4 py-3">
        <ConfidenceBadge confidence={confidence} />
      </td>
      <td className="px-4 py-3">
        {mapping.confirmed_by ? (
          <Badge
            variant="default"
            className="bg-green-600 text-xs hover:bg-green-600"
          >
            Confirmed
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">
            AI Suggestion
          </Badge>
        )}
      </td>
    </tr>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);

  if (confidence >= 0.85) {
    return (
      <Badge className="bg-green-600 text-xs hover:bg-green-600">
        {pct}%
      </Badge>
    );
  }
  if (confidence >= 0.5) {
    return (
      <Badge className="bg-amber-500 text-xs hover:bg-amber-500">{pct}%</Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-xs">
      {pct}%
    </Badge>
  );
}
