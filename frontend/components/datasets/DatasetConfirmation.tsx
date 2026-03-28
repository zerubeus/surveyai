"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DataPreview } from "@/components/datasets/DataPreview";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { Tables } from "@/lib/types/database";

interface DatasetConfirmationProps {
  dataset: Tables<"datasets">;
  onConfirm: (confirmed: Tables<"datasets">) => void;
  onCancel: () => void;
}

export function DatasetConfirmation({
  dataset,
  onConfirm,
  onCancel,
}: DatasetConfirmationProps) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    const supabase = createBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: updated, error } = await supabase
      .from("datasets")
      // @ts-expect-error — supabase update type inference
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by: user?.id ?? null,
      })
      .eq("id", dataset.id)
      .select()
      .single();

    if (!error && updated) {
      onConfirm(updated);
    }
    setConfirming(false);
  };

  const handleCancel = async () => {
    setCancelling(true);
    const supabase = createBrowserClient();

    // Delete dataset record first
    await supabase.from("datasets").delete().eq("id", dataset.id);

    // Remove file from storage
    await supabase.storage.from("uploads").remove([dataset.original_file_path]);

    onCancel();
    setCancelling(false);
  };

  return (
    <div className="space-y-4">
      <DataPreview
        datasetId={dataset.id}
        storagePath={dataset.original_file_path}
        fileType={dataset.file_type}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Confirm your data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm text-muted-foreground">
            {dataset.row_count != null && dataset.column_count != null ? (
              <p>
                We detected <strong className="text-foreground">{dataset.row_count.toLocaleString('en-US')} rows</strong> and{" "}
                <strong className="text-foreground">{dataset.column_count} columns</strong>.
                Row 1 appears to be headers.
              </p>
            ) : (
              <p>
                Preview loaded. Please verify the data looks correct before continuing.
              </p>
            )}
            <p>
              File: <strong className="text-foreground">{dataset.name}</strong>{" "}
              ({dataset.file_type.toUpperCase()},{" "}
              {dataset.file_size_bytes
                ? `${(dataset.file_size_bytes / 1024).toFixed(1)} KB`
                : "unknown size"}
              )
            </p>
          </div>
        </CardContent>
        <CardFooter className="gap-3">
          <Button onClick={handleConfirm} disabled={confirming || cancelling}>
            {confirming ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Looks good, continue
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={confirming || cancelling}
          >
            {cancelling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            Cancel
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
