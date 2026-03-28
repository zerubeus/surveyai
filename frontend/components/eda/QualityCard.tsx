"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
} from "lucide-react";
import type { Json } from "@/lib/types/database";

interface QualityCardProps {
  columnName: string;
  role: string | null;
  dataType: string | null;
  qualityScore: number | null;
  profile: Record<string, Json> | null;
  issues: Array<{
    type?: string;
    severity?: string;
    description?: string;
    details?: Record<string, Json>;
  }>;
  inline?: boolean; // when true, renders without outer Card wrapper (for accordion use)
}

const ROLE_COLORS: Record<string, string> = {
  identifier: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  weight: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  cluster_id: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  stratum: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  demographic: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  outcome: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  covariate: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  skip_logic: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  metadata: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  open_text: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  ignore: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function getScoreRingColor(score: number): string {
  if (score >= 80) return "stroke-green-500";
  if (score >= 60) return "stroke-yellow-500";
  return "stroke-red-500";
}

function QualityRing({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative h-12 w-12 flex-shrink-0">
      <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-gray-200 dark:text-gray-700"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={getScoreRingColor(score)}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${getScoreColor(score)}`}
      >
        {Math.round(score)}
      </span>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical")
    return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (severity === "warning")
    return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
}

export function QualityCard({
  columnName,
  role,
  dataType,
  qualityScore,
  profile,
  issues,
  inline = false,
}: QualityCardProps) {
  const [expanded, setExpanded] = useState(inline); // auto-expand when inline (inside accordion)
  const score = qualityScore ?? 0;
  const issueCount = issues.length;

  const content = (
    <div className={inline ? "" : "p-4"}>
        {/* Header row */}
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}

          <QualityRing score={score} />

          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-medium">
              {columnName}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {role && (
                <Badge
                  className={`text-[10px] ${ROLE_COLORS[role] ?? ROLE_COLORS.ignore}`}
                >
                  {role}
                </Badge>
              )}
              {dataType && (
                <Badge variant="outline" className="text-[10px]">
                  {dataType}
                </Badge>
              )}
            </div>
          </div>

          {issueCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              {issueCount}
            </div>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 space-y-3 border-t pt-3">
            {/* Stats grid */}
            {profile && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                {Object.entries(profile)
                  .filter(
                    ([key]) =>
                      ![
                        "total_count",
                        "frequency_table",
                        "frequency_table_top10",
                        "sample_values",
                      ].includes(key),
                  )
                  .map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {key.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono font-medium">
                        {typeof value === "object"
                          ? JSON.stringify(value).slice(0, 40)
                          : String(value)}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            {/* Frequency table for categorical/likert */}
            {profile &&
              (profile.frequency_table || profile.frequency_table_top10) && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Value frequencies
                  </p>
                  <div className="space-y-1">
                    {Object.entries(
                      (profile.frequency_table ??
                        profile.frequency_table_top10 ??
                        {}) as Record<
                        string,
                        { count: number; pct: number }
                      >,
                    )
                      .slice(0, 10)
                      .map(([value, info]) => (
                        <div
                          key={value}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="w-24 truncate font-mono">
                            {value}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary/60"
                              style={{ width: `${info.pct}%` }}
                            />
                          </div>
                          <span className="w-16 text-right text-muted-foreground">
                            {info.count} ({info.pct}%)
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

            {/* Issues */}
            {issues.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Issues
                </p>
                <div className="space-y-1.5">
                  {issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <SeverityIcon severity={issue.severity ?? "info"} />
                      <span>{issue.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
  );

  if (inline) return content;

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="p-4">
        {content}
      </CardContent>
    </Card>
  );
}
