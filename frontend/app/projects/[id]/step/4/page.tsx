import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step4Quality } from "@/components/workflow/steps/Step4Quality";
import type { Tables } from "@/lib/types/database";

export default async function Step4Page({
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

  // Check for running analysis tasks (dispatched from Step 3)
  const runningTaskTypes = [
    "run_eda",
    "run_consistency_checks",
    "run_bias_detection",
  ];
  const { data: runningTasks } = await supabase
    .from("tasks")
    .select("id, task_type, status")
    .eq("project_id", params.id)
    .in("task_type", runningTaskTypes)
    .in("status", ["pending", "claimed", "running"])
    .order("created_at", { ascending: false })
    .limit(3);

  // Build initial task ID map
  const initialTaskIds: Record<string, string> = {};
  for (const task of runningTasks ?? []) {
    initialTaskIds[task.task_type] = task.id;
  }

  return (
    <Step4Quality
      project={project as Tables<"projects">}
      dataset={dataset as Tables<"datasets"> | null}
      initialRunningTaskIds={initialTaskIds}
    />
  );
}
