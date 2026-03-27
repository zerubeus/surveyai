"use client";

import { useCallback, useState } from "react";
import { DatasetUploader } from "@/components/datasets/DatasetUploader";
import { DatasetConfirmation } from "@/components/datasets/DatasetConfirmation";
import { CheckCircle2 } from "lucide-react";
import type { Tables } from "@/lib/types/database";

interface DatasetWorkflowProps {
  initialDataset: Tables<"datasets"> | null;
  projectId: string;
}

export function DatasetWorkflow({ initialDataset, projectId }: DatasetWorkflowProps) {
  const [dataset, setDataset] = useState<Tables<"datasets"> | null>(initialDataset);

  const handleUploadComplete = useCallback((uploaded: Tables<"datasets">) => {
    setDataset(uploaded);
  }, []);

  const handleConfirm = useCallback((confirmed: Tables<"datasets">) => {
    setDataset(confirmed);
  }, []);

  const handleCancel = useCallback(() => {
    setDataset(null);
  }, []);

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

  // Dataset confirmed: show success state
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
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
      <div className="mt-4 rounded-lg border border-dashed border-green-300 p-6 text-center text-sm text-green-700 dark:border-green-800 dark:text-green-300">
        Next step: Column role mapping will be available in the next sprint.
      </div>
    </div>
  );
}
