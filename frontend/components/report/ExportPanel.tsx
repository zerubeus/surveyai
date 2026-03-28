"use client";

import { useCallback, useEffect, useState } from "react";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  FileText,
  FileDown,
  Loader2,
  Clock,
} from "lucide-react";
import type { Tables } from "@/lib/types/database";

type ReportExport = Tables<"report_exports">;

interface ExportPanelProps {
  reportId: string;
  projectId: string;
  exports: ReportExport[];
  onExportComplete: () => void;
}

export function ExportPanel({
  reportId,
  projectId,
  exports,
  onExportComplete,
}: ExportPanelProps) {
  const [exportTaskId, setExportTaskId] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const { dispatchTask, isDispatching } = useDispatchTask();
  const exportProgress = useTaskProgress(exportTaskId);

  const isExporting =
    exportProgress.status === "running" || exportProgress.status === "claimed";

  // Refresh signed URLs for existing exports
  useEffect(() => {
    async function loadUrls() {
      if (exports.length === 0) return;
      const supabase = createBrowserClient();
      const urls: Record<string, string> = {};

      for (const exp of exports) {
        if (!exp.file_path) continue;
        const isExpired = exp.expires_at
          ? new Date(exp.expires_at) < new Date()
          : false;
        if (isExpired) continue;

        try {
          const { data } = await supabase.storage
            .from("reports")
            .createSignedUrl(exp.file_path, 3600);
          if (data?.signedUrl) {
            urls[exp.id] = data.signedUrl;
          }
        } catch {
          // Signed URL generation failed — skip
        }
      }
      setSignedUrls(urls);
    }

    loadUrls();
  }, [exports]);

  // Notify parent when export completes
  useEffect(() => {
    if (exportProgress.status === "completed") {
      setExportTaskId(null);
      onExportComplete();
    }
  }, [exportProgress.status, onExportComplete]);

  const handleExport = useCallback(async () => {
    try {
      const { taskId } = await dispatchTask(
        projectId,
        "export_report",
        {
          report_id: reportId,
          formats: ["docx", "pdf"],
        },
      );
      setExportTaskId(taskId);
    } catch {
      // Error handled by useDispatchTask
    }
  }, [projectId, reportId, dispatchTask]);

  // Separate exports by format, take latest of each
  const latestDocx = exports.find((e) => e.format === "docx");
  const latestPdf = exports.find((e) => e.format === "pdf");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileDown className="h-5 w-5" />
          Export Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Export button */}
        <Button
          onClick={handleExport}
          disabled={isDispatching || isExporting}
          className="w-full"
        >
          {isExporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              {exports.length > 0 ? "Re-export" : "Export"} DOCX + PDF
            </>
          )}
        </Button>

        {/* Export progress */}
        {isExporting && (
          <div className="space-y-2">
            <Progress value={exportProgress.progress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {exportProgress.progressMessage ?? "Processing..."}
            </p>
          </div>
        )}

        {/* Export error */}
        {exportProgress.error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {exportProgress.error}
          </p>
        )}

        {/* Download links */}
        {(latestDocx || latestPdf) && (
          <div className="space-y-2">
            {latestDocx && (
              <ExportDownloadLink
                exp={latestDocx}
                url={signedUrls[latestDocx.id]}
                icon={<FileText className="h-4 w-4" />}
                label="Download DOCX"
              />
            )}
            {latestPdf && (
              <ExportDownloadLink
                exp={latestPdf}
                url={signedUrls[latestPdf.id]}
                icon={<FileText className="h-4 w-4" />}
                label="Download PDF"
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ExportDownloadLinkProps {
  exp: ReportExport;
  url: string | undefined;
  icon: React.ReactNode;
  label: string;
}

function ExportDownloadLink({ exp, url, icon, label }: ExportDownloadLinkProps) {
  const isExpired = exp.expires_at
    ? new Date(exp.expires_at) < new Date()
    : false;

  const expiresAt = exp.expires_at ? new Date(exp.expires_at) : null;
  const minutesLeft = expiresAt
    ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60000))
    : null;

  if (isExpired || !url) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed p-3 text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          {icon}
          {label}
        </div>
        <Badge variant="outline" className="text-xs text-muted-foreground">
          Expired
        </Badge>
      </div>
    );
  }

  return (
    <a
      href={url}
      download
      className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-2">
        {minutesLeft !== null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {minutesLeft}m left
          </span>
        )}
        <Download className="h-4 w-4 text-muted-foreground" />
      </div>
    </a>
  );
}
