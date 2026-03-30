"use client";

import { useEffect, useState, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Tables } from "@/lib/types/database";

type CleaningOperation = Tables<"cleaning_operations">;

interface CleaningSuggestionsState {
  pending: CleaningOperation[];
  approved: CleaningOperation[];
  applied: CleaningOperation[];
  rejected: CleaningOperation[];
  undone: CleaningOperation[];
  all: CleaningOperation[];
  isLoading: boolean;
  error: string | null;
}

const initialState: CleaningSuggestionsState = {
  pending: [],
  approved: [],
  applied: [],
  rejected: [],
  undone: [],
  all: [],
  isLoading: true,
  error: null,
};

/**
 * Fetch cleaning_operations for a dataset and subscribe to Realtime updates.
 * Categorizes operations by status for the cleaning UI.
 *
 * When projectId is provided, fetches ops for ALL datasets in the project.
 * This is needed because cleaning ops may live on a parent dataset after a fix
 * creates a new dataset version.
 */
export function useCleaningSuggestions(
  datasetId: string | null,
  projectId: string | null = null,
) {
  const [state, setState] = useState<CleaningSuggestionsState>(initialState);

  const categorize = useCallback((data: CleaningOperation[]) => {
    setState({
      pending: data.filter((o) => o.status === "pending"),
      approved: data.filter((o) => o.status === "approved"),
      applied: data.filter((o) => o.status === "applied"),
      rejected: data.filter((o) => o.status === "rejected"),
      undone: data.filter((o) => o.status === "undone"),
      all: data,
      isLoading: false,
      error: null,
    });
  }, []);

  const refetch = useCallback(async () => {
    if (!datasetId) return;
    const supabase = createBrowserClient();

    // Get all dataset IDs for this project if projectId is provided
    let datasetIds: string[] = [datasetId];
    if (projectId) {
      const { data: datasets } = await supabase
        .from("datasets")
        .select("id")
        .eq("project_id", projectId)
        .returns<{ id: string }[]>();
      if (datasets && datasets.length > 0) {
        datasetIds = datasets.map((d) => d.id);
      }
    }

    const { data, error } = await supabase
      .from("cleaning_operations")
      .select("*")
      .in("dataset_id", datasetIds)
      .order("priority", { ascending: true });

    if (error) {
      setState((prev) => ({ ...prev, isLoading: false, error: error.message }));
      return;
    }
    categorize((data ?? []) as CleaningOperation[]);
  }, [datasetId, projectId, categorize]);

  useEffect(() => {
    if (!datasetId) {
      setState({ ...initialState, isLoading: false });
      return;
    }

    // Initial fetch
    refetch();

    const supabase = createBrowserClient();

    // Subscribe to real-time changes on the table (no filter so we catch ops on any dataset)
    // We refetch all project datasets on any change anyway
    const channel = supabase
      .channel(`cleaning-ops-project-${projectId ?? datasetId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cleaning_operations",
        },
        () => {
          // Refetch on any change to keep categories in sync
          refetch();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [datasetId, projectId, refetch]);

  return {
    ...state,
    refetch,
  };
}
