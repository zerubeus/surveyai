"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useReport } from "@/hooks/useReport";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { LoadingSkeleton } from "@/components/workflow/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Building2,
  Download,
  FileOutput,
  FileText,
  GraduationCap,
  Landmark,
  Loader2,
  RefreshCw,
  Sparkles,
  Timer,
} from "lucide-react";
import { toast } from "@/lib/toast";
import type { Tables, Enums } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Project = Tables<"projects">;
type ReportSection = Tables<"report_sections">;
type ReportTemplate = Enums<"report_template">;
type ConfidenceLevel = Enums<"confidence_level">;

interface Step7ReportProps {
  project: Project;
  initialRunningTaskIds: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TEMPLATES: {
  id: ReportTemplate;
  name: string;
  subtitle: string;
  icon: typeof FileText;
}[] = [
  {
    id: "donor",
    name: "Donor Report",
    subtitle: "Formal structure, executive summary first",
    icon: Building2,
  },
  {
    id: "internal",
    name: "Internal Report",
    subtitle: "Concise, action-oriented format",
    icon: FileText,
  },
  {
    id: "academic",
    name: "Academic Report",
    subtitle: "Literature review, methodology focus",
    icon: GraduationCap,
  },
  {
    id: "policy",
    name: "Policy Brief",
    subtitle: "Key findings and recommendations",
    icon: Landmark,
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ConfidenceBadge({ level }: { level: ConfidenceLevel | null }) {
  switch (level) {
    case "high":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs">
          HIGH
        </Badge>
      );
    case "medium":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 text-xs">
          MEDIUM
        </Badge>
      );
    case "low":
      return (
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-xs">
          LOW
        </Badge>
      );
    default:
      return null;
  }
}

function confidenceTooltip(level: ConfidenceLevel | null): string {
  switch (level) {
    case "high":
      return "AI-generated from data";
    case "medium":
      return "Needs review";
    case "low":
      return "Placeholder text";
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function Step7Report({
  project,
  initialRunningTaskIds,
}: Step7ReportProps) {
  const supabase = createBrowserClient();
  const projectId = project.id;

  /* ---------- Task tracking ---------- */
  const [generateTaskId, setGenerateTaskId] = useState<string | null>(
    initialRunningTaskIds["generate_report"] ?? null,
  );
  const [exportTaskId, setExportTaskId] = useState<string | null>(
    initialRunningTaskIds["export_report"] ?? null,
  );
  const generateProgress = useTaskProgress(generateTaskId);
  const exportProgress = useTaskProgress(exportTaskId);
  const { dispatchTask, isDispatching } = useDispatchTask();

  /* ---------- Report data ---------- */
  const {
    report,
    sections,
    exports: reportExports,
    isLoading,
    refetch,
  } = useReport(projectId);

  /* ---------- UI state ---------- */
  const [selectedTemplate, setSelectedTemplate] =
    useState<ReportTemplate>("donor");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );
  const [editingTitle, setEditingTitle] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [showChangeTemplateConfirm, setShowChangeTemplateConfirm] =
    useState(false);

  /* ---------- Derived ---------- */
  const isGenerating =
    generateProgress.status === "running" ||
    generateProgress.status === "claimed" ||
    generateProgress.status === "pending";

  const isExporting =
    exportProgress.status === "running" ||
    exportProgress.status === "claimed" ||
    exportProgress.status === "pending";

  const selectedSection = useMemo(
    () => sections.find((s) => s.id === selectedSectionId) ?? null,
    [sections, selectedSectionId],
  );

  /* ---------- Select first section by default ---------- */
  useEffect(() => {
    if (sections.length > 0 && !selectedSectionId) {
      setSelectedSectionId(sections[0].id);
    }
  }, [sections, selectedSectionId]);

  /* ---------- Sync editing fields when section changes ---------- */
  useEffect(() => {
    if (selectedSection) {
      setEditingTitle(selectedSection.title);
      setEditingContent(selectedSection.content ?? "");
    }
  }, [selectedSection]);

  /* ---------- Export download URL + countdown ---------- */
  const latestExport = useMemo(() => {
    if (reportExports.length === 0) return null;
    return reportExports[0];
  }, [reportExports]);

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(0);

  useEffect(() => {
    if (!latestExport?.file_path) {
      setDownloadUrl(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data } = await supabase.storage
        .from("reports")
        .createSignedUrl(latestExport.file_path!, 3600);
      if (!cancelled && data?.signedUrl) {
        setDownloadUrl(data.signedUrl);
      }
    })();

    if (latestExport.expires_at) {
      const update = () => {
        const diff = Math.max(
          0,
          Math.floor(
            (new Date(latestExport.expires_at!).getTime() - Date.now()) / 60000,
          ),
        );
        setExpiresIn(diff);
      };
      update();
      const interval = setInterval(update, 60000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestExport]);

  /* ---------- Handlers ---------- */

  const handleGenerateReport = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Get current dataset
      const { data: datasets } = await supabase
        .from("datasets")
        .select("id")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .limit(1);
      const datasetId = datasets?.[0]?.id;
      if (!datasetId) {
        toast("No confirmed dataset found. Please complete Step 2 first.", { variant: "error" });
        return;
      }

      // Upsert report record
      let reportId: string;
      if (report?.id) {
        reportId = report.id;
      } else {
        const { data: newReport, error: reportErr } = await supabase
          .from("reports")
          .insert({
            project_id: projectId,
            dataset_id: datasetId,
            template: selectedTemplate,
            status: "pending",
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (reportErr || !newReport) {
          throw new Error(reportErr?.message ?? "Failed to create report record");
        }
        reportId = newReport.id;
      }

      const { taskId } = await dispatchTask(projectId, "generate_report", {
        template: selectedTemplate,
        report_id: reportId,
        project_id: projectId,
      }, datasetId);
      setGenerateTaskId(taskId);
      toast("Generating report...", { variant: "default" });
    } catch (e) {
      toast(`Failed to start report generation: ${e instanceof Error ? e.message : "Unknown error"}`, { variant: "error" });
    }
  }, [projectId, selectedTemplate, dispatchTask, report, supabase]);

  const handleChangeTemplate = useCallback(
    async (template: ReportTemplate) => {
      setShowChangeTemplateConfirm(false);
      if (!report?.id) {
        toast("No report to regenerate. Generate one first.", { variant: "error" });
        return;
      }
      try {
        const { data: datasets } = await supabase
          .from("datasets")
          .select("id")
          .eq("project_id", projectId)
          .eq("is_current", true)
          .limit(1);
        const datasetId = datasets?.[0]?.id;

        const { taskId } = await dispatchTask(projectId, "generate_report", {
          template,
          report_id: report.id,
          project_id: projectId,
          regenerate: true,
        }, datasetId ?? undefined);
        setGenerateTaskId(taskId);
        setSelectedSectionId(null);
        toast("Re-generating report with new template...", {
          variant: "default",
        });
      } catch {
        toast("Failed to re-generate report", { variant: "error" });
      }
    },
    [projectId, dispatchTask, report, supabase],
  );

  const handleSaveSection = useCallback(
    async (field: "title" | "content") => {
      if (!selectedSectionId) return;

      const updateData =
        field === "title"
          ? { title: editingTitle }
          : { content: editingContent };

      const { error } = await supabase
        .from("report_sections")
        .update(updateData)
        .eq("id", selectedSectionId);

      if (error) {
        toast(`Failed to save section ${field}`, { variant: "error" });
      }
    },
    [selectedSectionId, editingTitle, editingContent, supabase],
  );

  const handleMoveSection = useCallback(
    async (sectionId: string, direction: "up" | "down") => {
      const idx = sections.findIndex((s) => s.id === sectionId);
      if (idx < 0) return;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sections.length) return;

      const current = sections[idx];
      const swap = sections[swapIdx];

      await Promise.all([
        supabase
          .from("report_sections")
          .update({ sort_order: swap.sort_order })
          .eq("id", current.id),
        supabase
          .from("report_sections")
          .update({ sort_order: current.sort_order })
          .eq("id", swap.id),
      ]);
      refetch();
    },
    [sections, supabase, refetch],
  );

  const handleExport = useCallback(
    async (format: "docx" | "pdf") => {
      if (!report) return;
      try {
        const { taskId } = await dispatchTask(projectId, "export_report", {
          report_id: report.id,
          format,
        });
        setExportTaskId(taskId);
        toast(`Exporting ${format.toUpperCase()}...`, { variant: "default" });
      } catch {
        toast("Failed to start export", { variant: "error" });
      }
    },
    [projectId, report, dispatchTask],
  );

  /* ================================================================ */
  /*  Loading                                                          */
  /* ================================================================ */

  if (isLoading) {
    return <LoadingSkeleton type="card" count={3} />;
  }

  /* ================================================================ */
  /*  Generating state (no report yet)                                 */
  /* ================================================================ */

  if (isGenerating && !report) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <div>
                <p className="font-medium">Generating report...</p>
                <p className="text-sm text-muted-foreground">
                  {generateProgress.progressMessage ??
                    "Building sections..."}
                </p>
              </div>
            </div>
            <Progress value={generateProgress.progress} className="h-2" />
          </CardContent>
        </Card>
        <LoadingSkeleton type="card" count={4} />
      </div>
    );
  }

  /* ================================================================ */
  /*  Template selector (no report exists)                             */
  /* ================================================================ */

  if (!report) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Choose Report Template</h2>
          <p className="text-sm text-muted-foreground">
            Select a template that matches your audience
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            const isSelected = selectedTemplate === t.id;
            return (
              <Card
                key={t.id}
                className={`cursor-pointer transition-colors ${
                  isSelected
                    ? "border-blue-500 ring-2 ring-blue-200"
                    : "hover:border-muted-foreground/30"
                }`}
                onClick={() => setSelectedTemplate(t.id)}
              >
                <CardContent className="flex items-start gap-4 p-5">
                  <div
                    className={`rounded-lg p-2 ${isSelected ? "bg-blue-100" : "bg-muted"}`}
                  >
                    <Icon
                      className={`h-6 w-6 ${isSelected ? "text-blue-600" : "text-muted-foreground"}`}
                    />
                  </div>
                  <div>
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {t.subtitle}
                    </CardDescription>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button
            size="lg"
            onClick={handleGenerateReport}
            disabled={isDispatching}
          >
            {isDispatching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Generate Report
          </Button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Report editor                                                    */
  /* ================================================================ */

  return (
    <div className="space-y-4">
      {/* Generating overlay */}
      {isGenerating && (
        <Card className="border-blue-200">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm">
                {generateProgress.progressMessage ??
                  "Re-generating report..."}
              </span>
            </div>
            <Progress value={generateProgress.progress} className="h-1.5" />
          </CardContent>
        </Card>
      )}

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{report.name}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowChangeTemplateConfirm(true)}
          disabled={isGenerating}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Change Template
        </Button>
      </div>

      {/* Change template confirmation */}
      {showChangeTemplateConfirm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium">
              Select a new template to regenerate the report:
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATES.map((t) => (
                <Button
                  key={t.id}
                  variant="outline"
                  size="sm"
                  className={
                    t.id === report.template ? "border-blue-400" : ""
                  }
                  onClick={() => handleChangeTemplate(t.id)}
                  disabled={isDispatching}
                >
                  {t.name}
                  {t.id === report.template && " (current)"}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowChangeTemplateConfirm(false)}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Main editor: left panel + main panel */}
      <div className="flex gap-4 min-h-[500px]">
        {/* Left panel — section list (25%) */}
        <SectionList
          sections={sections}
          selectedSectionId={selectedSectionId}
          onSelectSection={setSelectedSectionId}
          onMoveSection={handleMoveSection}
        />

        {/* Main panel — section content (75%) */}
        <div className="flex-1 rounded-lg border p-6 space-y-4">
          {selectedSection ? (
            <SectionEditor
              section={selectedSection}
              editingTitle={editingTitle}
              editingContent={editingContent}
              onTitleChange={setEditingTitle}
              onContentChange={setEditingContent}
              onSaveTitle={() => handleSaveSection("title")}
              onSaveContent={() => handleSaveSection("content")}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a section to edit
            </div>
          )}
        </div>
      </div>

      {/* Export panel */}
      <ExportPanel
        isExporting={isExporting}
        isDispatching={isDispatching}
        exportProgress={{
          progress: exportProgress.progress,
          message: exportProgress.progressMessage,
        }}
        downloadUrl={downloadUrl}
        latestExport={latestExport}
        expiresIn={expiresIn}
        onExport={handleExport}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SectionList                                                        */
/* ------------------------------------------------------------------ */

function SectionList({
  sections,
  selectedSectionId,
  onSelectSection,
  onMoveSection,
}: {
  sections: ReportSection[];
  selectedSectionId: string | null;
  onSelectSection: (id: string) => void;
  onMoveSection: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <div className="w-1/4 shrink-0 space-y-1 rounded-lg border p-3 overflow-y-auto">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Sections
      </p>
      {sections.map((section, idx) => (
        <div
          key={section.id}
          className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
            selectedSectionId === section.id
              ? "bg-blue-50 text-blue-700 font-medium"
              : "hover:bg-muted/50"
          }`}
          onClick={() => onSelectSection(section.id)}
        >
          <span className="flex-1 truncate text-xs">{section.title}</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <ConfidenceBadge level={section.confidence} />
            <button
              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={idx === 0}
              onClick={(e) => {
                e.stopPropagation();
                onMoveSection(section.id, "up");
              }}
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={idx === sections.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                onMoveSection(section.id, "down");
              }}
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SectionEditor                                                      */
/* ------------------------------------------------------------------ */

function SectionEditor({
  section,
  editingTitle,
  editingContent,
  onTitleChange,
  onContentChange,
  onSaveTitle,
  onSaveContent,
}: {
  section: ReportSection;
  editingTitle: string;
  editingContent: string;
  onTitleChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onSaveTitle: () => void;
  onSaveContent: () => void;
}) {
  return (
    <>
      {/* Section title */}
      <input
        type="text"
        className="w-full text-xl font-semibold bg-transparent border-none outline-none focus:ring-0 p-0"
        value={editingTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onSaveTitle}
      />

      {/* Confidence badge */}
      <div className="flex items-center gap-2">
        <ConfidenceBadge level={section.confidence} />
        <span className="text-xs text-muted-foreground">
          {confidenceTooltip(section.confidence)}
        </span>
      </div>

      {/* Medium confidence banner */}
      {section.confidence === "medium" && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          This section needs expert review
        </div>
      )}

      {/* Low confidence: placeholder display */}
      {section.confidence === "low" && section.has_placeholders && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 italic">
          [EXPERT INPUT: This section requires manual content from a domain
          expert]
        </div>
      )}

      {/* Content textarea */}
      <textarea
        className="w-full flex-1 rounded-md border bg-white p-4 text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[300px]"
        value={editingContent}
        onChange={(e) => onContentChange(e.target.value)}
        onBlur={onSaveContent}
        style={{
          color: section.confidence === "low" ? "#b91c1c" : undefined,
          fontStyle: section.confidence === "low" ? "italic" : undefined,
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  ExportPanel                                                        */
/* ------------------------------------------------------------------ */

function ExportPanel({
  isExporting,
  isDispatching,
  exportProgress,
  downloadUrl,
  latestExport,
  expiresIn,
  onExport,
}: {
  isExporting: boolean;
  isDispatching: boolean;
  exportProgress: { progress: number; message: string | null };
  downloadUrl: string | null;
  latestExport: Tables<"report_exports"> | null;
  expiresIn: number;
  onExport: (format: "docx" | "pdf") => void;
}) {
  return (
    <Card className="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <Button
            onClick={() => onExport("docx")}
            disabled={isExporting || isDispatching}
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileOutput className="mr-2 h-4 w-4" />
            )}
            Export DOCX
          </Button>
          <Button
            variant="outline"
            onClick={() => onExport("pdf")}
            disabled={isExporting || isDispatching}
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileOutput className="mr-2 h-4 w-4" />
            )}
            Export PDF
          </Button>
        </div>

        {/* Export progress */}
        {isExporting && (
          <div className="flex-1 max-w-xs">
            <Progress value={exportProgress.progress} className="h-2" />
            <p className="mt-1 text-xs text-muted-foreground">
              {exportProgress.message ?? "Exporting..."}
            </p>
          </div>
        )}

        {/* Download button */}
        {downloadUrl && latestExport && !isExporting && (
          <div className="flex items-center gap-3">
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download {latestExport.format.toUpperCase()}
            </a>
            {expiresIn > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Timer className="h-3 w-3" />
                Expires in {expiresIn} min
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
