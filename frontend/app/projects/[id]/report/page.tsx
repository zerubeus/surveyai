"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useReport } from "@/hooks/useReport";
import { ReportEditor } from "@/components/report/ReportEditor";
import { ExportPanel } from "@/components/report/ExportPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft,
  Loader2,
  FileText,
  RefreshCw,
  Users,
  Building2,
  GraduationCap,
  Landmark,
} from "lucide-react";
import type { Tables, Enums } from "@/lib/types/database";

type Dataset = Tables<"datasets">;
type Project = Tables<"projects">;

type ReportTemplate = Enums<"report_template">;

interface TemplateOption {
  value: ReportTemplate;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    value: "donor",
    label: "Donor Report",
    description: "Results-focused, impact language, recommendations section",
    icon: <Building2 className="h-6 w-6" />,
  },
  {
    value: "internal",
    label: "Internal Report",
    description: "Technical, full methodological detail",
    icon: <Users className="h-6 w-6" />,
  },
  {
    value: "academic",
    label: "Academic Report",
    description: "Formal, limitations prominent, no recommendations",
    icon: <GraduationCap className="h-6 w-6" />,
  },
  {
    value: "policy",
    label: "Policy Brief",
    description: "Plain language, recommendations first",
    icon: <Landmark className="h-6 w-6" />,
  },
];

export default function ReportPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplate>("donor");
  const [genTaskId, setGenTaskId] = useState<string | null>(null);
  const [chartUrls, setChartUrls] = useState<Record<string, string>>({});

  const { dispatchTask, isDispatching } = useDispatchTask();
  const genProgress = useTaskProgress(genTaskId);
  const { report, sections, exports, refetch: refetchReport } = useReport(projectId);

  const isGenerating =
    genProgress.status === "running" || genProgress.status === "claimed";
  const hasReport = report !== null;
  const isDrafted = report?.status === "drafted" || report?.status === "exported";

  // Load project + dataset
  useEffect(() => {
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data: projRaw } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      const proj = projRaw as Project | null;

      if (!proj) {
        router.push("/projects" as never);
        return;
      }
      setProject(proj);

      const { data: datasetsRaw } = await supabase
        .from("datasets")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1);
      const datasets = datasetsRaw as Dataset[] | null;

      setDataset(datasets?.[0] ?? null);
      setLoading(false);
    }

    load();
  }, [projectId, router]);

  // Sync template from existing report
  useEffect(() => {
    if (report?.template) {
      setSelectedTemplate(report.template);
    }
  }, [report?.template]);

  // Refetch when generation completes
  useEffect(() => {
    if (genProgress.status === "completed") {
      refetchReport();
      setGenTaskId(null);
    }
  }, [genProgress.status, refetchReport]);

  // Load chart signed URLs when sections change
  useEffect(() => {
    async function loadChartUrls() {
      const allChartIds: string[] = [];
      for (const section of sections) {
        const linked = section.linked_charts;
        if (Array.isArray(linked)) {
          allChartIds.push(...(linked as string[]));
        } else if (typeof linked === "string") {
          try {
            const parsed = JSON.parse(linked);
            if (Array.isArray(parsed)) allChartIds.push(...parsed);
          } catch {
            // ignore
          }
        }
      }

      if (allChartIds.length === 0) return;

      const supabase = createBrowserClient();
      const urls: Record<string, string> = {};

      // Fetch chart records to get file_path
      const { data: chartsRaw } = await supabase
        .from("charts")
        .select("id, file_path")
        .in("id", allChartIds);
      const charts = chartsRaw as { id: string; file_path: string | null }[] | null;

      if (charts) {
        for (const chart of charts) {
          if (!chart.file_path) continue;
          try {
            const { data } = await supabase.storage
              .from("charts")
              .createSignedUrl(chart.file_path, 3600);
            if (data?.signedUrl) {
              urls[chart.id] = data.signedUrl;
            }
          } catch {
            // skip
          }
        }
      }

      setChartUrls(urls);
    }

    loadChartUrls();
  }, [sections]);

  const handleGenerate = useCallback(async () => {
    if (!dataset) return;

    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    let reportId = report?.id;

    // Create or update report record
    if (!reportId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data: newReportRaw, error } = await sb
        .from("reports")
        .insert({
          project_id: projectId,
          created_by: user.id,
          name: `${project?.name ?? "Report"} — ${selectedTemplate.charAt(0).toUpperCase() + selectedTemplate.slice(1)}`,
          template: selectedTemplate,
          status: "generating",
        })
        .select("id")
        .single();
      const newReport = newReportRaw as { id: string } | null;

      if (error || !newReport) return;
      reportId = newReport.id;
    } else {
      await supabase
        .from("reports")
        // @ts-ignore — supabase update type inference
        .update({
          template: selectedTemplate as string,
          status: "generating",
        })
        .eq("id", reportId);
    }

    try {
      const { taskId } = await dispatchTask(
        projectId,
        "generate_report",
        {
          dataset_id: dataset.id,
          project_id: projectId,
          template: selectedTemplate,
          report_id: reportId,
        },
        dataset.id,
      );
      setGenTaskId(taskId);
    } catch {
      // Error handled by useDispatchTask
    }
  }, [dataset, project, projectId, selectedTemplate, report, dispatchTask]);

  if (loading) {
    return (
      <div className="container py-10">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${projectId}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <span className="text-muted-foreground">/</span>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${projectId}/analysis`}>
            Analysis
          </Link>
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">Report</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Report Generation</h1>
          {report && (
            <Badge variant="outline" className="text-xs">
              {report.status}
            </Badge>
          )}
        </div>
        {project && (
          <p className="mt-1 text-muted-foreground">{project.name}</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {/* Template selector */}
          <div>
            <h2 className="mb-3 text-sm font-medium">
              {hasReport ? "Change Template" : "Select Template"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {TEMPLATE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedTemplate(opt.value)}
                  disabled={isGenerating}
                  className={`rounded-lg border-2 p-4 text-left transition-all ${
                    selectedTemplate === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  } ${isGenerating ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className={selectedTemplate === opt.value ? "text-primary" : "text-muted-foreground"}>
                      {opt.icon}
                    </span>
                    <span className="font-medium">{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {opt.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          {!isGenerating && (
            <Button
              onClick={handleGenerate}
              disabled={isDispatching || !dataset}
              size="lg"
              className="w-full sm:w-auto"
            >
              {hasReport ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Re-generate with {selectedTemplate.charAt(0).toUpperCase() + selectedTemplate.slice(1)} Template
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Generate {selectedTemplate.charAt(0).toUpperCase() + selectedTemplate.slice(1)} Report
                </>
              )}
            </Button>
          )}

          {/* Generation progress */}
          {isGenerating && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating report...
                </div>
                <Progress value={genProgress.progress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {genProgress.progressMessage ?? "Processing..."}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Generation error */}
          {genProgress.error && (
            <Card className="border-red-200 dark:border-red-900">
              <CardContent className="p-4">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {genProgress.error}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Report editor */}
          {isDrafted && sections.length > 0 && (
            <ReportEditor sections={sections} chartUrls={chartUrls} />
          )}
        </div>

        {/* Sidebar: Export panel */}
        <div className="space-y-4">
          {isDrafted && report && (
            <ExportPanel
              reportId={report.id}
              projectId={projectId}
              exports={exports}
              onExportComplete={refetchReport}
            />
          )}
        </div>
      </div>
    </div>
  );
}
