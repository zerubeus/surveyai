import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step5Analysis } from "@/components/workflow/steps/Step5Analysis";
import type { Tables } from "@/lib/types/database";

export default async function Step6Page({
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

  let hasWeightColumn = false;
  let weightColumnName: string | null = null;

  if (dataset) {
    const { data: weightMappingRaw } = await supabase
      .from("column_mappings")
      .select("column_name")
      .eq("dataset_id", dataset.id)
      .eq("role", "weight")
      .not("confirmed_by", "is", null)
      .maybeSingle();
    const weightMapping = weightMappingRaw as { column_name: string } | null;
    if (weightMapping) {
      hasWeightColumn = true;
      weightColumnName = weightMapping.column_name;
    }
  }

  const { data: runningTasksRaw } = await supabase
    .from("tasks")
    .select("id, task_type, status")
    .eq("project_id", id)
    .in("task_type", ["generate_analysis_plan", "run_analysis"])
    .in("status", ["pending", "claimed", "running"])
    .order("created_at", { ascending: false })
    .limit(2);
  const runningTasks = runningTasksRaw as { id: string; task_type: string; status: string }[] | null;

  const initialTaskIds: Record<string, string> = {};
  for (const task of runningTasks ?? []) {
    initialTaskIds[task.task_type] = task.id;
  }

  return (
    <Step5Analysis
      project={project as Tables<"projects">}
      dataset={dataset}
      hasWeightColumn={hasWeightColumn}
      weightColumnName={weightColumnName}
      initialRunningTaskIds={initialTaskIds}
    />
  );
}
