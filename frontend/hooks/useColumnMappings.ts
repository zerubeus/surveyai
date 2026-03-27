"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Tables, Enums } from "@/lib/types/database";

type ColumnMapping = Tables<"column_mappings">;

interface ColumnMappingsState {
  mappings: ColumnMapping[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch column_mappings rows for a dataset and subscribe to Realtime updates.
 * Returns mappings, loading state, and an updateRole function for overrides.
 */
export function useColumnMappings(datasetId: string | null) {
  const [state, setState] = useState<ColumnMappingsState>({
    mappings: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!datasetId) {
      setState({ mappings: [], isLoading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    const supabase = createBrowserClient();

    // Fetch existing mappings
    supabase
      .from("column_mappings")
      .select("*")
      .eq("dataset_id", datasetId)
      .order("column_index", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setState({ mappings: [], isLoading: false, error: error.message });
          return;
        }
        setState({ mappings: data ?? [], isLoading: false, error: null });
      });

    // Subscribe to inserts and updates
    const channel = supabase
      .channel(`column-mappings-${datasetId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "column_mappings",
          filter: `dataset_id=eq.${datasetId}`,
        },
        (payload) => {
          const row = payload.new as ColumnMapping;
          setState((prev) => {
            const exists = prev.mappings.some((m) => m.id === row.id);
            if (exists) return prev;
            const updated = [...prev.mappings, row].sort(
              (a, b) => a.column_index - b.column_index,
            );
            return { ...prev, mappings: updated };
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "column_mappings",
          filter: `dataset_id=eq.${datasetId}`,
        },
        (payload) => {
          const row = payload.new as ColumnMapping;
          setState((prev) => ({
            ...prev,
            mappings: prev.mappings.map((m) => (m.id === row.id ? row : m)),
          }));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [datasetId]);

  const updateRole = useCallback(
    async (mappingId: string, newRole: Enums<"column_role">) => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("column_mappings")
        .update({
          role: newRole,
          detection_method: "manual",
          detection_confidence: 1.0,
          confirmed_by: user?.id ?? null,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", mappingId);

      if (error) throw new Error(error.message);

      // Optimistic update
      setState((prev) => ({
        ...prev,
        mappings: prev.mappings.map((m) =>
          m.id === mappingId
            ? {
                ...m,
                role: newRole,
                detection_method: "manual",
                detection_confidence: 1.0,
                confirmed_by: user?.id ?? null,
                confirmed_at: new Date().toISOString(),
              }
            : m,
        ),
      }));
    },
    [],
  );

  const confirmAll = useCallback(async () => {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !datasetId) return;

    const now = new Date().toISOString();

    // Confirm all unconfirmed mappings
    const { error } = await supabase
      .from("column_mappings")
      .update({
        confirmed_by: user.id,
        confirmed_at: now,
      })
      .eq("dataset_id", datasetId)
      .is("confirmed_by", null);

    if (error) throw new Error(error.message);

    setState((prev) => ({
      ...prev,
      mappings: prev.mappings.map((m) => ({
        ...m,
        confirmed_by: m.confirmed_by ?? user.id,
        confirmed_at: m.confirmed_at ?? now,
      })),
    }));
  }, [datasetId]);

  return {
    mappings: state.mappings,
    isLoading: state.isLoading,
    error: state.error,
    updateRole,
    confirmAll,
  };
}
