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

    // Fetch current state first
    supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setState({
            progress: 0,
            progressMessage: null,
            status: null,
            result: null,
            error: error?.message ?? "Task not found",
            isLoading: false,
          });
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
      });

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
    };
  }, [taskId]);

  return state;
}
