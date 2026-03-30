import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { StepBar } from "@/components/workflow/StepBar";
import { ChevronLeft } from "lucide-react";
import type { PipelineStatus } from "@/lib/types/database";

// Always fetch fresh data — pipelineStatus must reflect DB state after each step transition
export const dynamic = "force-dynamic";

const DEFAULT_PIPELINE: PipelineStatus = {
  "1": "active",
  "2": "locked",
  "3": "locked",
  "4": "locked",
  "5": "locked",
  "6": "locked",
  "7": "locked",
};

export default async function StepLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
    .select("id, name, current_step, pipeline_status")
    .eq("id", id)
    .single();
  const project = projectRaw as { id: string; name: string; current_step: number | null; pipeline_status: unknown } | null;

  if (!project) {
    notFound();
  }

  const pipelineStatus = (project.pipeline_status as PipelineStatus) ?? DEFAULT_PIPELINE;

  return (
    <div className="container py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/dashboard"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Dashboard
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold">{project.name}</h1>
      </div>

      <StepBar
        projectId={project.id}
        initialPipelineStatus={pipelineStatus}
      />

      <div className="mt-8">{children}</div>
    </div>
  );
}
