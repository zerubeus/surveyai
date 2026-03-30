import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step7Visualisation } from "@/components/workflow/steps/Step7Visualisation";
import type { Tables } from "@/lib/types/database";

export default async function Step7Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const { data: datasetRaw } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", id)
    .eq("is_current", true)
    .maybeSingle();
  const dataset = datasetRaw as Tables<"datasets"> | null;

  const datasetId = dataset?.id;

  const [plansRes, resultsRes, chartsRes, mappingsRes, edaRes] = await Promise.all([
    datasetId
      ? supabase
          .from("analysis_plans")
          .select("*")
          .eq("dataset_id", datasetId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Tables<"analysis_plans">[] }),
    datasetId
      ? supabase
          .from("analysis_results")
          .select("*")
          .eq("dataset_id", datasetId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Tables<"analysis_results">[] }),
    supabase
      .from("charts")
      .select("*")
      .eq("project_id", id),
    datasetId
      ? supabase
          .from("column_mappings")
          .select("column_name, role, data_type")
          .eq("dataset_id", datasetId)
          .not("role", "eq", "identifier")
      : Promise.resolve({ data: [] as { column_name: string; role: string | null; data_type: string | null }[] }),
    // Fetch EDA results — this has all frequency tables and stats we need for charts
    datasetId
      ? supabase
          .from("eda_results")
          .select("*")
          .eq("dataset_id", datasetId)
          .eq("result_type", "column_profile")
          .order("column_name", { ascending: true })
      : Promise.resolve({ data: [] as Tables<"eda_results">[] }),
  ]);

  const plans = (plansRes.data ?? []) as Tables<"analysis_plans">[];
  const results = (resultsRes.data ?? []) as Tables<"analysis_results">[];
  const charts = (chartsRes.data ?? []) as Tables<"charts">[];
  const columns = (mappingsRes.data ?? []).map(
    (m: { column_name: string }) => m.column_name,
  );
  const edaResults = (edaRes.data ?? []) as Tables<"eda_results">[];

  // Build signed URLs for charts
  const chartUrls: Record<string, string> = {};
  for (const chart of charts) {
    if (chart.file_path) {
      const { data: urlData } = await supabase.storage
        .from("charts")
        .createSignedUrl(chart.file_path, 3600);
      if (urlData?.signedUrl) {
        chartUrls[chart.id] = urlData.signedUrl;
      }
    }
  }

  return (
    <Step7Visualisation
      project={project as Tables<"projects">}
      dataset={dataset}
      results={results}
      plans={plans}
      charts={charts}
      chartUrls={chartUrls}
      columns={columns}
      edaResults={edaResults}
    />
  );
}
