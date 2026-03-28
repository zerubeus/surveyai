"use client";

import { useTaskProgress } from "@/hooks/useTaskProgress";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TaskProgressBarProps {
  taskId: string;
  className?: string;
}

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pending", variant: "outline" },
  claimed: { label: "Claimed", variant: "secondary" },
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

export function TaskProgressBar({ taskId, className }: TaskProgressBarProps) {
  const { progress, progressMessage, status, result, error, isLoading } =
    useTaskProgress(taskId);

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="h-4 w-full animate-pulse rounded-full bg-secondary" />
      </div>
    );
  }

  const config = status ? statusConfig[status] : null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {progressMessage ?? "Waiting..."}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{progress}%</span>
          {config && (
            <Badge variant={config.variant}>{config.label}</Badge>
          )}
        </div>
      </div>

      <Progress value={progress} />

      {status === "completed" && result && (
        <p className="text-sm text-muted-foreground">
          {typeof result === "object" &&
          result !== null &&
          "message" in (result as Record<string, unknown>)
            ? String((result as Record<string, unknown>).message)
            : "Task completed successfully"}
        </p>
      )}

      {status === "failed" && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
