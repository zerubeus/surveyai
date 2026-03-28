import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step5Analysis } from "@/components/workflow/steps/Step5Analysis";
import type { Tables } from "@/lib/types/database";

export default async function Step5Page({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!project) notFound();

  // Fetch current dataset for this project
  const { data: dataset } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", params.id)
    .eq("is_current", true)
    .maybeSingle();

  // Check if a weight column is confirmed in column_mappings
  let hasWeightColumn = false;
  let weightColumnName: string | null = null;

  if (dataset) {
    const { data: weightMapping } = await supabase
      .from("column_mappings")
      .select("column_name")
      .eq("dataset_id", dataset.id)
      .eq("role", "weight")
      .not("confirmed_by", "is", null)
      .maybeSingle();

    if (weightMapping) {
      hasWeightColumn = true;
      weightColumnName = weightMapping.column_name;
    }
  }

  // Check for running generate_analysis_plan or run_analysis tasks
  const { data: runningTasks } = await supabase
    .from("tasks")
    .select("id, task_type, status")
    .eq("project_id", params.id)
    .in("task_type", ["generate_analysis_plan", "run_analysis"])
    .in("status", ["pending", "claimed", "running"])
    .order("created_at", { ascending: false })
    .limit(2);

  const initialTaskIds: Record<string, string> = {};
  for (const task of runningTasks ?? []) {
    initialTaskIds[task.task_type] = task.id;
  }

  return (
    <Step5Analysis
      project={project as Tables<"projects">}
      dataset={dataset as Tables<"datasets"> | null}
      hasWeightColumn={hasWeightColumn}
      weightColumnName={weightColumnName}
      initialRunningTaskIds={initialTaskIds}
    />
  );
}
