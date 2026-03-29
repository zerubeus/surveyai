import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step5Cleaning } from "@/components/workflow/steps/Step5Cleaning";
import type { Tables } from "@/lib/types/database";

export default async function Step5Page({
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

  return (
    <Step5Cleaning
      project={project as Tables<"projects">}
      dataset={dataset}
    />
  );
}
