import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { DatasetWorkflow } from "@/components/datasets/DatasetWorkflow";
import { InstrumentSection } from "@/components/instruments/InstrumentSection";

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

  // Fetch the current dataset for this project (most recent, is_current=true)
  const { data: datasets } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", project.id)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1);

  const currentDataset = datasets?.[0] ?? null;

  // Fetch the most recent instrument for this project
  const { data: instruments } = await supabase
    .from("instruments")
    .select("*")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const currentInstrument = instruments?.[0] ?? null;

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

      <div className="mt-8">
        <InstrumentSection
          projectId={project.id}
          instrument={currentInstrument}
        />
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">Dataset</h2>
        <DatasetWorkflow
          initialDataset={currentDataset}
          projectId={project.id}
          instrumentId={currentInstrument?.parse_status === "parsed" ? currentInstrument.id : null}
        />
      </div>
    </div>
  );
}
