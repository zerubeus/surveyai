import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QualityDashboard } from "@/components/eda/QualityDashboard";
import { ChevronLeft } from "lucide-react";
import type { Tables } from "@/lib/types/database";

export default async function DataQualityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: projectRaw } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  const project = projectRaw as Tables<"projects"> | null;

  if (!project) {
    notFound();
  }

  // Fetch current confirmed dataset
  const { data: datasetsRaw } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", project.id)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1);
  const datasets = datasetsRaw as Tables<"datasets">[] | null;
  const dataset = datasets?.[0] ?? null;

  // Allow access for any dataset that has been confirmed (or progressed past confirmation)
  const confirmedStatuses = ["confirmed", "profiled", "cleaning", "cleaned", "analyzed"];
  if (!dataset || !confirmedStatuses.includes(dataset.status)) {
    redirect(`/projects/${id}`);
  }

  return (
    <div className="container py-10">
      {/* Navigation */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${id}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Project
          </Link>
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">Data Quality Analysis</span>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <p className="mt-1 text-muted-foreground">
          {dataset.name} — {dataset.row_count?.toLocaleString("en-US") ?? "?"} rows,{" "}
          {dataset.column_count ?? "?"} columns
        </p>
      </div>

      <QualityDashboard
        datasetId={dataset.id}
        projectId={project.id}
      />
    </div>
  );
}
