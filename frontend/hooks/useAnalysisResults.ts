"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Tables } from "@/lib/types/database";

type AnalysisPlan = Tables<"analysis_plans">;
type AnalysisResult = Tables<"analysis_results">;

interface AnalysisResultsState {
  plans: AnalysisPlan[];
  results: AnalysisResult[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches analysis_plans + analysis_results for a dataset
 * with Realtime subscription for live updates.
 */
export function useAnalysisResults(datasetId: string | null) {
  const [state, setState] = useState<AnalysisResultsState>({
    plans: [],
    results: [],
    isLoading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    if (!datasetId) {
      setState({ plans: [], results: [], isLoading: false, error: null });
      return;
    }

    const supabase = createBrowserClient();

    const [plansRes, resultsRes] = await Promise.all([
      supabase
        .from("analysis_plans")
        .select("*")
        .eq("dataset_id", datasetId)
        .order("created_at", { ascending: true }),
      supabase
        .from("analysis_results")
        .select("*")
        .eq("dataset_id", datasetId)
        .order("created_at", { ascending: true }),
    ]);

    if (plansRes.error || resultsRes.error) {
      setState({
        plans: [],
        results: [],
        isLoading: false,
        error: plansRes.error?.message ?? resultsRes.error?.message ?? "Failed to load",
      });
      return;
    }

    setState({
      plans: plansRes.data ?? [],
      results: resultsRes.data ?? [],
      isLoading: false,
      error: null,
    });
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId) {
      setState({ plans: [], results: [], isLoading: false, error: null });
      return;
    }

    fetchData();

    const supabase = createBrowserClient();

    // Subscribe to Realtime changes on both tables
    const channel = supabase
      .channel(`analysis-${datasetId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "analysis_plans",
          filter: `dataset_id=eq.${datasetId}`,
        },
        () => {
          fetchData();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "analysis_results",
          filter: `dataset_id=eq.${datasetId}`,
        },
        () => {
          fetchData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [datasetId, fetchData]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return {
    plans: state.plans,
    results: state.results,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  };
}
