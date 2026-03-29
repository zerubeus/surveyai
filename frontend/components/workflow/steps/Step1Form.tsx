"use client";

import { useState, useCallback, useEffect } from "react";
import { useOnboardingTour } from "@/hooks/useOnboardingTour";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useAutoSave } from "@/hooks/useAutoSave";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronUp,
  ChevronDown,
  Plus,
  X,
  Users,
  Building2,
  GraduationCap,
  Landmark,
  Globe,
} from "lucide-react";
import type { Tables, Enums, PipelineStatus, Json } from "@/lib/types/database";

// ---------- constants ----------

const OBJECTIVE_TAGS = [
  "Baseline",
  "Endline",
  "Midline",
  "Needs Assessment",
  "Post-Distribution",
  "KAP Study",
  "Satisfaction Survey",
  "Other",
] as const;

const SAMPLING_OPTIONS: {
  value: Enums<"sampling_method">;
  label: string;
  helper: string;
}[] = [
  { value: "simple_random", label: "Simple Random", helper: "Every respondent had equal probability of selection" },
  { value: "stratified", label: "Stratified", helper: "Population divided into subgroups, sampled from each" },
  { value: "cluster", label: "Cluster", helper: "Groups (villages, schools) randomly selected, all members included" },
  { value: "multi_stage", label: "Multi-stage", helper: "Combination of cluster and random selection within clusters" },
  { value: "convenience", label: "Convenience", helper: "Whoever was available — limits generalizability" },
  { value: "purposive", label: "Purposive", helper: "Specific types of respondents selected intentionally" },
  { value: "snowball", label: "Snowball", helper: "Respondents refer other respondents" },
];

const AUDIENCE_OPTIONS = [
  { value: "donor", label: "Donor", icon: Building2, helper: "Formal structure, executive summary first" },
  { value: "internal", label: "Internal", icon: Users, helper: "Concise, action-oriented, skip background" },
  { value: "academic", label: "Academic", icon: GraduationCap, helper: "Detailed methodology, full statistical tables" },
  { value: "government", label: "Government", icon: Landmark, helper: "Policy-focused, clear recommendations" },
  { value: "public", label: "Public", icon: Globe, helper: "Plain language, visual-heavy, minimal jargon" },
] as const;

type AudienceValue = (typeof AUDIENCE_OPTIONS)[number]["value"];

// ---------- helpers ----------

function parseResearchQuestions(rq: Json): string[] {
  if (Array.isArray(rq)) {
    return rq.filter((q): q is string => typeof q === "string");
  }
  return [];
}

function parseObjectiveTags(desc: string | null): string[] {
  if (!desc) return [];
  try {
    const parsed = JSON.parse(desc);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tags)) {
      return parsed.tags;
    }
  } catch {
    // not JSON, fall through
  }
  return [];
}

function parseObjectiveText(desc: string | null): string {
  if (!desc) return "";
  try {
    const parsed = JSON.parse(desc);
    if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
    // not JSON
  }
  return desc;
}

function parseGeoScope(geo: string | null): { country: string; urban: boolean; rural: boolean } {
  if (!geo) return { country: "", urban: false, rural: false };
  try {
    const parsed = JSON.parse(geo);
    if (parsed && typeof parsed === "object") {
      return {
        country: typeof parsed.country === "string" ? parsed.country : "",
        urban: parsed.urban === true,
        rural: parsed.rural === true,
      };
    }
  } catch {
    // plain string
  }
  return { country: geo, urban: false, rural: false };
}

function parseAudience(ctx: string | null): AudienceValue | "" {
  if (!ctx) return "";
  try {
    const parsed = JSON.parse(ctx);
    if (parsed && typeof parsed === "object") {
      // Support both formats:
      // Step1Form saves: { audience: "..." }
      // ProjectContextForm saves: { report_audience: "...", ... }
      const val = parsed.audience ?? parsed.report_audience;
      if (typeof val === "string") return val as AudienceValue;
    }
  } catch {
    // not JSON
  }
  return "";
}

// ---------- component ----------

interface Step1FormProps {
  project: Tables<"projects">;
}

export function Step1Form({ project }: Step1FormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  // Show onboarding tour for first-time users (when project was just created = no pipeline steps done)
  const isNewProject = !project.pipeline_status || Object.keys(project.pipeline_status as Record<string, unknown>).length === 0;
  const { restartTour } = useOnboardingTour(1, isNewProject);

  // -- form state --
  const [name, setName] = useState(project.name);
  const [organization, setOrganization] = useState("");
  const [objectiveText, setObjectiveText] = useState(
    parseObjectiveText(project.description)
  );
  const [objectiveTags, setObjectiveTags] = useState<string[]>(
    parseObjectiveTags(project.description)
  );
  const [samplingMethod, setSamplingMethod] = useState<
    Enums<"sampling_method"> | ""
  >(project.sampling_method ?? "");
  const [targetPopulation, setTargetPopulation] = useState(
    project.target_population ?? ""
  );
  const [geoScope, setGeoScope] = useState(
    parseGeoScope(project.geographic_scope)
  );
  const [researchQuestions, setResearchQuestions] = useState<string[]>(() => {
    const rqs = parseResearchQuestions(project.research_questions);
    return rqs.length > 0 ? rqs : [""];
  });
  const [audience, setAudience] = useState<AudienceValue | "">(
    parseAudience(project.additional_context)
  );

  // -- auto-save hooks --
  useAutoSave("projects", project.id, "name", name);
  useAutoSave(
    "projects",
    project.id,
    "description",
    JSON.stringify({ text: objectiveText, tags: objectiveTags })
  );
  useAutoSave("projects", project.id, "sampling_method", samplingMethod || null);
  useAutoSave("projects", project.id, "target_population", targetPopulation || null);
  useAutoSave(
    "projects",
    project.id,
    "geographic_scope",
    JSON.stringify(geoScope)
  );
  useAutoSave("projects", project.id, "research_questions", researchQuestions);
  useAutoSave(
    "projects",
    project.id,
    "additional_context",
    JSON.stringify({ audience: audience || null })
  );

  // -- validation --
  const filledQuestions = researchQuestions.filter((q) => q.trim().length > 0);
  const isValid = name.trim().length > 0 && samplingMethod !== "" && filledQuestions.length > 0;

  // -- tag toggle --
  const toggleTag = useCallback((tag: string) => {
    setObjectiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  // -- research questions --
  const updateQuestion = useCallback((idx: number, value: string) => {
    setResearchQuestions((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const moveQuestion = useCallback((idx: number, dir: -1 | 1) => {
    setResearchQuestions((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const removeQuestion = useCallback((idx: number) => {
    setResearchQuestions((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const addQuestion = useCallback(() => {
    setResearchQuestions((prev) => {
      if (prev.length >= 5) return prev;
      return [...prev, ""];
    });
  }, []);

  // -- submit --
  const handleContinue = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);

    const supabase = createBrowserClient();

    const newPipeline: PipelineStatus = {
      ...(project.pipeline_status as PipelineStatus),
      "1": "completed",
      "2": "active",
    };

    const { error } = await supabase
      .from("projects")
      // @ts-expect-error — supabase update type inference
      .update({
        name,
        description: JSON.stringify({ text: objectiveText, tags: objectiveTags }),
        sampling_method: samplingMethod as Enums<"sampling_method">,
        target_population: targetPopulation || null,
        geographic_scope: JSON.stringify(geoScope),
        research_questions: researchQuestions as unknown as Json,
        additional_context: JSON.stringify({ audience: audience || null }),
        current_step: 2,
        pipeline_status: newPipeline as unknown as Json,
      })
      .eq("id", project.id);

    if (error) {
      console.error("Failed to update project:", error.message);
      setSubmitting(false);
      return;
    }

    router.refresh();
    router.push(`/projects/${project.id}/step/2`);
  };

  // -- selected sampling helper text --
  const selectedSampling = SAMPLING_OPTIONS.find((o) => o.value === samplingMethod);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Project Brief</h2>
          <button
            type="button"
            onClick={restartTour}
            className="text-xs text-blue-600 hover:underline underline-offset-2"
            title="Restart the guided tour"
          >
            ? Tour
          </button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Define your project scope and research goals. All fields auto-save.
        </p>
      </div>

      <Accordion
        type="multiple"
        defaultValue={["identity", "design", "questions"]}
        className="space-y-2"
      >
        {/* ===== SECTION A — Project Identity ===== */}
        <AccordionItem value="identity" className="rounded-lg border px-4">
          <AccordionTrigger className="text-base font-semibold">
            Project Identity
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-6">
            <div className="space-y-2">
              <Label htmlFor="name">
                Project Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. WASH Baseline Survey 2026"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">Organization</Label>
              <Input
                id="organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="Optional"
              />
              <p className="text-xs text-muted-foreground">You can add this later</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="objective">Objective</Label>
              <Textarea
                id="objective"
                value={objectiveText}
                onChange={(e) => setObjectiveText(e.target.value)}
                rows={3}
                placeholder="Describe the primary objective of this survey project..."
              />
            </div>

            <div className="space-y-2">
              <Label>Objective Tags</Label>
              <div className="flex flex-wrap gap-2">
                {OBJECTIVE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      objectiveTags.includes(tag)
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-muted hover:border-muted-foreground/50"
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ===== SECTION B — Research Design ===== */}
        <AccordionItem value="design" className="rounded-lg border px-4">
          <AccordionTrigger className="text-base font-semibold">
            Research Design
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-6">
            <div className="space-y-2">
              <Label>
                Sampling Method <span className="text-red-500">*</span>
              </Label>
              <Select
                value={samplingMethod}
                onValueChange={(v) => setSamplingMethod(v as Enums<"sampling_method">)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select sampling method..." />
                </SelectTrigger>
                <SelectContent>
                  {SAMPLING_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSampling && (
                <p className="text-xs text-muted-foreground">
                  {selectedSampling.helper}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="target-pop">Target Population</Label>
              <Textarea
                id="target-pop"
                value={targetPopulation}
                onChange={(e) => setTargetPopulation(e.target.value)}
                rows={2}
                placeholder="e.g. Households in flood-affected districts of Sindh province"
              />
              <p className="text-xs text-muted-foreground">You can add this later</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">Geographic Scope</Label>
              <Input
                id="country"
                value={geoScope.country}
                onChange={(e) =>
                  setGeoScope((prev) => ({ ...prev, country: e.target.value }))
                }
                placeholder="Country or region"
              />
              <div className="flex items-center gap-4 mt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={geoScope.urban}
                    onChange={(e) =>
                      setGeoScope((prev) => ({ ...prev, urban: e.target.checked }))
                    }
                    className="rounded border-muted-foreground"
                  />
                  Urban
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={geoScope.rural}
                    onChange={(e) =>
                      setGeoScope((prev) => ({ ...prev, rural: e.target.checked }))
                    }
                    className="rounded border-muted-foreground"
                  />
                  Rural
                </label>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ===== SECTION C — Research Questions ===== */}
        <AccordionItem value="questions" className="rounded-lg border px-4">
          <AccordionTrigger className="text-base font-semibold">
            Research Questions
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-6">
            <p className="text-sm text-muted-foreground">
              Add up to 5 research questions. Use arrows to set priority order.
            </p>
            {researchQuestions.map((q, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex flex-col gap-0.5 pt-2.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveQuestion(idx, -1)}
                    aria-label={`Move question ${idx + 1} up`}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === researchQuestions.length - 1}
                    onClick={() => moveQuestion(idx, 1)}
                    aria-label={`Move question ${idx + 1} down`}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1">
                  <Input
                    value={q}
                    onChange={(e) => updateQuestion(idx, e.target.value)}
                    placeholder="Is there a significant difference in [outcome] between [groups]?"
                    aria-label={`Research question ${idx + 1}`}
                    id={`rq-${idx}`}
                  />
                </div>
                {researchQuestions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(idx)}
                    aria-label={`Remove question ${idx + 1}`}
                    className="mt-2.5 text-muted-foreground hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {researchQuestions.length < 5 && (
              <button
                type="button"
                onClick={addQuestion}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another question
              </button>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ===== Report Audience ===== */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">Report Audience</Label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AUDIENCE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = audience === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAudience(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors",
                  selected
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-muted hover:border-muted-foreground/50"
                )}
              >
                <Icon className="h-5 w-5" />
                {opt.label}
              </button>
            );
          })}
        </div>
        {audience && (
          <p className="text-sm text-muted-foreground">
            {AUDIENCE_OPTIONS.find((o) => o.value === audience)?.helper}
          </p>
        )}
      </div>

      {/* ===== Continue Button ===== */}
      <div className="flex items-center justify-between border-t pt-6">
        <p className="text-xs text-muted-foreground">
          {!isValid && "Fill in required fields (*) to continue"}
        </p>
        <Button
          onClick={handleContinue}
          disabled={!isValid || submitting}
          size="lg"
        >
          {submitting ? "Saving..." : "Continue to Upload"}
        </Button>
      </div>
    </div>
  );
}
