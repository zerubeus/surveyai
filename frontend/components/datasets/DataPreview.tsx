"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Table2 } from "lucide-react";

interface ParsedData {
  headers: string[];
  rows: string[][];
  totalRows: number;
  totalColumns: number;
}

interface DataPreviewProps {
  datasetId: string;
  storagePath: string;
  fileType: string;
}

export function DataPreview({ datasetId, storagePath, fileType }: DataPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ParsedData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAndParse() {
      setLoading(true);
      setError(null);

      const supabase = createBrowserClient();

      const { data: signedUrlData, error: urlError } = await supabase.storage
        .from("uploads")
        .createSignedUrl(storagePath, 300);

      if (urlError || !signedUrlData?.signedUrl) {
        if (!cancelled) {
          setError("Could not load file preview.");
          setLoading(false);
        }
        return;
      }

      try {
        const response = await fetch(signedUrlData.signedUrl);
        if (!response.ok) throw new Error("Failed to download file");

        if (fileType === "csv") {
          const text = await response.text();
          const result = Papa.parse<string[]>(text, {
            header: false,
            skipEmptyLines: true,
          });
          if (!cancelled && result.data.length > 0) {
            const headers = result.data[0];
            const allRows = result.data.slice(1);
            setData({
              headers,
              rows: allRows.slice(0, 5),
              totalRows: allRows.length,
              totalColumns: headers.length,
            });
          } else if (!cancelled) {
            setError("No data found");
          }
        } else {
          // Excel files (xlsx, xls)
          const buffer = await response.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) {
            if (!cancelled) setError("No data found");
            setLoading(false);
            return;
          }
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            defval: "",
          });

          if (!cancelled && jsonData.length > 0) {
            const headers = jsonData[0].map(String);
            const allRows = jsonData.slice(1).map((row) => row.map(String));
            setData({
              headers,
              rows: allRows.slice(0, 5),
              totalRows: allRows.length,
              totalColumns: headers.length,
            });
          } else if (!cancelled) {
            setError("No data found");
          }
        }

        // Update dataset with preview metadata
        if (!cancelled && data === null) {
          // We'll update after state is set
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to parse file.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAndParse();
    return () => { cancelled = true; };
  }, [datasetId, storagePath, fileType]);

  // Update dataset row/column counts when data is parsed
  useEffect(() => {
    if (!data) return;
    const supabase = createBrowserClient();
    supabase
      .from("datasets")
      .update({
        row_count: data.totalRows,
        column_count: data.totalColumns,
        status: "previewed" as const,
      })
      .eq("id", datasetId)
      .then(); // fire-and-forget update
  }, [data, datasetId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Table2 className="h-5 w-5" />
            Data Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex gap-4">
              <div className="h-5 w-24 animate-pulse rounded bg-muted" />
              <div className="h-5 w-24 animate-pulse rounded bg-muted" />
            </div>
            <div className="overflow-hidden rounded-md border">
              <div className="space-y-0">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={`flex gap-px ${i === 0 ? "bg-muted" : ""}`}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div
                        key={j}
                        className="h-10 flex-1 animate-pulse bg-muted/50"
                        style={{ animationDelay: `${(i * 4 + j) * 50}ms` }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Table2 className="h-5 w-5" />
          Data Preview
        </CardTitle>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{data.totalRows.toLocaleString()} rows</span>
          <span>{data.totalColumns} columns</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {data.headers.map((header, i) => (
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
              {data.rows.map((row, i) => (
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
        {data.totalRows > 5 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Showing first 5 of {data.totalRows.toLocaleString()} rows
          </p>
        )}
      </CardContent>
    </Card>
  );
}
