import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step6Results } from "@/components/workflow/steps/Step6Results";
import type { Tables } from "@/lib/types/database";

export default async function Step6Page({
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

  const { data: dataset } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", params.id)
    .eq("is_current", true)
    .maybeSingle();

  // Check for running run_analysis task
  const { data: runningTask } = await supabase
    .from("tasks")
    .select("id, task_type, status")
    .eq("project_id", params.id)
    .eq("task_type", "run_analysis")
    .in("status", ["pending", "claimed", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <Step6Results
      project={project as Tables<"projects">}
      dataset={dataset as Tables<"datasets"> | null}
      initialRunningTaskId={runningTask?.id ?? null}
    />
  );
}
