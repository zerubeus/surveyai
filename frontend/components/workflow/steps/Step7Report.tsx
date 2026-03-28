"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useReport } from "@/hooks/useReport";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useProgressToast } from "@/hooks/useProgressToast";
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
import Link from "next/link";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BarChart3,
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
  useProgressToast(generateProgress, { label: "Report generation", thresholds: [30, 60, 90] });
  useProgressToast(exportProgress, { label: "Export" });
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
  const [sectionBaseUpdatedAt, setSectionBaseUpdatedAt] = useState<Record<string, string>>({});
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
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
      setConflictWarning(null);
      // Record the updated_at at the time we loaded this section
      setSectionBaseUpdatedAt(prev => ({
        ...prev,
        [selectedSection.id]: selectedSection.updated_at,
      }));
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
      // @ts-ignore — supabase type inference
      const { data: datasetsRaw } = await supabase
        .from("datasets")
        .select("id")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .limit(1);
      const datasets = datasetsRaw as Array<{ id: string }> | null;
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
        // @ts-ignore — supabase type inference
        const { data: newReportRaw, error: reportErr } = await supabase
          .from("reports")
          // @ts-ignore — supabase type inference
          .insert({
            project_id: projectId,
            dataset_id: datasetId,
            template: selectedTemplate,
            status: "pending",
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();
        const newReport = newReportRaw as { id: string } | null;
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
        // @ts-ignore — supabase type inference
        const { data: datasetsRaw2 } = await supabase
          .from("datasets")
          .select("id")
          .eq("project_id", projectId)
          .eq("is_current", true)
          .limit(1);
        const datasets2 = datasetsRaw2 as Array<{ id: string }> | null;
        const datasetId = datasets2?.[0]?.id;

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

      // Conflict check: if updated_at changed since we loaded the section, warn
      const baseTime = sectionBaseUpdatedAt[selectedSectionId];
      if (baseTime) {
        // @ts-ignore — supabase select type inference
        const { data: freshRaw } = await supabase
          .from("report_sections")
          .select("updated_at")
          .eq("id", selectedSectionId)
          .single();
        const fresh = freshRaw as { updated_at: string } | null;
        if (fresh?.updated_at && fresh.updated_at !== baseTime) {
          setConflictWarning(
            `⚠️ This section was edited by someone else (${new Date(fresh.updated_at).toLocaleTimeString()}). Your save will overwrite their changes.`
          );
          // Still save — just warn. Could add a "discard" option here.
        }
      }

      const updateData =
        field === "title"
          ? { title: editingTitle }
          : { content: editingContent };

      // @ts-ignore — supabase update type inference
      const { error } = await supabase
        .from("report_sections")
        // @ts-ignore — supabase type inference
        .update(updateData)
        .eq("id", selectedSectionId);

      if (error) {
        toast(`Failed to save section ${field}`, { variant: "error" });
      } else {
        // Update our baseline to the new saved time
        setSectionBaseUpdatedAt(prev => ({
          ...prev,
          [selectedSectionId]: new Date().toISOString(),
        }));
        setConflictWarning(null);
      }
    },
    [selectedSectionId, editingTitle, editingContent, supabase, sectionBaseUpdatedAt],
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
          // @ts-ignore — supabase update type inference
          .update({ sort_order: swap.sort_order })
          .eq("id", current.id),
        supabase
          .from("report_sections")
          // @ts-ignore — supabase update type inference
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

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);

  const handleGenerateShareLink = useCallback(async () => {
    if (!report) return;
    setIsGeneratingShare(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check if share already exists for this report
      // @ts-ignore — supabase select type inference
      const { data: existingRaw } = await supabase
        .from("report_shares")
        .select("token")
        .eq("report_id", report.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      const existing = existingRaw as { token: string } | null;

      let token: string;
      if (existing?.token) {
        token = existing.token;
      } else {
        // Create new share (expires in 30 days)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        // @ts-ignore — supabase insert type inference
        const { data: newShareRaw } = await supabase
          .from("report_shares")
          // @ts-ignore — supabase type inference
          .insert({
            report_id: report.id,
            created_by: user.id,
            expires_at: expiresAt,
          })
          .select("token")
          .single();
        const newShare = newShareRaw as { token: string } | null;
        if (!newShare?.token) throw new Error("Failed to create share link");
        token = newShare.token;
      }

      const url = `${window.location.origin}/share/${token}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url).catch(() => {});
      toast("Share link copied to clipboard!", { variant: "success" });
    } catch (err) {
      toast(`Failed to generate share link: ${err instanceof Error ? err.message : "unknown"}`, { variant: "error" });
    } finally {
      setIsGeneratingShare(false);
    }
  }, [report, supabase]);

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

      {/* Quick nav: back to analysis results */}
      <div className="flex items-center justify-end">
        <Link
          href={`/projects/${project.id}/step/6`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          View analysis results
        </Link>
      </div>

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
          {conflictWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-500" />
              <div>
                <p className="font-medium">Edit conflict detected</p>
                <p className="mt-0.5">{conflictWarning}</p>
                <button
                  type="button"
                  onClick={() => setConflictWarning(null)}
                  className="mt-1 text-orange-600 underline hover:no-underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
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
        shareUrl={shareUrl}
        isGeneratingShare={isGeneratingShare}
        onGenerateShareLink={handleGenerateShareLink}
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
  shareUrl,
  isGeneratingShare,
  onGenerateShareLink,
}: {
  isExporting: boolean;
  isDispatching: boolean;
  exportProgress: { progress: number; message: string | null };
  downloadUrl: string | null;
  latestExport: Tables<"report_exports"> | null;
  expiresIn: number;
  onExport: (format: "docx" | "pdf") => void;
  shareUrl: string | null;
  isGeneratingShare: boolean;
  onGenerateShareLink: () => void;
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

        {/* Share link */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Share report (read-only)</p>
              <p className="text-xs text-muted-foreground">Generate a link anyone can view without signing in. Expires in 30 days.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onGenerateShareLink}
              disabled={isGeneratingShare}
              className="flex-shrink-0"
            >
              {isGeneratingShare
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              {shareUrl ? "Regenerate" : "Generate link"}
            </Button>
          </div>
          {shareUrl && (
            <div className="mt-2 flex items-center gap-2 rounded-md border bg-gray-50 p-2">
              <code className="flex-1 truncate text-xs text-blue-700">{shareUrl}</code>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(shareUrl).catch(() => {}); toast("Copied!", { variant: "success", duration: 2000 }); }}
                className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200"
              >
                Copy
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
