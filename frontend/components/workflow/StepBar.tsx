"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
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
  PieChart,
  FileOutput,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStatus, StepStatus } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Step definitions                                                   */
/* ------------------------------------------------------------------ */

const STEPS = [
  { num: 1, name: "Project Brief", icon: FileText },
  { num: 3, name: "Map Columns", icon: Columns },
  { num: 4, name: "Quality", icon: BarChart3 },
  { num: 5, name: "Cleaning", icon: Sparkles },
  { num: 6, name: "Analysis", icon: ClipboardCheck },
  { num: 7, name: "Visualisation", icon: PieChart },
  { num: 8, name: "Report", icon: FileOutput },
] as const;

const DEFAULT_PIPELINE: PipelineStatus = {
  "1": "active",
  "2": "locked",
  "3": "locked",
  "4": "locked",
  "5": "locked",
  "6": "locked",
  "7": "locked",
  "8": "locked",
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface StepBarProps {
  projectId: string;
  /** Initial pipeline status from SSR — overridden by client fetch */
  initialPipelineStatus?: PipelineStatus;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * StepBar fetches its own pipeline_status client-side so it always reflects
 * the latest DB state regardless of Next.js layout caching.
 * It uses usePathname() to highlight the step the user is currently on.
 */
export function StepBar({ projectId, initialPipelineStatus }: StepBarProps) {
  const pathname = usePathname();

  // Derive current step from URL — /projects/[id]/step/N → N, /report → 8
  const urlStepMatch = pathname?.match(/\/step\/(\d+)/);
  const isReportPage = pathname?.endsWith("/report");
  const activeStep = isReportPage ? 8 : urlStepMatch ? parseInt(urlStepMatch[1], 10) : 1;

  // Pipeline status — start with SSR value, then refresh client-side
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>(
    initialPipelineStatus ?? DEFAULT_PIPELINE,
  );

  useEffect(() => {
    if (!projectId) return;
    const supabase = createBrowserClient();
    supabase
      .from("projects")
      .select("pipeline_status")
      .eq("id", projectId)
      .single()
      .then(({ data }) => {
        const d = data as { pipeline_status?: unknown } | null;
        if (d?.pipeline_status) {
          setPipelineStatus(d.pipeline_status as PipelineStatus);
        }
      });
  }, [projectId, pathname]); // re-fetch whenever pathname changes (= step navigation)

  return (
    <nav className="w-full overflow-x-auto" aria-label="Workflow steps">
      <ol className="flex items-center">
        {STEPS.map((step, idx) => {
          const status: StepStatus =
            (pipelineStatus[String(step.num)] as StepStatus) ?? "locked";
          const isCurrent = step.num === activeStep;
          const isClickable =
            status === "completed" ||
            status === "active" ||
            status === "needs-refresh" ||
            isCurrent;

          const circleClass = cn(
            "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-medium transition-all duration-200",
            // Current step — always blue ring regardless of status
            isCurrent &&
              "border-blue-600 bg-blue-600 text-white shadow-[0_0_0_3px_rgba(37,99,235,0.2)]",
            // Non-current completed
            !isCurrent && status === "completed" &&
              "border-green-500 bg-green-500 text-white",
            // Non-current active (but not current)
            !isCurrent && status === "active" &&
              "border-blue-500 bg-blue-500 text-white",
            // Locked
            !isCurrent && status === "locked" &&
              "border-muted-foreground/30 bg-muted text-muted-foreground",
            // Needs refresh
            !isCurrent && status === "needs-refresh" &&
              "border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
          );

          const labelClass = cn(
            "hidden text-xs sm:block mt-1.5 text-center",
            isCurrent && "text-blue-600 font-semibold",
            !isCurrent && status === "completed" && "text-green-600 font-medium",
            !isCurrent && status === "active" && "text-blue-500 font-medium",
            !isCurrent && status === "locked" && "text-muted-foreground",
            !isCurrent && status === "needs-refresh" && "text-yellow-600 font-medium",
          );

          // Icon inside circle
          const circleContent = isCurrent ? (
            // Current step always shows number
            step.num
          ) : status === "completed" ? (
            <Check className="h-4 w-4" />
          ) : status === "locked" ? (
            <Lock className="h-3.5 w-3.5" />
          ) : status === "needs-refresh" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            step.num
          );

          const stepNode = (
            <li
              key={step.num}
              className={cn("flex items-center", idx < STEPS.length - 1 && "flex-1")}
            >
              {/* Step circle + label */}
              <div className={cn("flex flex-col items-center", isClickable ? "cursor-pointer" : "cursor-default")}>
                <div className={circleClass}>{circleContent}</div>
                <span className={labelClass}>{step.name}</span>
              </div>

              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 flex-1 min-w-[1.5rem] transition-colors duration-300",
                    status === "completed" ? "bg-green-500" : "bg-muted",
                  )}
                />
              )}
            </li>
          );

          if (isClickable) {
            const href =
              step.num === 8
                ? `/projects/${projectId}/report`
                : `/projects/${projectId}/step/${step.num}`;
            return (
              <Link
                key={step.num}
                href={href as never}
                className="contents"
                title={step.name}
              >
                {stepNode}
              </Link>
            );
          }

          return <span key={step.num} className="contents">{stepNode}</span>;
        })}
      </ol>
    </nav>
  );
}
