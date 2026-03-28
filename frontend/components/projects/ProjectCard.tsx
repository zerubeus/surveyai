import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
}

/** Parse description — it may be stored as JSON `{"text":"...","tags":[...]}` or plain string */
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

/** Count completed steps from pipeline_status object */
function countCompletedSteps(pipelineStatus: unknown): number {
  if (!pipelineStatus || typeof pipelineStatus !== "object") return 0;
  return Object.values(pipelineStatus as Record<string, string>).filter(
    (v) => v === "completed"
  ).length;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const statusInfo = STATUS_LABELS[project.status] ?? {
    label: project.status,
    variant: "secondary" as const,
  };

  const { text: descText, tags } = parseDescription(project.description);

  const totalSteps = 7;
  const completedSteps = countCompletedSteps(
    (project as unknown as { pipeline_status?: unknown }).pipeline_status
  );
  const currentStep = (project as unknown as { current_step?: number }).current_step ?? 1;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="transition-colors hover:border-primary/50">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">{project.name?.trim()}</CardTitle>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
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

          {/* Workflow progress bar */}
          <div className="mb-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Step {currentStep} of {totalSteps}
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
  );
}
