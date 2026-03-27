"use client";

import { useState } from "react";
import {
  CheckCircle2,
  FileText,
  HelpCircle,
  GitBranch,
  Languages,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { InstrumentUploader } from "@/components/instruments/InstrumentUploader";
import type { Tables, Json } from "@/lib/types/database";

interface InstrumentSectionProps {
  projectId: string;
  instrument: Tables<"instruments"> | null;
}

interface ParsedSettings {
  title?: string;
  languages?: string[];
}

export function InstrumentSection({
  projectId,
  instrument,
}: InstrumentSectionProps) {
  const [showUploader, setShowUploader] = useState(false);

  // Instrument is parsed — show summary
  if (instrument && instrument.parse_status === "parsed") {
    const settings = (instrument.settings ?? {}) as Record<string, Json>;
    const title = String(settings.title ?? instrument.name);
    const languages = Array.isArray(settings.languages)
      ? (settings.languages as string[])
      : [];

    const questions = Array.isArray(instrument.questions)
      ? instrument.questions
      : [];
    const skipLogic = Array.isArray(instrument.skip_logic)
      ? instrument.skip_logic
      : [];

    // Count actual questions (exclude groups, repeats, metadata)
    const questionCount = questions.filter((q) => {
      const qt =
        typeof q === "object" && q !== null
          ? (q as Record<string, Json>).question_type
          : null;
      return (
        qt !== "group" && qt !== "repeat" && qt !== "metadata" && qt !== "note"
      );
    }).length;

    return (
      <div>
        <h2 className="mb-4 text-xl font-semibold">Survey Instrument</h2>
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-900 dark:text-green-100">
                {title}
              </p>
              <p className="text-sm text-green-700 dark:text-green-300">
                {instrument.name}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2 text-green-800 dark:text-green-200">
              <HelpCircle className="h-4 w-4" />
              <span className="text-sm">
                <strong>{questionCount}</strong> questions
              </span>
            </div>
            <div className="flex items-center gap-2 text-green-800 dark:text-green-200">
              <GitBranch className="h-4 w-4" />
              <span className="text-sm">
                <strong>{skipLogic.length}</strong> skip logic rules
              </span>
            </div>
            <div className="flex items-center gap-2 text-green-800 dark:text-green-200">
              <Languages className="h-4 w-4" />
              <span className="text-sm">
                {languages.length > 0
                  ? languages.join(", ")
                  : "Default language"}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Instrument exists but is still parsing/pending/failed
  if (instrument && instrument.parse_status !== "parsed") {
    return (
      <div>
        <h2 className="mb-4 text-xl font-semibold">Survey Instrument</h2>
        <InstrumentUploader projectId={projectId} />
      </div>
    );
  }

  // No instrument: show banner or uploader
  if (showUploader) {
    return (
      <div>
        <h2 className="mb-4 text-xl font-semibold">Survey Instrument</h2>
        <InstrumentUploader projectId={projectId} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Survey Instrument</h2>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  Upload survey form for better analysis
                </p>
                <p className="text-sm text-muted-foreground">
                  Upload your XLSForm, PDF, or Word questionnaire to
                  automatically detect question types and skip logic. This step
                  is optional.
                </p>
              </div>
            </div>
            <button
              className="shrink-0 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              onClick={() => setShowUploader(true)}
            >
              Upload instrument
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
