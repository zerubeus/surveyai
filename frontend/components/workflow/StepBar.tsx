"use client";

import Link from "next/link";
import {
  Check,
  Lock,
  AlertTriangle,
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

interface StepBarProps {
  projectId: string;
  currentStep: number;
  pipelineStatus: PipelineStatus;
}

export function StepBar({ projectId, currentStep, pipelineStatus }: StepBarProps) {
  return (
    <nav className="w-full overflow-x-auto">
      <ol className="flex items-center gap-0">
        {STEPS.map((step, idx) => {
          const status: StepStatus =
            (pipelineStatus[String(step.num)] as StepStatus) ?? "locked";
          const isClickable = status === "completed" || status === "active" || status === "needs-refresh";
          const isCurrent = step.num === currentStep;

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
                      status === "completed" &&
                        "border-green-500 bg-green-500 text-white",
                      status === "active" &&
                        "border-blue-500 bg-blue-500 text-white",
                      status === "locked" &&
                        "border-muted-foreground/30 bg-muted text-muted-foreground",
                      status === "needs-refresh" &&
                        "border-yellow-500 bg-yellow-50 text-yellow-700"
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
                </div>
                {/* Label — hidden on mobile */}
                <span
                  className={cn(
                    "hidden text-xs sm:block",
                    status === "completed" && "text-green-600 font-medium",
                    status === "active" && "text-blue-600 font-medium",
                    status === "locked" && "text-muted-foreground",
                    status === "needs-refresh" && "text-yellow-600 font-medium"
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
