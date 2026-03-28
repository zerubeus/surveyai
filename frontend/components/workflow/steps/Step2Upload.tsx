"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  FileText,
  X,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  RotateCcw,
  Info,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskProgressBar } from "@/components/tasks/TaskProgressBar";
import { useDispatchTask } from "@/hooks/useDispatchTask";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import type { Tables, PipelineStatus, Json } from "@/lib/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Step2UploadProps {
  project: Tables<"projects">;
  initialDataset: Tables<"datasets"> | null;
  initialInstrument: Tables<"instruments"> | null;
}

interface ParsedPreview {
  headers: string[];
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  format: string;
}

type DatasetPhase =
  | "idle"
  | "uploading"
  | "previewing"
  | "confirmed"
  | "error";

type InstrumentPhase =
  | "idle"
  | "uploading"
  | "parsing"
  | "complete"
  | "error";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DATASET_ACCEPTED_TYPES: Record<string, string> = {
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};
const DATASET_EXTENSIONS = ".csv,.xlsx,.xls";
const INSTRUMENT_EXTENSIONS = ".xlsx,.pdf,.docx";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ENCODINGS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "latin1", label: "Latin-1" },
  { value: "windows-1252", label: "Windows-1252" },
];

const DELIMITERS = [
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe" },
];

const INSTRUMENT_MIME_MAP: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Step2Upload({
  project,
  initialDataset,
  initialInstrument,
}: Step2UploadProps) {
  const router = useRouter();
  const supabase = createBrowserClient();

  /* ---- Dataset state ---- */
  const [datasetPhase, setDatasetPhase] = useState<DatasetPhase>(
    initialDataset && initialDataset.status === "confirmed"
      ? "confirmed"
      : initialDataset
        ? "previewing"
        : "idle",
  );
  const [dataset, setDataset] = useState<Tables<"datasets"> | null>(
    initialDataset,
  );
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [datasetError, setDatasetError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const datasetInputRef = useRef<HTMLInputElement>(null);

  // Encoding / delimiter overrides
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [encoding, setEncoding] = useState("utf-8");
  const [delimiter, setDelimiter] = useState(",");
  const [isReparsing, setIsReparsing] = useState(false);

  /* ---- Instrument state ---- */
  const [instrumentOpen, setInstrumentOpen] = useState(
    !!initialInstrument,
  );
  const [instrumentPhase, setInstrumentPhase] = useState<InstrumentPhase>(
    initialInstrument?.parse_status === "parsed"
      ? "complete"
      : initialInstrument?.parse_status === "parsing"
        ? "parsing"
        : initialInstrument
          ? "idle"
          : "idle",
  );
  const [instrument, setInstrument] = useState<Tables<"instruments"> | null>(
    initialInstrument,
  );
  const [instrumentFile, setInstrumentFile] = useState<File | null>(null);
  const [instrumentError, setInstrumentError] = useState("");
  const [instrumentDragActive, setInstrumentDragActive] = useState(false);
  const [instrumentTaskId, setInstrumentTaskId] = useState<string | null>(
    null,
  );
  const instrumentInputRef = useRef<HTMLInputElement>(null);

  const { dispatchTask } = useDispatchTask();
  const instrumentTask = useTaskProgress(instrumentTaskId);

  /* ---- Navigation state ---- */
  const [isContinuing, setIsContinuing] = useState(false);

  /* ================================================================ */
  /*  Instrument task watcher                                          */
  /* ================================================================ */

  const prevInstrumentStatus = useRef<string | null>(null);
  if (
    instrumentTask.status &&
    instrumentTask.status !== prevInstrumentStatus.current
  ) {
    prevInstrumentStatus.current = instrumentTask.status;
    if (
      instrumentTask.status === "completed" &&
      instrumentPhase !== "complete"
    ) {
      setInstrumentPhase("complete");
      const result = instrumentTask.result as Record<string, Json> | null;
      if (result && instrument) {
        setInstrument({
          ...instrument,
          parse_status: "parsed",
          questions: result.questions ?? instrument.questions,
          skip_logic: result.skip_logic ?? instrument.skip_logic,
        });
      }
    } else if (
      instrumentTask.status === "failed" &&
      instrumentPhase !== "error"
    ) {
      setInstrumentPhase("error");
      setInstrumentError(
        instrumentTask.error ?? "Could not parse form — continuing without it",
      );
    }
  }

  /* ================================================================ */
  /*  Initial preview for already-uploaded datasets                    */
  /* ================================================================ */

  useEffect(() => {
    if (
      initialDataset &&
      datasetPhase === "previewing" &&
      !preview
    ) {
      parseFromStorage(
        initialDataset.original_file_path,
        initialDataset.file_type,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================================================================ */
  /*  Dataset helpers                                                  */
  /* ================================================================ */

  function getDatasetFileType(file: File): string | null {
    const mimeType = DATASET_ACCEPTED_TYPES[file.type];
    if (mimeType) return mimeType;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv" || ext === "xlsx" || ext === "xls") return ext;
    return null;
  }

  function validateDatasetFile(file: File): string | null {
    if (!getDatasetFileType(file)) {
      return "Unsupported file type. Please upload a CSV or Excel file (.csv, .xlsx, .xls).";
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`;
    }
    return null;
  }

  /** Parse a file from Supabase Storage for preview */
  async function parseFromStorage(
    storagePath: string,
    fileType: string,
    enc?: string,
    delim?: string,
  ) {
    const { data: urlData, error: urlError } = await supabase.storage
      .from("uploads")
      .createSignedUrl(storagePath, 300);

    if (urlError || !urlData?.signedUrl) {
      setDatasetError("Could not load file preview.");
      setDatasetPhase("error");
      return;
    }

    try {
      const response = await fetch(urlData.signedUrl);
      if (!response.ok) throw new Error("Failed to download file");

      if (fileType === "csv") {
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder(enc ?? encoding);
        const text = decoder.decode(buffer);
        const result = Papa.parse<string[]>(text, {
          header: false,
          skipEmptyLines: true,
          delimiter: delim ?? delimiter === "," ? undefined : (delim ?? delimiter),
        });
        if (result.data.length > 0) {
          const headers = result.data[0];
          const allRows = result.data.slice(1);
          setPreview({
            headers,
            rows: allRows.slice(0, 5),
            totalRows: allRows.length,
            totalColumns: headers.length,
            format: "CSV",
          });
        } else {
          throw new Error("No data found in file");
        }
      } else {
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("No sheets found");
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, {
          header: 1,
          defval: "",
        });
        if (jsonData.length > 0) {
          const headers = jsonData[0].map(String);
          const allRows = jsonData.slice(1).map((row) => row.map(String));
          setPreview({
            headers,
            rows: allRows.slice(0, 5),
            totalRows: allRows.length,
            totalColumns: headers.length,
            format: fileType.toUpperCase(),
          });
        } else {
          throw new Error("No data found in file");
        }
      }
    } catch (err) {
      setDatasetError(
        err instanceof Error ? err.message : "Failed to parse file.",
      );
      setDatasetPhase("error");
    }
  }

  /** Parse a local File object for preview */
  function parseLocalFile(file: File, fileType: string) {
    if (fileType === "csv") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        const decoder = new TextDecoder(encoding);
        const text = decoder.decode(buffer);
        const result = Papa.parse<string[]>(text, {
          header: false,
          skipEmptyLines: true,
          delimiter: delimiter === "," ? undefined : delimiter,
        });
        if (result.data.length > 0) {
          const headers = result.data[0];
          const allRows = result.data.slice(1);
          setPreview({
            headers,
            rows: allRows.slice(0, 5),
            totalRows: allRows.length,
            totalColumns: headers.length,
            format: "CSV",
          });
          setDatasetPhase("previewing");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return;
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, {
          header: 1,
          defval: "",
        });
        if (jsonData.length > 0) {
          const headers = jsonData[0].map(String);
          const allRows = jsonData.slice(1).map((row) => row.map(String));
          setPreview({
            headers,
            rows: allRows.slice(0, 5),
            totalRows: allRows.length,
            totalColumns: headers.length,
            format: fileType.toUpperCase(),
          });
          setDatasetPhase("previewing");
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  /* ---- Dataset upload ---- */
  const uploadDataset = useCallback(
    async (file: File) => {
      const fileType = getDatasetFileType(file);
      if (!fileType) return;

      setDatasetPhase("uploading");
      setUploadProgress(0);
      setDatasetError("");
      setPreview(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setDatasetPhase("error");
        setDatasetError("You must be logged in to upload files.");
        return;
      }

      const ext = file.name.split(".").pop() ?? "";
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const storagePath = `${user.id}/${project.id}/${baseName}_${Date.now()}.${ext}`;

      try {
        setUploadProgress(30);
        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(storagePath, file);
        setUploadProgress(70);

        if (uploadError) throw new Error(uploadError.message);

        const { data: ds, error: insertError } = await supabase
          .from("datasets")
          .insert({
            project_id: project.id,
            uploaded_by: user.id,
            name: file.name,
            original_file_path: storagePath,
            file_type: fileType,
            file_size_bytes: file.size,
            status: "uploaded",
          })
          .select()
          .single();

        if (insertError || !ds) {
          setDatasetPhase("error");
          setDatasetError(
            insertError?.message ?? "Failed to create dataset record.",
          );
          return;
        }

        setUploadProgress(100);
        setDataset(ds);

        // Parse for preview
        parseLocalFile(file, fileType);
      } catch (err) {
        setDatasetPhase("error");
        setDatasetError(
          err instanceof Error ? err.message : "Upload failed.",
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, supabase, encoding, delimiter],
  );

  const handleDatasetFile = useCallback(
    (file: File) => {
      const error = validateDatasetFile(file);
      if (error) {
        setDatasetError(error);
        setDatasetPhase("error");
        return;
      }
      setDatasetFile(file);
      uploadDataset(file);
    },
    [uploadDataset],
  );

  /* ---- Re-parse with different encoding/delimiter ---- */
  async function handleReparse() {
    if (!dataset) return;
    setIsReparsing(true);
    setPreview(null);

    // Update DB with chosen encoding/delimiter
    await supabase
      .from("datasets")
      .update({ encoding, delimiter })
      .eq("id", dataset.id);

    await parseFromStorage(
      dataset.original_file_path,
      dataset.file_type,
      encoding,
      delimiter,
    );
    setIsReparsing(false);
  }

  /* ---- Dataset confirm ---- */
  async function handleConfirmDataset() {
    if (!dataset || !preview) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase
      .from("datasets")
      .update({
        status: "confirmed" as const,
        confirmed_at: new Date().toISOString(),
        confirmed_by: user?.id ?? null,
        row_count: preview.totalRows,
        column_count: preview.totalColumns,
        encoding,
        delimiter,
      })
      .eq("id", dataset.id);

    setDataset({
      ...dataset,
      status: "confirmed",
      row_count: preview.totalRows,
      column_count: preview.totalColumns,
    });
    setDatasetPhase("confirmed");
  }

  /* ---- Dataset reset ---- */
  function resetDataset() {
    setDatasetPhase("idle");
    setDataset(null);
    setDatasetFile(null);
    setUploadProgress(0);
    setPreview(null);
    setDatasetError("");
    setShowAdvanced(false);
    if (datasetInputRef.current) datasetInputRef.current.value = "";
  }

  /* ---- Drag handlers (dataset) ---- */
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleDatasetFile(file);
    },
    [handleDatasetFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleDatasetFile(file);
    },
    [handleDatasetFile],
  );

  /* ================================================================ */
  /*  Instrument helpers                                               */
  /* ================================================================ */

  function getInstrumentExt(file: File): string | null {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "pdf" || ext === "docx") return ext;
    return null;
  }

  const uploadInstrument = useCallback(
    async (file: File) => {
      const ext = getInstrumentExt(file);
      if (!ext) return;

      setInstrumentPhase("uploading");
      setInstrumentError("");
      setInstrumentTaskId(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setInstrumentPhase("error");
        setInstrumentError("You must be logged in to upload files.");
        return;
      }

      const mimeType = INSTRUMENT_MIME_MAP[ext];
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const storagePath = `${user.id}/${project.id}/instrument/${baseName}_${Date.now()}.${ext}`;

      try {
        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(storagePath, file, { contentType: mimeType });

        if (uploadError) throw new Error(uploadError.message);

        const { data: inst, error: insertError } = await supabase
          .from("instruments")
          .insert({
            project_id: project.id,
            uploaded_by: user.id,
            name: file.name,
            file_path: storagePath,
            file_type: ext,
            parse_status: "pending",
          })
          .select()
          .single();

        if (insertError || !inst) {
          setInstrumentPhase("error");
          setInstrumentError(
            insertError?.message ?? "Failed to create instrument record.",
          );
          return;
        }

        setInstrument(inst);
        setInstrumentPhase("parsing");

        const { taskId } = await dispatchTask(
          project.id,
          "parse_instrument",
          {
            instrument_id: inst.id,
            storage_path: storagePath,
            mime_type: mimeType,
          },
        );
        setInstrumentTaskId(taskId);
      } catch (err) {
        setInstrumentPhase("error");
        setInstrumentError(
          err instanceof Error ? err.message : "Upload failed.",
        );
      }
    },
    [project.id, supabase, dispatchTask],
  );

  const handleInstrumentFile = useCallback(
    (file: File) => {
      const ext = getInstrumentExt(file);
      if (!ext) {
        setInstrumentError(
          "Unsupported file type. Please upload .xlsx, .pdf, or .docx.",
        );
        setInstrumentPhase("error");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setInstrumentError("File too large. Maximum size is 50MB.");
        setInstrumentPhase("error");
        return;
      }
      setInstrumentFile(file);
      uploadInstrument(file);
    },
    [uploadInstrument],
  );

  const handleInstrumentDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover")
      setInstrumentDragActive(true);
    else if (e.type === "dragleave") setInstrumentDragActive(false);
  }, []);

  const handleInstrumentDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setInstrumentDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleInstrumentFile(file);
    },
    [handleInstrumentFile],
  );

  const handleInstrumentChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleInstrumentFile(file);
    },
    [handleInstrumentFile],
  );

  function resetInstrument() {
    setInstrumentPhase("idle");
    setInstrument(null);
    setInstrumentFile(null);
    setInstrumentError("");
    setInstrumentTaskId(null);
    prevInstrumentStatus.current = null;
    if (instrumentInputRef.current) instrumentInputRef.current.value = "";
  }

  /* ================================================================ */
  /*  Continue handler                                                 */
  /* ================================================================ */

  async function handleContinue() {
    if (!dataset) return;
    setIsContinuing(true);

    const pipelineStatus: PipelineStatus = {
      ...((project.pipeline_status as PipelineStatus) ?? {}),
      "2": "completed",
      "3": "active",
    };

    await supabase
      .from("projects")
      .update({
        current_step: 3,
        pipeline_status: pipelineStatus as unknown as Json,
      })
      .eq("id", project.id);

    router.push(`/projects/${project.id}/step/3`);
  }

  /* ================================================================ */
  /*  Computed                                                         */
  /* ================================================================ */

  const instrumentQuestionCount =
    instrument?.questions && Array.isArray(instrument.questions)
      ? (instrument.questions as unknown[]).length
      : 0;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Upload Data</h2>
        <p className="text-muted-foreground">
          Upload your survey dataset and optionally the questionnaire instrument.
        </p>
      </div>

      {/* ============================================================ */}
      {/*  DATASET SECTION                                              */}
      {/* ============================================================ */}

      <Card>
        <CardContent className="p-6">
          {/* ----- Idle: drop zone ----- */}
          {datasetPhase === "idle" && (
            <div
              className={`relative flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
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
                Drop your dataset here
              </p>
              <p className="mb-4 text-sm text-muted-foreground">
                CSV, Excel (.xlsx, .xls)
              </p>
              <Button
                variant="outline"
                onClick={() => datasetInputRef.current?.click()}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Browse files
              </Button>
              <input
                ref={datasetInputRef}
                type="file"
                accept={DATASET_EXTENSIONS}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}

          {/* ----- Uploading ----- */}
          {datasetPhase === "uploading" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                <div className="flex-1">
                  <p className="font-medium">
                    {datasetFile?.name ?? "Uploading..."}
                  </p>
                  {datasetFile && (
                    <p className="text-sm text-muted-foreground">
                      {(datasetFile.size / 1024).toFixed(1)} KB
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} />
              </div>
            </div>
          )}

          {/* ----- Previewing: table + confirm ----- */}
          {datasetPhase === "previewing" && preview && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">
                  {preview.totalRows.toLocaleString("en-US")} rows{" "}
                  &times; {preview.totalColumns} columns,{" "}
                  {preview.format} detected
                </span>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {preview.headers.map((header, i) => (
                        <th
                          key={i}
                          className="whitespace-nowrap px-4 py-2 text-left font-medium"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className="max-w-[200px] truncate whitespace-nowrap px-4 py-2"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.totalRows > 5 && (
                <p className="text-center text-xs text-muted-foreground">
                  Showing first 5 of{" "}
                  {preview.totalRows.toLocaleString("en-US")} rows
                </p>
              )}

              {/* Confirm / Advanced */}
              <div className="flex items-center gap-3">
                <Button onClick={handleConfirmDataset}>
                  This looks right — continue
                </Button>
                <Button
                  variant="link"
                  className="text-muted-foreground"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  Something&apos;s wrong
                  {showAdvanced ? (
                    <ChevronDown className="ml-1 h-4 w-4" />
                  ) : (
                    <ChevronRight className="ml-1 h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Advanced options */}
              {showAdvanced && (
                <div className="space-y-3 rounded-lg border border-dashed p-4">
                  <p className="text-sm font-medium">Parse options</p>
                  <div className="flex flex-wrap gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        Encoding
                      </label>
                      <Select value={encoding} onValueChange={setEncoding}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ENCODINGS.map((e) => (
                            <SelectItem key={e.value} value={e.value}>
                              {e.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        Delimiter
                      </label>
                      <Select value={delimiter} onValueChange={setDelimiter}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DELIMITERS.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReparse}
                        disabled={isReparsing}
                      >
                        <RotateCcw className="mr-2 h-3 w-3" />
                        {isReparsing ? "Re-parsing..." : "Re-parse"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload different file */}
              <Button
                variant="ghost"
                size="sm"
                onClick={resetDataset}
                className="text-muted-foreground"
              >
                <X className="mr-1 h-3 w-3" />
                Upload different file
              </Button>
            </div>
          )}

          {/* ----- Confirmed ----- */}
          {datasetPhase === "confirmed" && dataset && (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div className="flex-1">
                <p className="font-medium text-green-600">
                  {dataset.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {dataset.row_count?.toLocaleString("en-US") ?? "?"} rows
                  &times; {dataset.column_count ?? "?"} columns
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetDataset}
                className="text-muted-foreground"
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Replace
              </Button>
            </div>
          )}

          {/* ----- Error ----- */}
          {datasetPhase === "error" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="h-8 w-8" />
                <div>
                  <p className="font-medium">Upload failed</p>
                  <p className="text-sm">{datasetError}</p>
                </div>
              </div>
              <Button variant="outline" onClick={resetDataset}>
                <X className="mr-2 h-4 w-4" />
                Try again
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/*  INSTRUMENT SECTION (collapsible)                             */}
      {/* ============================================================ */}

      <Card>
        <CardContent className="p-0">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
            onClick={() => setInstrumentOpen(!instrumentOpen)}
          >
            {instrumentOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div className="flex-1">
              <p className="font-medium">
                Have the questionnaire? Upload for better results
              </p>
              <p className="text-xs text-muted-foreground">Optional</p>
            </div>
            {instrumentPhase === "complete" && (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                Parsed
              </Badge>
            )}
          </button>

          {instrumentOpen && (
            <div className="border-t px-6 pb-6 pt-4">
              {/* Idle: small drop zone */}
              {instrumentPhase === "idle" && (
                <div
                  className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                    instrumentDragActive
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-primary/50"
                  }`}
                  onDragEnter={handleInstrumentDrag}
                  onDragOver={handleInstrumentDrag}
                  onDragLeave={handleInstrumentDrag}
                  onDrop={handleInstrumentDrop}
                >
                  <FileText className="mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="mb-1 text-sm font-medium">
                    Drop your instrument file here
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    XLSForm (.xlsx), PDF, or Word (.docx)
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => instrumentInputRef.current?.click()}
                  >
                    Browse
                  </Button>
                  <input
                    ref={instrumentInputRef}
                    type="file"
                    accept={INSTRUMENT_EXTENSIONS}
                    onChange={handleInstrumentChange}
                    className="hidden"
                  />
                </div>
              )}

              {/* Uploading */}
              {instrumentPhase === "uploading" && (
                <div className="flex items-center gap-3 py-4">
                  <FileText className="h-6 w-6 text-primary animate-pulse" />
                  <p className="text-sm">
                    Uploading {instrumentFile?.name}...
                  </p>
                </div>
              )}

              {/* Parsing */}
              {instrumentPhase === "parsing" && instrumentTaskId && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 text-primary" />
                    <p className="text-sm font-medium">
                      {instrumentFile?.name ?? instrument?.name}
                    </p>
                  </div>
                  <TaskProgressBar taskId={instrumentTaskId} />
                </div>
              )}

              {/* Complete */}
              {instrumentPhase === "complete" && instrument && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-green-700">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">
                      Form structure detected —{" "}
                      {instrumentQuestionCount} question
                      {instrumentQuestionCount !== 1 ? "s" : ""}
                      {instrument.skip_logic &&
                      Array.isArray(instrument.skip_logic) &&
                      (instrument.skip_logic as unknown[]).length > 0
                        ? ", skip logic applied automatically"
                        : ""}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetInstrument}
                    className="text-muted-foreground"
                  >
                    Upload different instrument
                  </Button>
                </div>
              )}

              {/* Error */}
              {instrumentPhase === "error" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg bg-yellow-50 px-4 py-3 text-yellow-700">
                    <Info className="h-5 w-5" />
                    <span className="text-sm">
                      {instrumentError ||
                        "Could not parse form — continuing without it"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetInstrument}
                    className="text-muted-foreground"
                  >
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/*  CONFIRMATION / CONTINUE                                      */}
      {/* ============================================================ */}

      {datasetPhase === "confirmed" && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="font-medium">{dataset?.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {dataset?.row_count?.toLocaleString("en-US") ?? "?"} rows
                  &times; {dataset?.column_count ?? "?"} cols
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {instrumentPhase === "complete" ? (
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                    Instrument parsed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    No instrument
                  </Badge>
                )}
              </div>
            </div>
            <Button onClick={handleContinue} disabled={isContinuing}>
              {isContinuing ? (
                "Saving..."
              ) : (
                <>
                  Continue to Column Roles
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
