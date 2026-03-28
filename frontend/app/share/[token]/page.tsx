import { notFound } from "next/navigation";
import { Lock, Sparkles } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface ShareSection {
  section_key: string;
  title: string;
  content: string | null;
  sort_order: number;
  confidence: string | null;
}

interface ShareMeta {
  share_id: string;
  report_id: string;
  report_name: string;
  report_template: string;
  project_name: string;
  expires_at: string | null;
  is_active: boolean;
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const map: Record<string, { label: string; cls: string }> = {
    high: { label: "AI-drafted", cls: "bg-green-100 text-green-700" },
    medium: { label: "Needs review", cls: "bg-yellow-100 text-yellow-700" },
    low: { label: "Expert input needed", cls: "bg-red-100 text-red-700" },
  };
  const info = map[confidence];
  if (!info) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${info.cls}`}>
      {info.label}
    </span>
  );
}

function formatContent(content: string | null): React.ReactNode {
  if (!content) return <p className="text-gray-400 italic">No content yet.</p>;
  // Simple markdown: split by line and render headings + paragraphs
  return content.split("\n").map((line, i) => {
    if (line.startsWith("## ")) return <h2 key={i} className="mb-2 mt-5 text-lg font-bold text-gray-900">{line.slice(3)}</h2>;
    if (line.startsWith("### ")) return <h3 key={i} className="mb-1.5 mt-4 text-base font-semibold text-gray-800">{line.slice(4)}</h3>;
    if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-semibold text-gray-800">{line.slice(2, -2)}</p>;
    if (line.startsWith("- ")) return <li key={i} className="ml-4 text-gray-700">{line.slice(2)}</li>;
    if (line.trim() === "") return <div key={i} className="my-2" />;
    return <p key={i} className="text-gray-700 leading-relaxed">{line}</p>;
  });
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createServerClient();

  // Resolve token (SECURITY DEFINER function, no RLS bypass needed)
  const { data: metaRaw } = await supabase.rpc("resolve_share_token" as never, { p_token: token } as never);
  const meta = (metaRaw as ShareMeta[] | null)?.[0];

  if (!meta || !meta.is_active) {
    notFound();
  }

  // Load sections
  const { data: sectionsRaw } = await supabase.rpc("get_shared_report_sections" as never, { p_token: token } as never);
  const sections = (sectionsRaw as ShareSection[] | null) ?? [];

  const isExpired = meta.expires_at && new Date(meta.expires_at) < new Date();
  if (isExpired) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/landing" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-bold text-sm">SurveyAI Analyst</span>
          </Link>
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-500">Read-only shared report</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Report header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-gray-500 mb-1">{meta.project_name}</p>
              <h1 className="text-2xl font-bold text-gray-900">{meta.report_name}</h1>
            </div>
            <Badge className="capitalize bg-blue-50 text-blue-700 hover:bg-blue-50 flex-shrink-0">
              {meta.report_template} report
            </Badge>
          </div>
          {meta.expires_at && (
            <p className="mt-2 text-xs text-gray-400">
              This link expires {new Date(meta.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
        </div>

        {/* Sections */}
        {sections.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              <p>No report sections available yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
              <Card key={section.section_key} className="border-gray-100">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{section.title}</CardTitle>
                    <ConfidenceBadge confidence={section.confidence} />
                  </div>
                </CardHeader>
                <CardContent className="prose prose-sm max-w-none text-sm">
                  <div className="space-y-1">
                    {formatContent(section.content)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 border-t pt-6 text-center text-xs text-gray-400">
          <p>
            Generated by <Link href="/landing" className="text-blue-600 hover:underline">SurveyAI Analyst</Link>
            {" · "}
            <Link href="/privacy" className="hover:underline">Privacy policy</Link>
          </p>
          <p className="mt-1">This is a read-only view. Content may be AI-generated and should be verified before use.</p>
        </div>
      </div>
    </div>
  );
}
