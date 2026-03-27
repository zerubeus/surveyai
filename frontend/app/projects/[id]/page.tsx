import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  context_set: "Context Set",
  instrument_uploaded: "Instrument Uploaded",
  data_uploaded: "Data Uploaded",
  roles_mapped: "Roles Mapped",
  eda_complete: "EDA Complete",
  cleaning_complete: "Cleaning Complete",
  analysis_complete: "Analysis Complete",
  report_complete: "Report Complete",
};

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

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <div className="container py-10">
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <Badge variant="secondary">
          {STATUS_LABELS[project.status] ?? project.status}
        </Badge>
      </div>
      {project.description && (
        <p className="mt-4 text-muted-foreground">{project.description}</p>
      )}
      <div className="mt-8 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Project workflow steps will be available in upcoming sprints.
      </div>
    </div>
  );
}
