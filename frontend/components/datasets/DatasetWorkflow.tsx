"use client";

import { useCallback, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { DatasetUploader } from "@/components/datasets/DatasetUploader";
import { DatasetConfirmation } from "@/components/datasets/DatasetConfirmation";
import { ColumnRoleMapper } from "@/components/columns/ColumnRoleMapper";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/types/database";

interface DatasetWorkflowProps {
  initialDataset: Tables<"datasets"> | null;
  projectId: string;
  instrumentId: string | null;
}

export function DatasetWorkflow({ initialDataset, projectId, instrumentId }: DatasetWorkflowProps) {
  const [dataset, setDataset] = useState<Tables<"datasets"> | null>(initialDataset);
  const [isResetting, setIsResetting] = useState(false);

  const handleUploadComplete = useCallback((uploaded: Tables<"datasets">) => {
    setDataset(uploaded);
  }, []);

  const handleConfirm = useCallback((confirmed: Tables<"datasets">) => {
    setDataset(confirmed);
  }, []);

  const handleCancel = useCallback(() => {
    setDataset(null);
  }, []);

  // Reset: delete current dataset record + storage file so user can start fresh
  const handleReset = useCallback(async () => {
    if (!dataset) return;
    setIsResetting(true);
    const supabase = createBrowserClient();
    await supabase.from("datasets").update({ is_current: false }).eq("id", dataset.id);
    setDataset(null);
    setIsResetting(false);
  }, [dataset]);

  // No dataset yet: show uploader
  if (!dataset) {
    return (
      <DatasetUploader
        projectId={projectId}
        onUploadComplete={handleUploadComplete}
      />
    );
  }

  // Dataset uploaded but not confirmed: show confirmation gate
  if (dataset.status === "uploaded" || dataset.status === "uploading" || dataset.status === "previewed") {
    return (
      <DatasetConfirmation
        dataset={dataset}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  }

  // Dataset confirmed: show column role mapper + reset option
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-900 dark:text-green-100">
                Data confirmed
              </p>
              <p className="text-sm text-green-700 dark:text-green-300">
                {dataset.name} — {dataset.row_count?.toLocaleString() ?? "?"} rows,{" "}
                {dataset.column_count ?? "?"} columns
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isResetting}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {isResetting ? "Resetting..." : "Upload different file"}
          </Button>
        </div>
      </div>

      <ColumnRoleMapper
        datasetId={dataset.id}
        projectId={projectId}
        instrumentId={instrumentId}
      />
    </div>
  );
}
