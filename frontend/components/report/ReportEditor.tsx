"use client";

import { useCallback, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/lib/types/database";

type ReportSection = Tables<"report_sections">;

interface ReportEditorProps {
  sections: ReportSection[];
  chartUrls: Record<string, string>;
}

const confidenceColors: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  low: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function ReportEditor({ sections, chartUrls }: ReportEditorProps) {
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleBlur = useCallback(
    async (sectionId: string, content: string) => {
      setSavingId(sectionId);
      try {
        const supabase = createBrowserClient();
        await supabase
          .from("report_sections")
          .update({ content })
          .eq("id", sectionId);
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <SectionPanel
          key={section.id}
          section={section}
          chartUrls={chartUrls}
          isSaving={savingId === section.id}
          onBlur={handleBlur}
        />
      ))}
    </div>
  );
}

interface SectionPanelProps {
  section: ReportSection;
  chartUrls: Record<string, string>;
  isSaving: boolean;
  onBlur: (sectionId: string, content: string) => void;
}

function SectionPanel({ section, chartUrls, isSaving, onBlur }: SectionPanelProps) {
  const [content, setContent] = useState(section.content ?? "");
  const confidence = section.confidence ?? "medium";
  const hasPlaceholders = section.has_placeholders;
  const linkedCharts = parseLinkedCharts(section.linked_charts);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{section.title}</CardTitle>
          <div className="flex items-center gap-2">
            {isSaving && (
              <span className="text-xs text-muted-foreground">Saving...</span>
            )}
            <Badge
              variant="outline"
              className={confidenceColors[confidence] ?? confidenceColors.medium}
            >
              {confidence.toUpperCase()}
            </Badge>
          </div>
        </div>

        {confidence === "medium" && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
            ⚠ AI-generated content — needs review
          </div>
        )}

        {hasPlaceholders && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm italic text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
            This section contains [EXPERT INPUT:] placeholders that require manual input.
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={() => onBlur(section.id, content)}
          className={`min-h-[200px] font-mono text-sm ${
            hasPlaceholders ? "italic text-red-600 dark:text-red-400" : ""
          }`}
          placeholder="Section content..."
        />

        {/* Charts below the section */}
        {linkedCharts.length > 0 && (
          <div className="space-y-3">
            {linkedCharts.map((chartId) => {
              const url = chartUrls[chartId];
              if (!url) return null;
              return (
                <div key={chartId} className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="Analysis chart"
                    className="max-w-full rounded-md border"
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function parseLinkedCharts(linked: unknown): string[] {
  if (Array.isArray(linked)) return linked as string[];
  if (typeof linked === "string") {
    try {
      const parsed = JSON.parse(linked);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
