"use client";

import { useEffect, useState, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Tables, Json } from "@/lib/types/database";

type EdaResult = Tables<"eda_results">;

interface QualityResultsState {
  columnProfiles: EdaResult[];
  datasetSummary: EdaResult | null;
  consistencyChecks: EdaResult[];
  biasFlags: EdaResult[];
  interpretation: EdaResult | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: QualityResultsState = {
  columnProfiles: [],
  datasetSummary: null,
  consistencyChecks: [],
  biasFlags: [],
  interpretation: null,
  isLoading: true,
  error: null,
};

/**
 * Fetch eda_results for a dataset and subscribe to Realtime inserts/updates.
 * Categorizes results by result_type for the QualityDashboard.
 */
export function useQualityResults(datasetId: string | null) {
  const [state, setState] = useState<QualityResultsState>(initialState);

  const categorize = useCallback((data: EdaResult[]) => {
    setState({
      columnProfiles: data.filter((r) => r.result_type === "column_profile"),
      datasetSummary: data.find((r) => r.result_type === "dataset_summary") ?? null,
      consistencyChecks: data.filter((r) => r.result_type === "consistency_check"),
      biasFlags: data.filter((r) => r.result_type === "bias_check"),
      interpretation: data.find((r) => r.result_type === "interpretation") ?? null,
      isLoading: false,
      error: null,
    });
  }, []);

  const refetch = useCallback(async () => {
    if (!datasetId) return;
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("eda_results")
      .select("*")
      .eq("dataset_id", datasetId);

    if (error) {
      setState((prev) => ({ ...prev, isLoading: false, error: error.message }));
      return;
    }
    categorize((data ?? []) as EdaResult[]);
  }, [datasetId, categorize]);

  useEffect(() => {
    if (!datasetId) {
      setState({ ...initialState, isLoading: false });
      return;
    }

    // Initial fetch
    refetch();

    const supabase = createBrowserClient();

    // Subscribe to real-time inserts for live updates during analysis
    const channel = supabase
      .channel(`eda-results-${datasetId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eda_results",
          filter: `dataset_id=eq.${datasetId}`,
        },
        (payload) => {
          const row = payload.new as EdaResult;
          setState((prev) => {
            const updated = { ...prev };
            if (row.result_type === "column_profile") {
              updated.columnProfiles = [...prev.columnProfiles, row];
            } else if (row.result_type === "dataset_summary") {
              updated.datasetSummary = row;
            } else if (row.result_type === "consistency_check") {
              updated.consistencyChecks = [...prev.consistencyChecks, row];
            } else if (row.result_type === "bias_check") {
              updated.biasFlags = [...prev.biasFlags, row];
            } else if (row.result_type === "interpretation") {
              updated.interpretation = row;
            }
            return updated;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [datasetId, refetch]);

  const clear = useCallback(() => {
    setState({ ...initialState, isLoading: false });
  }, []);

  return {
    ...state,
    refetch,
    clear,
  };
}
