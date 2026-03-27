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

export function ProjectCard({ project }: ProjectCardProps) {
  const statusInfo = STATUS_LABELS[project.status] ?? {
    label: project.status,
    variant: "secondary" as const,
  };

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="transition-colors hover:border-primary/50">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">{project.name}</CardTitle>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </CardHeader>
        <CardContent>
          {project.description && (
            <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Created {new Date(project.created_at).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
