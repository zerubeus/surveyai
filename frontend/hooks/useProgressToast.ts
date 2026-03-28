"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";

interface ProgressState {
  status: string | null;
  progress: number;
  progressMessage: string | null;
  error: string | null;
}

interface UseProgressToastOptions {
  label: string;           // e.g. "EDA analysis"
  thresholds?: number[];   // progress % to toast at (default: [25, 50, 75, 100])
  onComplete?: () => void;
}

/**
 * Emits toast notifications at progress milestones for long-running tasks.
 * Usage:
 *   useProgressToast(edaProgress, { label: "Quality analysis" })
 */
export function useProgressToast(
  state: ProgressState,
  { label, thresholds = [50, 100], onComplete }: UseProgressToastOptions,
): void {
  const lastStatus = useRef<string | null>(null);
  const lastProgress = useRef<number>(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!state.status) return;

    // Task started
    if (
      (state.status === "claimed" || state.status === "running") &&
      !startedRef.current
    ) {
      startedRef.current = true;
      toast(`⚙️ ${label} started…`, { variant: "default", duration: 3000 });
    }

    // Progress milestones
    if (state.status === "running" || state.status === "claimed") {
      for (const threshold of thresholds) {
        if (
          lastProgress.current < threshold &&
          state.progress >= threshold &&
          state.progress < 100
        ) {
          const msg = state.progressMessage
            ? `${label}: ${state.progressMessage}`
            : `${label}: ${state.progress}% complete`;
          toast(msg, { variant: "default", duration: 3000 });
        }
      }
    }

    // Completion
    if (state.status === "completed" && lastStatus.current !== "completed") {
      toast(`✅ ${label} complete`, { variant: "success", duration: 4000 });
      onComplete?.();
    }

    // Error
    if (state.status === "failed" && lastStatus.current !== "failed") {
      toast(`❌ ${label} failed: ${state.error ?? "unknown error"}`, {
        variant: "error",
        duration: 6000,
      });
    }

    lastStatus.current = state.status;
    lastProgress.current = state.progress;
  }, [state.status, state.progress, state.progressMessage, state.error, label, thresholds, onComplete]);
}
