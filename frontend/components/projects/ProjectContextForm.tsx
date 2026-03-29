"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Json } from "@/lib/types/database";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// Note: Native <select> used below (not the Radix Select) for simplicity
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  projectSchema,
  OBJECTIVE_TAGS,
  SAMPLING_METHODS,
  REPORT_AUDIENCES,
  INSTRUMENT_LANGUAGES,
  RQ_TEMPLATES,
  type ProjectFormData,
} from "@/lib/schemas/project";

const emptyForm: ProjectFormData = {
  name: "",
  objective_text: "",
  objective_tags: [],
  research_questions: [{ text: "", priority: 1 }],
  target_population: "",
  sampling_method: "simple_random",
  geographic_scope: { country: "", regions: "", urban: false, rural: false },
  report_audience: "donor",
  instrument_language: "en",
};

interface ProjectContextFormProps {
  organizationId: string;
}

export function ProjectContextForm({ organizationId }: ProjectContextFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<ProjectFormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateField<K extends keyof ProjectFormData>(
    key: K,
    value: ProjectFormData[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function toggleTag(tag: (typeof OBJECTIVE_TAGS)[number]) {
    const current = form.objective_tags;
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    updateField("objective_tags", next);
  }

  function updateQuestion(index: number, text: string) {
    const questions = [...form.research_questions];
    questions[index] = { ...questions[index], text };
    updateField("research_questions", questions);
  }

  function addQuestion() {
    if (form.research_questions.length >= 5) return;
    updateField("research_questions", [
      ...form.research_questions,
      { text: "", priority: form.research_questions.length + 1 },
    ]);
  }

  function removeQuestion(index: number) {
    if (form.research_questions.length <= 1) return;
    const questions = form.research_questions
      .filter((_, i) => i !== index)
      .map((q, i) => ({ ...q, priority: i + 1 }));
    updateField("research_questions", questions);
  }

  function updateGeoScope<K extends keyof ProjectFormData["geographic_scope"]>(
    key: K,
    value: ProjectFormData["geographic_scope"][K],
  ) {
    setForm((prev) => ({
      ...prev,
      geographic_scope: { ...prev.geographic_scope, [key]: value },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const result = projectSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setServerError("You must be logged in to create a project.");
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: projectRaw, error } = await sb
      .from("projects")
      .insert({
        organization_id: organizationId,
        created_by: user.id,
        name: result.data.name,
        description: JSON.stringify({
          text: result.data.objective_text,
          tags: result.data.objective_tags ?? [],
        }),
        status: "draft",
        research_questions: result.data.research_questions as unknown as Json,
        sampling_method: result.data.sampling_method,
        target_population: result.data.target_population,
        geographic_scope: JSON.stringify(result.data.geographic_scope),
        additional_context: JSON.stringify({
          objective_tags: result.data.objective_tags,
          report_audience: result.data.report_audience,
          instrument_language: result.data.instrument_language,
        }),
        current_step: 2,
        pipeline_status: {
          "1": "completed",
          "2": "active",
          "3": "locked",
          "4": "locked",
          "5": "locked",
          "6": "locked",
          "7": "locked",
        },
      })
      .select("id")
      .single();
    const data = projectRaw as { id: string } | null;

    if (error) {
      setServerError(error.message);
      setLoading(false);
      return;
    }

    router.push(`/projects/${data?.id}/step/2`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {serverError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      {/* Project Name */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input
              data-tour="project-name"
              id="name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="e.g., Baseline Survey — Rakhine State 2025"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="objective_text">Objective</Label>
            <Textarea
              id="objective_text"
              value={form.objective_text}
              onChange={(e) => updateField("objective_text", e.target.value)}
              placeholder="Describe the main objective of this survey project..."
              rows={4}
            />
            {errors.objective_text && (
              <p className="text-sm text-destructive">{errors.objective_text}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Objective Tags</Label>
            <div className="flex flex-wrap gap-2">
              {OBJECTIVE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    form.objective_tags.includes(tag)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            {errors.objective_tags && (
              <p className="text-sm text-destructive">{errors.objective_tags}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Research Questions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-tour="research-questions">Research Questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* RQ templates — shown when at least one objective tag matches */}
          {form.objective_tags.length > 0 && (() => {
            const templates = form.objective_tags.flatMap(tag => RQ_TEMPLATES[tag] ?? []);
            if (templates.length === 0) return null;
            return (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <p className="mb-2 text-xs font-medium text-blue-800">💡 Research question templates — click to use</p>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t, ti) => (
                    <button
                      key={ti}
                      type="button"
                      onClick={() => {
                        const newQuestions = t.questions.map((text, j) => ({ text, priority: j + 1 }));
                        updateField("research_questions", newQuestions);
                      }}
                      className="rounded-full border border-blue-300 bg-white px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {form.research_questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {i + 1}
              </span>
              <div className="flex-1 space-y-1">
                <Input
                  value={q.text}
                  onChange={(e) => updateQuestion(i, e.target.value)}
                  placeholder={`Research question ${i + 1}`}
                />
                {errors[`research_questions.${i}.text`] && (
                  <p className="text-sm text-destructive">
                    {errors[`research_questions.${i}.text`]}
                  </p>
                )}
              </div>
              {form.research_questions.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeQuestion(i)}
                  className="mt-1"
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {errors.research_questions && (
            <p className="text-sm text-destructive">{errors.research_questions}</p>
          )}
          {form.research_questions.length < 5 && (
            <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
              Add question
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Study Context */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Study Context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target_population">Target Population</Label>
            <Textarea
              id="target_population"
              value={form.target_population}
              onChange={(e) => updateField("target_population", e.target.value)}
              placeholder="e.g., Displaced households in camps and host communities..."
              rows={3}
            />
            {errors.target_population && (
              <p className="text-sm text-destructive">
                {errors.target_population}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sampling_method">Sampling Method</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none"
              id="sampling_method"
              value={form.sampling_method}
              onChange={(e) =>
                updateField(
                  "sampling_method",
                  e.target.value as ProjectFormData["sampling_method"],
                )
              }
            >
              {SAMPLING_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              value={form.geographic_scope.country}
              onChange={(e) => updateGeoScope("country", e.target.value)}
              placeholder="e.g., Myanmar"
            />
            {errors["geographic_scope.country"] && (
              <p className="text-sm text-destructive">
                {errors["geographic_scope.country"]}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="regions">Regions (optional)</Label>
            <Input
              id="regions"
              value={form.geographic_scope.regions ?? ""}
              onChange={(e) => updateGeoScope("regions", e.target.value)}
              placeholder="e.g., Rakhine, Kachin"
            />
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.geographic_scope.urban}
                onChange={(e) => updateGeoScope("urban", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Urban
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.geographic_scope.rural}
                onChange={(e) => updateGeoScope("rural", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Rural
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Report Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Report Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="report_audience">Report Audience</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none"
              id="report_audience"
              value={form.report_audience}
              onChange={(e) =>
                updateField(
                  "report_audience",
                  e.target.value as ProjectFormData["report_audience"],
                )
              }
            >
              {REPORT_AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="instrument_language">Instrument Language</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none"
              id="instrument_language"
              value={form.instrument_language}
              onChange={(e) => updateField("instrument_language", e.target.value)}
            >
              {INSTRUMENT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard")}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </form>
  );
}
