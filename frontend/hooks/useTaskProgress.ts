"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Tables } from "@/lib/types/database";

type Task = Tables<"tasks">;

interface TaskProgressState {
  progress: number;
  progressMessage: string | null;
  status: Task["status"] | null;
  result: Task["result"];
  error: string | null;
  isLoading: boolean;
}

const initialState: TaskProgressState = {
  progress: 0,
  progressMessage: null,
  status: null,
  result: null,
  error: null,
  isLoading: true,
};

/**
 * Subscribe to real-time progress updates for a task.
 *
 * Uses Supabase Realtime postgres_changes to get live updates
 * on the tasks table filtered by task ID.
 */
export function useTaskProgress(taskId: string | null): TaskProgressState {
  const [state, setState] = useState<TaskProgressState>(initialState);

  useEffect(() => {
    if (!taskId) {
      setState({ ...initialState, isLoading: false });
      return;
    }

    setState(initialState);

    const supabase = createBrowserClient();

    // Poll for task status — poll every 2s until terminal state
    // This ensures we catch completion even when Realtime misses an event
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const fetchTask = async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .single();

      if (error || !data) {
        setState({
          progress: 0,
          progressMessage: null,
          status: null,
          result: null,
          error: error?.message ?? "Task not found",
          isLoading: false,
        });
        if (pollInterval) clearInterval(pollInterval);
        return;
      }

      setState({
        progress: data.progress,
        progressMessage: data.progress_message,
        status: data.status,
        result: data.result,
        error: data.error,
        isLoading: false,
      });

      // Stop polling when task reaches terminal state
      if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
        if (pollInterval) clearInterval(pollInterval);
      }
    };

    // Initial fetch
    fetchTask();

    // Poll every 2 seconds as fallback for missed Realtime events
    pollInterval = setInterval(fetchTask, 2000);

    // Subscribe to real-time updates
    const channel = supabase
      .channel(`task-${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
          filter: `id=eq.${taskId}`,
        },
        (payload) => {
          const row = payload.new as Task;
          setState({
            progress: row.progress,
            progressMessage: row.progress_message,
            status: row.status,
            result: row.result,
            error: row.error,
            isLoading: false,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [taskId]);

  return state;
}
