"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  X,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Languages,
  GitBranch,
  HelpCircle,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskProgressBar } from "@/components/tasks/TaskProgressBar";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import type { Json } from "@/lib/types/database";

const ACCEPTED_TYPES: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  // Some browsers/OS report .docx with these legacy MIME types
  "application/msword": "docx",
  "application/vnd.ms-word": "docx",
  "application/x-msword": "docx",
};
const ACCEPTED_EXTENSIONS = ".xlsx,.pdf,.docx";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

type UploadState = "idle" | "uploading" | "parsing" | "complete" | "error";

interface ParseResult {
  question_count: number;
  total_items: number;
  skip_logic_count: number;
  has_skip_logic: boolean;
  languages: string[];
  title: string;
  message: string;
}

interface InstrumentUploaderProps {
  projectId: string;
}

export function InstrumentUploader({ projectId }: InstrumentUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const { dispatchTask } = useDispatchTask();
  const taskProgress = useTaskProgress(taskId);

  // When task completes or fails, update our local state
  const prevStatusRef = useRef<string | null>(null);
  if (taskProgress.status && taskProgress.status !== prevStatusRef.current) {
    prevStatusRef.current = taskProgress.status;
    if (taskProgress.status === "completed" && taskProgress.result) {
      const result = taskProgress.result as Record<string, Json>;
      if (uploadState !== "complete") {
        setUploadState("complete");
        setParseResult({
          question_count: Number(result.question_count ?? 0),
          total_items: Number(result.total_items ?? 0),
          skip_logic_count: Number(result.skip_logic_count ?? 0),
          has_skip_logic: Boolean(result.has_skip_logic),
          languages: Array.isArray(result.languages)
            ? (result.languages as string[])
            : [],
          title: String(result.title ?? ""),
          message: String(result.message ?? ""),
        });
        // Refresh server component to re-fetch parsed instrument from DB
        router.refresh();
      }
    } else if (taskProgress.status === "failed" && uploadState !== "error") {
      setUploadState("error");
      setErrorMessage(taskProgress.error ?? "Parsing failed");
    }
  }

  // Always return the canonical MIME type accepted by Supabase Storage.
  // File extension is the source of truth — browser-reported file.type can be wrong.
  const getMimeType = (file: File): string | null => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (ext === "pdf") return "application/pdf";
    if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    // Fallback: try browser-reported type if it's in our accepted list
    if (ACCEPTED_TYPES[file.type]) return file.type;
    return null;
  };

  const validateFile = (file: File): string | null => {
    const mime = getMimeType(file);
    if (!mime) {
      return "Unsupported file type. Please upload an XLSForm (.xlsx), PDF, or Word (.docx) file.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`;
    }
    return null;
  };

  const uploadFile = useCallback(
    async (file: File) => {
      const mimeType = getMimeType(file);
      if (!mimeType) return;

      setUploadState("uploading");
      setUploadProgress(0);
      setErrorMessage("");
      setParseResult(null);
      setTaskId(null);
      prevStatusRef.current = null;

      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setUploadState("error");
        setErrorMessage("You must be logged in to upload files.");
        return;
      }

      const ext = file.name.split(".").pop() ?? "";
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const storagePath = `${user.id}/${projectId}/instrument/${baseName}_${Date.now()}.${ext}`;

      try {
        // Use Supabase SDK upload — SDK handles all auth headers correctly
        setUploadProgress(30); // show progress while uploading
        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(storagePath, file, {
            contentType: mimeType,
          });
        setUploadProgress(70);

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        // Create instrument record
        const fileType = ACCEPTED_TYPES[mimeType] ?? "unknown";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sbI = supabase as any;
        const { data: instrumentRaw, error: insertError } = await sbI
          .from("instruments")
          .insert({
            project_id: projectId,
            uploaded_by: user.id,
            name: file.name,
            file_path: storagePath,
            file_type: fileType,
            parse_status: "pending",
          })
          .select()
          .single();
        const instrument = instrumentRaw as { id: string } | null;

        if (insertError || !instrument) {
          setUploadState("error");
          setErrorMessage(
            insertError?.message ?? "Failed to create instrument record.",
          );
          return;
        }

        // Dispatch parse_instrument task
        setUploadState("parsing");
        const { taskId: newTaskId } = await dispatchTask(
          projectId,
          "parse_instrument",
          {
            instrument_id: instrument.id,
            storage_path: storagePath,
            mime_type: mimeType,
          },
        );
        setTaskId(newTaskId);
      } catch (err) {
        setUploadState("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Upload failed.",
        );
      }
    },
    [projectId, dispatchTask],
  );

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file);
      if (error) {
        setErrorMessage(error);
        setUploadState("error");
        return;
      }
      setSelectedFile(file);
      uploadFile(file);
    },
    [uploadFile],
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const reset = useCallback(() => {
    setUploadState("idle");
    setUploadProgress(0);
    setErrorMessage("");
    setSelectedFile(null);
    setTaskId(null);
    setParseResult(null);
    prevStatusRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <Card>
      <CardContent className="p-6">
        {/* Idle: show drop zone */}
        {uploadState === "idle" && (
          <div
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="mb-2 text-lg font-medium">
              Upload your survey instrument
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              XLSForm (.xlsx), PDF, or Word (.docx) — up to 50MB
            </p>
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
            >
              <FileText className="mr-2 h-4 w-4" />
              Browse files
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleChange}
              className="hidden"
            />
          </div>
        )}

        {/* Uploading: progress bar */}
        {uploadState === "uploading" && selectedFile && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-8 w-8 text-primary" />
              <div className="flex-1">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Parsing: task progress bar */}
        {uploadState === "parsing" && taskId && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-8 w-8 text-primary" />
              <div className="flex-1">
                <p className="font-medium">{selectedFile?.name}</p>
                <p className="text-sm text-muted-foreground">
                  Parsing instrument structure...
                </p>
              </div>
            </div>
            <TaskProgressBar taskId={taskId} />
          </div>
        )}

        {/* Complete: show summary */}
        {uploadState === "complete" && parseResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-green-600">
              <CheckCircle2 className="h-8 w-8" />
              <div>
                <p className="font-medium">
                  {parseResult.title || selectedFile?.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  Instrument parsed successfully
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">
                    {parseResult.question_count}
                  </p>
                  <p className="text-xs text-muted-foreground">Questions</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">
                    {parseResult.skip_logic_count}
                  </p>
                  <p className="text-xs text-muted-foreground">Skip logic</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">
                    {parseResult.languages.length || 1}
                  </p>
                  <p className="text-xs text-muted-foreground">Languages</p>
                </div>
              </div>
            </div>

            {parseResult.languages.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {parseResult.languages.map((lang) => (
                  <Badge key={lang} variant="secondary">
                    {lang}
                  </Badge>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" onClick={reset}>
              Upload different instrument
            </Button>
          </div>
        )}

        {/* Error */}
        {uploadState === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-8 w-8" />
              <div>
                <p className="font-medium">Upload failed</p>
                <p className="text-sm">{errorMessage}</p>
              </div>
            </div>
            <Button variant="outline" onClick={reset}>
              <X className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
