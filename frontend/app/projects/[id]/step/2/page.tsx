import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Step2Upload } from "@/components/workflow/steps/Step2Upload";
import type { Tables } from "@/lib/types/database";

export default async function Step2Page({
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

  // Fetch existing dataset (current version) for this project
  const { data: dataset } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", params.id)
    .eq("is_current", true)
    .maybeSingle();

  // Fetch existing instrument for this project
  const { data: instrument } = await supabase
    .from("instruments")
    .select("*")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <Step2Upload
      project={project as Tables<"projects">}
      initialDataset={dataset as Tables<"datasets"> | null}
      initialInstrument={instrument as Tables<"instruments"> | null}
    />
  );
}
