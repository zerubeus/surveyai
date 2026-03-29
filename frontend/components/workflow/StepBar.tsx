"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Check,
  Lock,
  AlertTriangle,
  Loader2,
  FileText,
  Upload,
  Columns,
  BarChart3,
  Sparkles,
  ClipboardCheck,
  FileOutput,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStatus, StepStatus } from "@/lib/types/database";

const STEPS = [
  { num: 1, name: "Project Brief", icon: FileText },
  { num: 2, name: "Upload", icon: Upload },
  { num: 3, name: "Map Columns", icon: Columns },
  { num: 4, name: "Quality", icon: BarChart3 },
  { num: 5, name: "Cleaning", icon: Sparkles },
  { num: 6, name: "Analysis", icon: ClipboardCheck },
  { num: 7, name: "Report", icon: FileOutput },
] as const;

interface ActiveTask {
  status: string;
  progress: number;
}

interface StepBarProps {
  projectId: string;
  currentStep: number;
  pipelineStatus: PipelineStatus;
  activeTasksByStep?: Record<number, ActiveTask>;
}

export function StepBar({ projectId, currentStep, pipelineStatus, activeTasksByStep }: StepBarProps) {
  const pathname = usePathname();
  // Derive the active step from the URL (e.g. /projects/[id]/step/3 → 3)
  const urlStepMatch = pathname?.match(/\/step\/(\d+)/);
  const activeStep = urlStepMatch ? parseInt(urlStepMatch[1], 10) : currentStep;

  return (
    <nav className="w-full overflow-x-auto">
      <ol className="flex items-center gap-0">
        {STEPS.map((step, idx) => {
          const status: StepStatus =
            (pipelineStatus[String(step.num)] as StepStatus) ?? "locked";
          const isClickable = status === "completed" || status === "active" || status === "needs-refresh";
          const isCurrent = step.num === activeStep;

          const stepContent = (
            <li
              key={step.num}
              className={cn("flex items-center", idx < STEPS.length - 1 && "flex-1")}
            >
              <div
                className={cn(
                  "flex flex-col items-center gap-1.5",
                  isClickable ? "cursor-pointer" : "cursor-default"
                )}
              >
                {/* Circle */}
                <div className="relative">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors",
                      status === "completed" && !isCurrent &&
                        "border-green-500 bg-green-500 text-white",
                      status === "completed" && isCurrent &&
                        "border-blue-600 bg-blue-600 text-white ring-2 ring-blue-300 ring-offset-1",
                      status === "active" && !isCurrent &&
                        "border-blue-500 bg-blue-500 text-white",
                      status === "active" && isCurrent &&
                        "border-blue-600 bg-blue-600 text-white ring-2 ring-blue-300 ring-offset-1",
                      status === "locked" && !isCurrent &&
                        "border-muted-foreground/30 bg-muted text-muted-foreground",
                      status === "locked" && isCurrent &&
                        "border-blue-500 bg-blue-500 text-white",
                      status === "needs-refresh" && !isCurrent &&
                        "border-yellow-500 bg-yellow-50 text-yellow-700",
                      status === "needs-refresh" && isCurrent &&
                        "border-blue-600 bg-blue-600 text-white ring-2 ring-blue-300 ring-offset-1"
                    )}
                  >
                    {status === "completed" ? (
                      <Check className="h-4 w-4" />
                    ) : status === "locked" ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : status === "needs-refresh" ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      step.num
                    )}
                  </div>
                  {/* Pulsing ring for active+current step */}
                  {status === "active" && isCurrent && (
                    <div className="absolute inset-0 animate-ping rounded-full border-2 border-blue-400 opacity-30" />
                  )}
                  {/* Task running badge */}
                  {activeTasksByStep?.[step.num] &&
                    (activeTasksByStep[step.num].status === "running" ||
                      activeTasksByStep[step.num].status === "claimed" ||
                      activeTasksByStep[step.num].status === "pending") && (
                      <span
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white"
                        title="Analysing..."
                      >
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    )}
                </div>
                {/* Label — hidden on mobile */}
                <span
                  className={cn(
                    "hidden text-xs sm:block",
                    isCurrent && "text-blue-600 font-semibold",
                    !isCurrent && status === "completed" && "text-green-600 font-medium",
                    !isCurrent && status === "active" && "text-blue-600 font-medium",
                    !isCurrent && status === "locked" && "text-muted-foreground",
                    !isCurrent && status === "needs-refresh" && "text-yellow-600 font-medium"
                  )}
                >
                  {step.name}
                </span>
              </div>

              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 flex-1 min-w-[2rem]",
                    status === "completed" ? "bg-green-500" : "bg-muted"
                  )}
                />
              )}
            </li>
          );

          if (isClickable) {
            return (
              <Link
                key={step.num}
                href={`/projects/${projectId}/step/${step.num}`}
                className={cn(
                  "contents",
                  status === "needs-refresh" && "group"
                )}
                title={
                  status === "needs-refresh"
                    ? "Results may be stale — click to review"
                    : step.name
                }
              >
                {stepContent}
              </Link>
            );
          }

          return stepContent;
        })}
      </ol>
    </nav>
  );
}
