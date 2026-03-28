"use client";

import { useCallback, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Enums } from "@/lib/types/database";

type TaskType = Enums<"task_type">;

interface DispatchState {
  isDispatching: boolean;
  error: string | null;
}

interface DispatchResult {
  taskId: string;
}

/**
 * Returns a function to dispatch (insert) a new task into the queue.
 *
 * The task will be picked up by the Python worker's polling loop.
 * Returns the new task's ID so the caller can subscribe to progress
 * via useTaskProgress.
 */
export function useDispatchTask() {
  const [state, setState] = useState<DispatchState>({
    isDispatching: false,
    error: null,
  });

  const dispatchTask = useCallback(
    async (
      projectId: string,
      taskType: TaskType,
      payload: Record<string, unknown> = {},
      datasetId?: string,
    ): Promise<DispatchResult> => {
      setState({ isDispatching: true, error: null });

      try {
        const supabase = createBrowserClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Not authenticated");
        }

        const taskPayload = datasetId
          ? { ...payload, dataset_id: datasetId }
          : payload;

                // @ts-ignore — supabase insert type inference
        const { data: taskRaw, error } = await supabase
          .from("tasks")
          // @ts-ignore — supabase type inference
          .insert({
            project_id: projectId,
            task_type: taskType,
            payload: taskPayload,
            created_by: user.id,
          })
          .select("id")
          .single();
        const data = taskRaw as { id: string } | null;

        if (error) {
          throw new Error(error.message);
        }

        setState({ isDispatching: false, error: null });
        return { taskId: data?.id ?? "" };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to dispatch task";
        setState({ isDispatching: false, error: message });
        throw err;
      }
    },
    [],
  );

  return {
    dispatchTask,
    isDispatching: state.isDispatching,
    error: state.error,
  };
}
