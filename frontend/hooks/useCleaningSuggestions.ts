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
 */
export function useCleaningSuggestions(datasetId: string | null) {
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
    const { data, error } = await supabase
      .from("cleaning_operations")
      .select("*")
      .eq("dataset_id", datasetId)
      .order("priority", { ascending: true });

    if (error) {
      setState((prev) => ({ ...prev, isLoading: false, error: error.message }));
      return;
    }
    categorize((data ?? []) as CleaningOperation[]);
  }, [datasetId, categorize]);

  useEffect(() => {
    if (!datasetId) {
      setState({ ...initialState, isLoading: false });
      return;
    }

    // Initial fetch
    refetch();

    const supabase = createBrowserClient();

    // Subscribe to real-time changes
    const channel = supabase
      .channel(`cleaning-ops-${datasetId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cleaning_operations",
          filter: `dataset_id=eq.${datasetId}`,
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
  }, [datasetId, refetch]);

  return {
    ...state,
    refetch,
  };
}
