import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step7Report } from "@/components/workflow/steps/Step7Report";
import type { Tables } from "@/lib/types/database";

export default async function Step7Page({
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

  // Check for running generate_report or export_report tasks
  const { data: runningTasksRaw } = await supabase
    .from("tasks")
    .select("id, task_type, status")
    .eq("project_id", params.id)
    .in("task_type", ["generate_report", "export_report"])
    .in("status", ["pending", "claimed", "running"])
    .order("created_at", { ascending: false })
    .limit(2);
  const runningTasks = runningTasksRaw as { id: string; task_type: string; status: string }[] | null;

  const initialTaskIds: Record<string, string> = {};
  for (const task of runningTasks ?? []) {
    initialTaskIds[task.task_type] = task.id;
  }

  return (
    <Step7Report
      project={project as Tables<"projects">}
      initialRunningTaskIds={initialTaskIds}
    />
  );
}
