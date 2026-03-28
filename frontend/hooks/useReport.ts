"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Tables } from "@/lib/types/database";

type Report = Tables<"reports">;
type ReportSection = Tables<"report_sections">;
type ReportExport = Tables<"report_exports">;

interface ReportState {
  report: Report | null;
  sections: ReportSection[];
  exports: ReportExport[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches report + report_sections + report_exports for a project.
 * Includes Realtime subscription for live updates during generation.
 */
export function useReport(projectId: string | null) {
  const [state, setState] = useState<ReportState>({
    report: null,
    sections: [],
    exports: [],
    isLoading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setState({ report: null, sections: [], exports: [], isLoading: false, error: null });
      return;
    }

    const supabase = createBrowserClient();

    // Fetch the latest report for this project
    const { data: reportsRaw, error: reportErr } = await supabase
      .from("reports")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1);
    const reports = reportsRaw as Report[] | null;

    if (reportErr) {
      setState({ report: null, sections: [], exports: [], isLoading: false, error: reportErr.message });
      return;
    }

    const report = reports?.[0] ?? null;

    if (!report) {
      setState({ report: null, sections: [], exports: [], isLoading: false, error: null });
      return;
    }

    // Fetch sections and exports
    const [sectionsRes, exportsRes] = await Promise.all([
      supabase
        .from("report_sections")
        .select("*")
        .eq("report_id", report.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("report_exports")
        .select("*")
        .eq("report_id", report.id)
        .order("created_at", { ascending: false }),
    ]);

    setState({
      report,
      sections: (sectionsRes.data as ReportSection[] | null) ?? [],
      exports: (exportsRes.data as ReportExport[] | null) ?? [],
      isLoading: false,
      error: null,
    });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setState({ report: null, sections: [], exports: [], isLoading: false, error: null });
      return;
    }

    fetchData();

    const supabase = createBrowserClient();

    // Subscribe to Realtime changes on report tables
    const channel = supabase
      .channel(`report-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reports",
          filter: `project_id=eq.${projectId}`,
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
          table: "report_sections",
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
          table: "report_exports",
        },
        () => {
          fetchData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, fetchData]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return {
    report: state.report,
    sections: state.sections,
    exports: state.exports,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  };
}
