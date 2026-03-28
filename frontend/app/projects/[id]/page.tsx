import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/types/database";

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: projectRaw } = await supabase
    .from("projects")
    .select("id, current_step")
    .eq("id", params.id)
    .single();
  const project = projectRaw as Pick<Tables<"projects">, "id" | "current_step"> | null;

  if (!project) {
    notFound();
  }

  const step = project.current_step ?? 1;
  redirect(`/projects/${project.id}/step/${step}`);
}
