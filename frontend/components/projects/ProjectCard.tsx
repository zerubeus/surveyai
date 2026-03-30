"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Tables } from "@/lib/types/database";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  draft: { label: "Draft", variant: "secondary" },
  context_set: { label: "Context Set", variant: "outline" },
  instrument_uploaded: { label: "Instrument Uploaded", variant: "outline" },
  data_uploaded: { label: "Data Uploaded", variant: "outline" },
  roles_mapped: { label: "Roles Mapped", variant: "outline" },
  eda_complete: { label: "EDA Complete", variant: "outline" },
  cleaning_complete: { label: "Cleaning Complete", variant: "outline" },
  analysis_complete: { label: "Analysis Complete", variant: "default" },
  report_complete: { label: "Report Complete", variant: "default" },
};

interface ProjectCardProps {
  project: Tables<"projects">;
  onDeleted?: (id: string) => void;
  qualityScore?: number | null;
}

function parseDescription(raw: string | null): { text: string | null; tags: string[] } {
  if (!raw) return { text: null, tags: [] };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        text: typeof parsed.text === "string" ? parsed.text : null,
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    }
  } catch {
    // not JSON — plain string
  }
  return { text: raw, tags: [] };
}

// Step 2 (Upload) is hidden from UI — exclude from count
const VISIBLE_STEPS = ["1", "3", "4", "5", "6", "7", "8"];
const STEP_NAMES: Record<string, string> = {
  "1": "Project Brief",
  "3": "Map Columns",
  "4": "Quality",
  "5": "Cleaning",
  "6": "Analysis",
  "7": "Visualisation",
  "8": "Report",
};

function countCompletedSteps(pipelineStatus: unknown): number {
  if (!pipelineStatus || typeof pipelineStatus !== "object") return 0;
  return VISIBLE_STEPS.filter(
    (k) => (pipelineStatus as Record<string, string>)[k] === "completed"
  ).length;
}

export function ProjectCard({ project, onDeleted, qualityScore }: ProjectCardProps) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const statusInfo = STATUS_LABELS[project.status] ?? {
    label: project.status,
    variant: "secondary" as const,
  };

  const { text: descText, tags } = parseDescription(project.description);
  const totalSteps = 7;
  const completedSteps = countCompletedSteps(
    (project as unknown as { pipeline_status?: unknown }).pipeline_status
  );
  const currentStepNum = (project as unknown as { current_step?: number }).current_step ?? 1;
  // Map DB step number to visible position (step 2 hidden → step 3 is visible step 2, etc.)
  const visibleStepNum = currentStepNum <= 1 ? 1 : currentStepNum <= 2 ? 1 : currentStepNum - 1;
  const currentStepName = STEP_NAMES[String(currentStepNum)] ?? `Step ${visibleStepNum}`;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleting(true);
    await supabase.from("projects").delete().eq("id", project.id);
    setIsDeleting(false);
    setShowConfirm(false);
    onDeleted?.(project.id);
    router.refresh();
  }

  return (
    <div className="relative">
      <Link href={`/projects/${project.id}`}>
        <Card className="transition-colors hover:border-primary/50">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold pr-8">{project.name?.trim()}</CardTitle>
            <div className="flex items-center gap-1.5">
              {qualityScore !== null && qualityScore !== undefined && (
                <span
                  title={`Data quality: ${qualityScore.toFixed(1)}/100`}
                  className={`text-xs font-medium ${
                    qualityScore >= 80 ? "text-emerald-600" :
                    qualityScore >= 60 ? "text-yellow-600" : "text-red-500"
                  }`}
                >
                  {qualityScore >= 80 ? "🟢" : qualityScore >= 60 ? "🟡" : "🔴"} {qualityScore.toFixed(0)}
                </span>
              )}
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {descText && (
              <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
                {descText}
              </p>
            )}
            {tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            <div className="mb-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {currentStepName} ({visibleStepNum}/{totalSteps})
                </span>
                <span className="text-xs text-muted-foreground">{progressPercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Created {new Date(project.created_at).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
      </Link>

      {/* Kebab menu — absolutely positioned, outside Link */}
      <div className="absolute right-3 top-3 z-10">
        {!showConfirm ? (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(!showMenu); }}
            className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 transition-opacity [.relative:hover_&]:opacity-100"
            aria-label="Project options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        ) : null}

        {showMenu && !showConfirm && (
          <div
            className="absolute right-0 top-6 z-20 min-w-[140px] rounded-md border bg-popover p-1 shadow-md"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(false); setShowConfirm(true); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete project
            </button>
          </div>
        )}

        {showConfirm && (
          <div
            className="absolute right-0 top-0 z-20 rounded-md border bg-popover p-3 shadow-md w-52"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <p className="text-xs font-medium mb-2">Delete this project?</p>
            <p className="text-xs text-muted-foreground mb-3">This cannot be undone.</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowConfirm(false); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
