import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/projects/ProjectCard";
import type { Tables } from "@/lib/types/database";

type Project = Tables<"projects">;

export default async function DashboardPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: projectsRaw } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  const projects = projectsRaw as Project[] | null;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your survey analysis projects
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">New Project</Link>
        </Button>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <h2 className="text-xl font-semibold">No projects yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create your first project to start analyzing survey data with
            AI-powered insights.
          </p>
          <Button asChild className="mt-6">
            <Link href="/projects/new">Create your first project</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
