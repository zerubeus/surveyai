"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { Button } from "@/components/ui/button";
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { Json } from "@/lib/types/database";

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
  disabled,
}: {
  label: string;
  accept: string;
  required: boolean;
  file: File | null;
  onFile: (f: File | null) => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile, disabled]
  );

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed p-6 text-center transition-all ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${
        dragging
          ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
          : file
          ? "border-green-400 bg-green-50 dark:bg-green-950/20"
          : "border-muted-foreground/25 bg-muted/20 hover:border-muted-foreground/50 hover:bg-muted/30"
      }`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
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
          {!disabled && (
            <button
              type="button"
              className="flex-shrink-0 rounded-full p-1 hover:bg-green-100 dark:hover:bg-green-900"
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
            >
              <X className="h-4 w-4 text-green-600" />
            </button>
          )}
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

type Status = "idle" | "uploading" | "analyzing" | "error";

export default function NewProjectPage() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [instrumentFile, setInstrumentFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Task tracking — once project is created and task dispatched, we poll progress
  const [analyzeTaskId, setAnalyzeTaskId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const taskProgress = useTaskProgress(analyzeTaskId);

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
      }
    });
  }, [router]);

  // Watch task progress — redirect to step/1 when AI task completes
  useEffect(() => {
    if (!projectId || !analyzeTaskId) return;

    if (taskProgress.status === "completed") {
      router.push(`/projects/${projectId}/step/1`);
      router.refresh();
    } else if (taskProgress.status === "failed") {
      // Task failed — still navigate, Step 1 will just show empty form
      router.push(`/projects/${projectId}/step/1`);
      router.refresh();
    }
  }, [taskProgress.status, projectId, analyzeTaskId, router]);

  const handleSubmit = useCallback(async () => {
    if (!csvFile || !orgId || !userId) return;

    setStatus("uploading");
    setStatusMsg("Uploading dataset…");

    try {
      const supabase = createBrowserClient();

      // 1. Upload CSV to Supabase Storage
      const ext = csvFile.name.split(".").pop() ?? "csv";
      const baseName = csvFile.name.replace(/\.[^/.]+$/, "");
      const timestamp = Date.now();
      const storagePath = `${userId}/tmp/${baseName}_${timestamp}.${ext}`;
      const fileTypeMap: Record<string, string> = { csv: "csv", xls: "xls", xlsx: "xlsx" };
      const fileType = fileTypeMap[ext.toLowerCase()] ?? "csv";

      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(storagePath, csvFile);

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // 2. Create project (step 2 auto-completed — upload done at creation)
      setStatusMsg("Creating project…");
      const projectName = csvFile.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

      const { data: projectRaw, error: projectError } = await (supabase as unknown as {
        from: (t: string) => {
          insert: (d: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: unknown }> } }
        }
      })
        .from("projects")
        .insert({
          organization_id: orgId,
          created_by: userId,
          name: projectName,
          status: "draft",
          current_step: 1,
          pipeline_status: {
            "1": "active",
            "2": "completed",
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

      if (projectError || !projectRaw) {
        throw new Error((projectError as { message: string })?.message ?? "Failed to create project");
      }

      const pid = (projectRaw as { id: string }).id;
      setProjectId(pid);

      // 3. Move storage file to project folder + create dataset record
      const finalStoragePath = `${userId}/${pid}/${baseName}_${timestamp}.${ext}`;
      await supabase.storage.from("uploads").move(storagePath, finalStoragePath);

      const { data: dsRaw } = await (supabase as unknown as {
        from: (t: string) => { insert: (d: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown }> } } }
      })
        .from("datasets")
        .insert({
          project_id: pid,
          uploaded_by: userId,
          name: csvFile.name,
          original_file_path: finalStoragePath,
          file_type: fileType,
          file_size_bytes: csvFile.size,
          status: "uploaded",
        })
        .select("id")
        .single();

      const datasetId = (dsRaw as { id: string } | null)?.id ?? null;

      // 4. Dispatch analyze_uploads worker task
      setStatus("analyzing");
      setStatusMsg("AI is reading your data…");

      const { data: taskRaw } = await (supabase as unknown as {
        from: (t: string) => {
          insert: (d: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown }> } }
        }
      })
        .from("tasks")
        .insert({
          project_id: pid,
          task_type: "analyze_uploads",
          payload: {
            project_id: pid,
            dataset_id: datasetId,
          },
          created_by: userId,
        } as unknown as Json)
        .select("id")
        .single();

      const taskId = (taskRaw as { id: string } | null)?.id ?? null;
      if (taskId) {
        setAnalyzeTaskId(taskId);
        // useEffect above will redirect when task completes
      } else {
        // Couldn't dispatch task — go to step 1 immediately (empty form)
        router.push(`/projects/${pid}/step/1`);
      }

    } catch (err) {
      setStatus("error");
      setStatusMsg(String(err));
    }
  }, [csvFile, instrumentFile, orgId, userId, router]);

  const isLoading = status === "uploading" || status === "analyzing";
  const progressMsg = isLoading
    ? (taskProgress.progressMessage ?? statusMsg)
    : "";

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
          disabled={isLoading}
        />

        {/* Instrument upload */}
        <DropZone
          label="Questionnaire / instrument (optional)"
          accept=".pdf,.docx,.doc,.xls,.xlsx"
          required={false}
          file={instrumentFile}
          onFile={setInstrumentFile}
          icon={<FileText className="h-6 w-6" />}
          disabled={isLoading}
        />

        <p className="text-center text-xs text-muted-foreground">
          Dataset: CSV, XLS, XLSX · Questionnaire: PDF, DOCX, XLS · Max 50 MB each
        </p>

        {/* Error */}
        {status === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {statusMsg}
          </div>
        )}

        {/* Loading / progress */}
        {isLoading && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
            <span>{progressMsg}</span>
          </div>
        )}

        {/* Actions */}
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
            onClick={handleSubmit}
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
