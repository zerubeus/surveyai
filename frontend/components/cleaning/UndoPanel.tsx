"use client";

import { useCallback, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Undo2, Loader2 } from "lucide-react";
import type { Tables, Json } from "@/lib/types/database";

type CleaningOperation = Tables<"cleaning_operations">;

interface UndoPanelProps {
  appliedOperations: CleaningOperation[];
  onRefetch: () => void;
}

export function UndoPanel({ appliedOperations, onRefetch }: UndoPanelProps) {
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const handleUndo = useCallback(
    async (operation: CleaningOperation) => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setUndoingId(operation.id);

      try {
        // Mark operation as undone
        await supabase
          .from("cleaning_operations")
          // @ts-expect-error — supabase update type inference
          .update({
            status: "undone" as const,
            undone_at: new Date().toISOString(),
            undone_by: user.id,
          })
          .eq("id", operation.id);

        // Revert dataset version: set resulting dataset is_current=false,
        // set parent dataset is_current=true
        if (operation.resulting_dataset_id) {
          // Get the resulting dataset to find its parent
          // @ts-ignore — supabase select type inference
          const { data: resultingDatasetRaw } = await supabase
            .from("datasets")
            .select("parent_id")
            .eq("id", operation.resulting_dataset_id)
            .single();
          const resultingDataset = resultingDatasetRaw as { parent_id: string | null } | null;

          if (resultingDataset?.parent_id) {
            // Set resulting dataset as not current
            await supabase
              .from("datasets")
              // @ts-expect-error — supabase update type inference
              .update({ is_current: false })
              .eq("id", operation.resulting_dataset_id);

            // Set parent as current
            await supabase
              .from("datasets")
              // @ts-expect-error — supabase update type inference
              .update({ is_current: true })
              .eq("id", resultingDataset.parent_id);
          }
        }

        onRefetch();
      } finally {
        setUndoingId(null);
      }
    },
    [onRefetch],
  );

  if (appliedOperations.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Undo2 className="h-4 w-4" />
          Applied Operations ({appliedOperations.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {appliedOperations.map((op) => {
          const beforeSnapshot = op.before_snapshot as Record<string, Json> | null;
          const afterSnapshot = op.after_snapshot as Record<string, Json> | null;
          const isUndoing = undoingId === op.id;

          return (
            <div
              key={op.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium capitalize">
                    {op.operation_type.replace(/_/g, " ")}
                  </span>
                  {op.column_name && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {op.column_name}
                    </span>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    applied
                  </Badge>
                </div>
                {beforeSnapshot && afterSnapshot && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Rows: {String(beforeSnapshot.row_count)} →{" "}
                    {String(afterSnapshot.row_count)} | Nulls:{" "}
                    {String(beforeSnapshot.null_count)} →{" "}
                    {String(afterSnapshot.null_count)}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleUndo(op)}
                disabled={isUndoing}
              >
                {isUndoing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Undo
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
