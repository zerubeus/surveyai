import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step3ColumnRoles } from "@/components/workflow/steps/Step3ColumnRoles";
import type { Tables } from "@/lib/types/database";

export default async function Step3Page({
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

  // Fetch existing column mappings (if any)
  const { data: mappings } = dataset
    ? await supabase
        .from("column_mappings")
        .select("*")
        .eq("dataset_id", dataset.id)
        .order("column_index", { ascending: true })
    : { data: null };

  return (
    <Step3ColumnRoles
      project={project as Tables<"projects">}
      dataset={dataset as Tables<"datasets"> | null}
      initialMappings={(mappings as Tables<"column_mappings">[]) ?? []}
    />
  );
}
