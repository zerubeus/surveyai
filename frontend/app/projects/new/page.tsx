"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { Json } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AIPrefill {
  name: string;
  objective_text: string;
  objective_tags: string[];
  research_questions: { text: string; priority: number }[];
  target_population: string;
  sampling_method: string;
  country: string;
  regions: string;
}

/* ------------------------------------------------------------------ */
/*  Drop zone                                                          */
/* ------------------------------------------------------------------ */

function DropZone({
  label,
  accept,
  required,
  file,
  onFile,
  icon,
}: {
  label: string;
  accept: string;
  required: boolean;
  file: File | null;
  onFile: (f: File | null) => void;
  icon: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile]
  );

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
        dragging
          ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
          : file
          ? "border-green-400 bg-green-50 dark:bg-green-950/20"
          : "border-muted-foreground/25 bg-muted/20 hover:border-muted-foreground/50 hover:bg-muted/30"
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />

      {file ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 text-green-600">{icon}</div>
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-medium text-green-800 dark:text-green-200">
                {file.name}
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
          <button
            type="button"
            className="flex-shrink-0 rounded-full p-1 hover:bg-green-100 dark:hover:bg-green-900"
            onClick={(e) => { e.stopPropagation(); onFile(null); }}
          >
            <X className="h-4 w-4 text-green-600" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium">
              {label}
              {required && <span className="ml-1 text-destructive">*</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Drop file here or click to browse
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function NewProjectPage() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [instrumentFile, setInstrumentFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "creating" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Load org on mount
  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/auth/login"); return; }
      setUserId(user.id);
      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (membership) {
        setOrgId((membership as { organization_id: string }).organization_id);
      } else {
        // Auto-create org
        const { data: org } = await (supabase as unknown as { rpc: (n: string, p: unknown) => Promise<{ data: unknown }> }).rpc(
          "create_org_with_owner",
          {
            p_name: `${user.email?.split("@")[0] ?? "User"}'s Organization`,
            p_slug: `org-${user.id.slice(0, 8)}`,
          }
        );
        setOrgId(org as string);
      }
    });
  }, [router]);

  const handleAnalyze = useCallback(async () => {
    if (!csvFile || !orgId || !userId) return;

    setStatus("analyzing");
    setStatusMsg("Reading your files…");

    try {
      // Step 1: Call AI analysis API
      const formData = new FormData();
      formData.append("dataset", csvFile);
      if (instrumentFile) formData.append("instrument", instrumentFile);

      setStatusMsg("AI is reading your data…");
      const res = await fetch("/api/analyze-uploads", {
        method: "POST",
        body: formData,
      });

      let suggestions: AIPrefill = {
        name: csvFile.name.replace(/\.[^.]+$/, "").replace(/_/g, " "),
        objective_text: "",
        objective_tags: [],
        research_questions: [{ text: "", priority: 1 }],
        target_population: "",
        sampling_method: "simple_random",
        country: "",
        regions: "",
      };

      if (res.ok) {
        const data = await res.json();
        if (data.suggestions) suggestions = { ...suggestions, ...data.suggestions };
      }
      // If AI fails, we still continue with defaults

      // Step 2: Create project with ai_prefill in additional_context
      setStatus("creating");
      setStatusMsg("Setting up your project…");

      const supabase = createBrowserClient();
      const { data: projectRaw, error } = await (supabase as unknown as {
        from: (t: string) => {
          insert: (d: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: unknown }> } }
        }
      })
        .from("projects")
        .insert({
          organization_id: orgId,
          created_by: userId,
          name: suggestions.name || "New Project",
          description: JSON.stringify({
            text: suggestions.objective_text,
            tags: suggestions.objective_tags ?? [],
          }),
          status: "draft",
          research_questions: suggestions.research_questions as unknown as Json,
          sampling_method: suggestions.sampling_method,
          target_population: suggestions.target_population,
          geographic_scope: JSON.stringify({
            country: suggestions.country,
            regions: suggestions.regions,
            urban: false,
            rural: false,
          }),
          additional_context: JSON.stringify({
            ai_prefill: suggestions,
            ai_prefill_fields: Object.keys(suggestions as unknown as Record<string, unknown>).filter(
              (k) => {
                const v = (suggestions as unknown as Record<string, unknown>)[k];
                return v !== "" && !(Array.isArray(v) && v.length === 0);
              }
            ),
          }),
          current_step: 1,
          pipeline_status: {
            "1": "active",
            "2": "locked",
            "3": "locked",
            "4": "locked",
            "5": "locked",
            "6": "locked",
            "7": "locked",
            "8": "locked",
          },
        })
        .select("id")
        .single();

      if (error || !projectRaw) {
        throw new Error((error as { message: string })?.message ?? "Failed to create project");
      }

      const project = projectRaw as { id: string };
      router.push(`/projects/${project.id}/step/1`);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setStatusMsg(String(err));
    }
  }, [csvFile, instrumentFile, orgId, userId, router]);

  const isLoading = status === "analyzing" || status === "creating";

  return (
    <div className="container max-w-2xl py-12">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Start your analysis</h1>
        <p className="mt-2 text-muted-foreground">
          Upload your dataset and optionally your questionnaire.
          <br />
          AI will read your files and set up your project automatically.
        </p>
      </div>

      <div className="space-y-4">
        {/* Dataset upload */}
        <DropZone
          label="Survey dataset"
          accept=".csv,.xls,.xlsx"
          required
          file={csvFile}
          onFile={setCsvFile}
          icon={<FileSpreadsheet className="h-6 w-6" />}
        />

        {/* Instrument upload */}
        <DropZone
          label="Questionnaire / instrument (optional)"
          accept=".pdf,.docx,.doc,.xls,.xlsx"
          required={false}
          file={instrumentFile}
          onFile={setInstrumentFile}
          icon={<FileText className="h-6 w-6" />}
        />

        {/* Accepted formats note */}
        <p className="text-center text-xs text-muted-foreground">
          Dataset: CSV, XLS, XLSX · Questionnaire: PDF, DOCX, XLS · Max 50 MB each
        </p>

        {/* Error */}
        {status === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {statusMsg}
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.push("/dashboard")}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!csvFile || isLoading || !orgId}
            onClick={handleAnalyze}
          >
            {isLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{statusMsg}</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" />Analyze & Start</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
