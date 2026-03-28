"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Tables } from "@/lib/types/database";

const ACCEPTED_TYPES: Record<string, string> = {
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};
const ACCEPTED_EXTENSIONS = ".csv,.xlsx,.xls";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

type UploadState = "idle" | "uploading" | "success" | "error";

interface DatasetUploaderProps {
  projectId: string;
  onUploadComplete: (dataset: Tables<"datasets">) => void;
}

export function DatasetUploader({ projectId, onUploadComplete }: DatasetUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const getFileType = (file: File): string | null => {
    const mimeType = ACCEPTED_TYPES[file.type];
    if (mimeType) return mimeType;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv" || ext === "xlsx" || ext === "xls") return ext;
    return null;
  };

  const validateFile = (file: File): string | null => {
    const fileType = getFileType(file);
    if (!fileType) {
      return "Unsupported file type. Please upload a CSV or Excel file (.csv, .xlsx, .xls).";
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`;
    }
    return null;
  };

  const uploadFile = useCallback(async (file: File) => {
    const fileType = getFileType(file);
    if (!fileType) return;

    setUploadState("uploading");
    setProgress(0);
    setErrorMessage("");

    const supabase = createBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUploadState("error");
      setErrorMessage("You must be logged in to upload files.");
      return;
    }

    const ext = file.name.split(".").pop() ?? "";
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const storagePath = `${user.id}/${projectId}/${baseName}_${Date.now()}.${ext}`;

    try {
      // Use Supabase SDK upload — SDK handles all auth headers correctly
      setProgress(30);
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(storagePath, file);
      setProgress(70);

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // Create dataset record
      const { data: dataset, error: insertError } = await supabase
        .from("datasets")
        // @ts-expect-error — supabase insert type inference
        .insert({
          project_id: projectId,
          uploaded_by: user.id,
          name: file.name,
          original_file_path: storagePath,
          file_type: fileType,
          file_size_bytes: file.size,
          status: "uploaded",
        })
        .select()
        .single();

      if (insertError || !dataset) {
        setUploadState("error");
        setErrorMessage(insertError?.message ?? "Failed to create dataset record.");
        return;
      }

      setUploadState("success");
      onUploadComplete(dataset);
    } catch (err) {
      setUploadState("error");
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
    }
  }, [projectId, onUploadComplete]);

  const handleFile = useCallback((file: File) => {
    const error = validateFile(file);
    if (error) {
      setErrorMessage(error);
      setUploadState("error");
      return;
    }
    setSelectedFile(file);
    uploadFile(file);
  }, [uploadFile]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const reset = useCallback(() => {
    setUploadState("idle");
    setProgress(0);
    setErrorMessage("");
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <Card>
      <CardContent className="p-6">
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
              Drag & drop your data file here
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Supports CSV, Excel (.xlsx, .xls) — up to 50MB
            </p>
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
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
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {uploadState === "success" && selectedFile && (
          <div className="flex items-center gap-3 text-green-600">
            <CheckCircle2 className="h-8 w-8" />
            <div>
              <p className="font-medium">Upload complete</p>
              <p className="text-sm text-muted-foreground">{selectedFile.name}</p>
            </div>
          </div>
        )}

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
