"use client";

import { useEffect, useRef, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";

/**
 * Debounced auto-save hook — saves field values to Supabase after a delay.
 * No save button needed anywhere in the app.
 */
export function useAutoSave(
  table: "projects" | "instruments" | "datasets",
  id: string | null,
  field: string,
  value: unknown,
  delay = 500
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<unknown>(undefined);
  const isFirstRender = useRef(true);

  const save = useCallback(
    async (val: unknown) => {
      if (!id) return;
      const supabase = createBrowserClient();

      // Use rpc-style update to avoid complex generic resolution
      // across table union types. The field name is validated by the caller.
      const { error } = await supabase
        .from(table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ [field]: val } as Record<string, unknown> as any)
        .eq("id", id);

      if (error) {
        console.error(`Auto-save failed for ${table}.${field}:`, error.message);
      }
    },
    [table, id, field]
  );

  useEffect(() => {
    // Skip initial render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      lastSavedRef.current = value;
      return;
    }

    // Skip if value hasn't actually changed
    if (JSON.stringify(value) === JSON.stringify(lastSavedRef.current)) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      lastSavedRef.current = value;
      save(value);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay, save]);
}
