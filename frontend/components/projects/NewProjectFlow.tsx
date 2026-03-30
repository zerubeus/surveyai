"use client";

import { useState, useCallback, useRef } from "react";
import { Upload, FileText, ArrowRight, ArrowLeft, Loader2, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProjectContextForm } from "@/components/projects/ProjectContextForm";
import { toast } from "@/lib/toast";
import type { ProjectFormData } from "@/lib/schemas/project";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AISuggestions {
  name: string;
  objective_text: string;
  objective_tags: string[];
  research_questions: { text: string; priority: number }[];
  target_population: string;
  sampling_method: string;
  country: string;
  regions: string;
}

interface AIMetadata {
  headers: string[];
  row_count: number;
  instrument_detected: boolean;
}

type FlowStep = "upload" | "review";

const DATASET_ACCEPTS = ".csv,.xls,.xlsx";
const INSTRUMENT_ACCEPTS = ".pdf,.docx,.xls,.xlsx";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/* ------------------------------------------------------------------ */
/*  Mini progress indicator                                            */
/* ------------------------------------------------------------------ */

function OnboardingProgress({ step }: { step: FlowStep }) {
  const steps = [
    { key: "upload" as const, label: "Upload Data" },
    { key: "review" as const, label: "Project Brief" },
    { key: "analyze" as const, label: "Begin Analysis" },
  ];

  const currentIdx = step === "upload" ? 0 : 1;

  return (
    <div className="mb-8 flex items-center justify-center gap-0">
      {steps.map((s, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;

        return (
          <div key={s.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors ${
                  isCompleted
                    ? "border-green-500 bg-green-500 text-white"
                    : isCurrent
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-muted-foreground/30 bg-muted text-muted-foreground"
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : idx + 1}
              </div>
              <span
                className={`mt-1 text-xs ${
                  isCurrent
                    ? "font-semibold text-blue-600"
                    : isCompleted
                      ? "font-medium text-green-600"
                      : "text-muted-foreground"
                }`}
              >
                {s.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`mx-3 h-0.5 w-12 ${
                  isCompleted ? "bg-green-500" : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File drop zone                                                     */
/* ------------------------------------------------------------------ */

function FileDropZone({
  label,
  sublabel,
  accepts,
  file,
  onFileSelect,
  icon: Icon,
  required,
}: {
  label: string;
  sublabel: string;
  accepts: string;
  file: File | null;
  onFileSelect: (file: File | null) => void;
  icon: typeof Upload;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      if (f.size > MAX_FILE_SIZE) {
        toast("File exceeds 50MB limit", { variant: "error" });
        return;
      }
      onFileSelect(f);
    },
    [onFileSelect],
  );

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        dragOver
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
          : file
            ? "border-green-500 bg-green-50/50 dark:bg-green-950/20"
            : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accepts}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Icon className={`mx-auto h-8 w-8 ${file ? "text-green-600" : "text-muted-foreground"}`} />
      <p className="mt-2 text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Accepts: {accepts} &middot; Max 50MB
      </p>
      {file && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-green-100 px-3 py-1.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
          <Check className="h-3 w-3" />
          {file.name} ({formatSize(file.size)})
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main flow component                                                */
/* ------------------------------------------------------------------ */

interface NewProjectFlowProps {
  organizationId: string;
}

export function NewProjectFlow({ organizationId }: NewProjectFlowProps) {
  const [step, setStep] = useState<FlowStep>("upload");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [instrumentFile, setInstrumentFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Partial<ProjectFormData> | null>(null);
  const [aiFilledFields, setAiFilledFields] = useState<string[]>([]);
  const [aiMetadata, setAiMetadata] = useState<AIMetadata | null>(null);

  async function handleAnalyze() {
    if (!csvFile) return;

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const formData = new FormData();
      formData.append("dataset", csvFile);
      if (instrumentFile) {
        formData.append("instrument", instrumentFile);
      }

      const res = await fetch("/api/analyze-uploads", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(data.error || "Analysis failed");
      }

      const data = (await res.json()) as {
        suggestions: AISuggestions;
        metadata: AIMetadata;
      };

      // Convert AI suggestions into ProjectFormData shape
      const filledFields: string[] = [];
      const initial: Partial<ProjectFormData> = {};

      if (data.suggestions.name) {
        initial.name = data.suggestions.name;
        filledFields.push("name");
      }
      if (data.suggestions.objective_text) {
        initial.objective_text = data.suggestions.objective_text;
        filledFields.push("objective_text");
      }
      if (data.suggestions.objective_tags?.length > 0) {
        initial.objective_tags = data.suggestions.objective_tags as ProjectFormData["objective_tags"];
        filledFields.push("objective_tags");
      }
      if (data.suggestions.research_questions?.length > 0) {
        initial.research_questions = data.suggestions.research_questions;
        filledFields.push("research_questions");
      }
      if (data.suggestions.target_population) {
        initial.target_population = data.suggestions.target_population;
        filledFields.push("target_population");
      }
      if (data.suggestions.sampling_method) {
        initial.sampling_method = data.suggestions.sampling_method as ProjectFormData["sampling_method"];
        filledFields.push("sampling_method");
      }
      if (data.suggestions.country || data.suggestions.regions) {
        initial.geographic_scope = {
          country: data.suggestions.country ?? "",
          regions: data.suggestions.regions ?? "",
          urban: false,
          rural: false,
        };
        if (data.suggestions.country) filledFields.push("geographic_scope.country");
        if (data.suggestions.regions) filledFields.push("geographic_scope.regions");
      }

      setSuggestions(initial);
      setAiFilledFields(filledFields);
      setAiMetadata(data.metadata);
      setStep("review");
    } catch (err) {
      setAnalyzeError(
        err instanceof Error ? err.message : "Analysis failed. You can still fill the form manually.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleSkipToForm() {
    setSuggestions(null);
    setAiFilledFields([]);
    setStep("review");
  }

  /* ---------------------------------------------------------------- */
  /*  Upload step                                                      */
  /* ---------------------------------------------------------------- */

  if (step === "upload") {
    return (
      <div className="container max-w-2xl py-10">
        <OnboardingProgress step="upload" />

        <div className="text-center">
          <h1 className="text-3xl font-bold">Start your analysis</h1>
          <p className="mt-2 text-muted-foreground">
            Upload your dataset and optionally your questionnaire. We&apos;ll autofill the project form for you.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <FileDropZone
            label="Your survey data"
            sublabel="Dataset file"
            accepts={DATASET_ACCEPTS}
            file={csvFile}
            onFileSelect={setCsvFile}
            icon={Upload}
            required
          />
          <FileDropZone
            label="Survey instrument"
            sublabel="Questionnaire (optional)"
            accepts={INSTRUMENT_ACCEPTS}
            file={instrumentFile}
            onFileSelect={setInstrumentFile}
            icon={FileText}
          />
        </div>

        {analyzeError && (
          <Card className="mt-4 border-destructive/50">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="text-sm">
                <p className="font-medium text-destructive">{analyzeError}</p>
                <button
                  type="button"
                  onClick={handleSkipToForm}
                  className="mt-1 text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Skip AI analysis and fill manually
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            size="lg"
            disabled={!csvFile || isAnalyzing}
            onClick={handleAnalyze}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                AI is reading your files...
              </>
            ) : (
              <>
                Analyze with AI
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          <button
            type="button"
            onClick={handleSkipToForm}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Skip — fill form manually
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Review step                                                      */
  /* ---------------------------------------------------------------- */

  return (
    <div className="container max-w-3xl py-10">
      <OnboardingProgress step="review" />

      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">Your project brief</h1>
        {aiFilledFields.length > 0 && (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300">
            AI-generated — edit as needed
          </Badge>
        )}
      </div>

      {aiMetadata && (
        <p className="mt-1 text-sm text-muted-foreground">
          Detected {aiMetadata.headers.length} columns and ~{aiMetadata.row_count.toLocaleString()} rows
          {aiMetadata.instrument_detected && " + questionnaire"}
        </p>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setStep("upload")}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to upload
        </button>

        <ProjectContextForm
          organizationId={organizationId}
          initialValues={suggestions ?? undefined}
          aiFilledFields={aiFilledFields.length > 0 ? aiFilledFields : undefined}
        />
      </div>
    </div>
  );
}
