import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { BarChart3, BookOpen, FileText, PlusCircle, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
        <div className="mt-8">
          {/* Welcome banner */}
          <div className="mb-8 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-violet-50 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Welcome to SurveyAI Analyst</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Upload your survey dataset, answer a few questions about your study, and let the AI plan and run the analysis. You&apos;ll have a publication-ready report in under an hour.
                </p>
              </div>
            </div>
          </div>

          {/* 3 quick actions */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Link href="/projects/new">
              <Card className="cursor-pointer border-blue-200 bg-blue-50 transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
                    <PlusCircle className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="font-semibold text-blue-900">Start a new project</h3>
                  <p className="mt-1 text-xs text-blue-700">Upload your CSV/Excel and define your research questions.</p>
                  <p className="mt-2 text-xs font-medium text-blue-600">→ Get started now</p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/setup">
              <Card className="cursor-pointer transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
                    <BookOpen className="h-5 w-5 text-gray-600" />
                  </div>
                  <h3 className="font-semibold">Read the setup guide</h3>
                  <p className="mt-1 text-xs text-gray-500">Step-by-step walkthrough, data format tips, and FAQ.</p>
                  <p className="mt-2 text-xs font-medium text-blue-600">→ 20-minute guide</p>
                </CardContent>
              </Card>
            </Link>

            <Card className="border-gray-100 bg-gray-50">
              <CardContent className="p-5">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-200">
                  <BarChart3 className="h-5 w-5 text-gray-500" />
                </div>
                <h3 className="font-semibold text-gray-700">Supported analyses</h3>
                <p className="mt-1 text-xs text-gray-500">OLS/Logistic regression, Spearman, t-test, ANOVA, Kruskal-Wallis, moderation, mediation, and more.</p>
                <p className="mt-2 text-xs text-gray-400">Auto-selected based on your data types</p>
              </CardContent>
            </Card>
          </div>

          {/* What to prepare */}
          <div className="mt-6 rounded-lg border bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-gray-400" />
              What to prepare before creating a project
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 text-xs text-gray-600">
              {[
                ["Your dataset", "CSV or Excel file with respondent rows. First row = column headers."],
                ["Research questions", "1–3 specific questions your analysis should answer."],
                ["Questionnaire (optional)", "Word, PDF, or XLSForm file for better column label mapping."],
                ["Audience", "Who will read the report? Donor, internal team, academic, policy."],
              ].map(([label, desc]) => (
                <div key={label} className="flex gap-2">
                  <span className="mt-0.5 text-green-500">✓</span>
                  <span><strong>{label}</strong> — {desc}</span>
                </div>
              ))}
            </div>
          </div>
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
