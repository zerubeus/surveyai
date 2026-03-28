"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  HelpCircle,
  Info,
  Layers,
  LifeBuoy,
  Microscope,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SETUP_STEPS = [
  {
    id: "account",
    icon: Sparkles,
    title: "Create your account",
    time: "2 min",
    color: "text-blue-600",
    bg: "bg-blue-50",
    content: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>Go to <Link href="/auth/signup" className="text-blue-600 hover:underline font-medium">chisquare/auth/signup</Link> and register with your work email.</p>
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="font-medium text-blue-800 mb-1">📧 Email confirmation required</p>
          <p className="text-blue-700">Check your inbox for a confirmation link. Click it before signing in.</p>
        </div>
        <p>On first sign-in, the platform will automatically create your workspace organisation.</p>
      </div>
    ),
  },
  {
    id: "project",
    icon: Layers,
    title: "Create your first project",
    time: "5 min",
    color: "text-violet-600",
    bg: "bg-violet-50",
    content: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>From the dashboard, click <strong>New Project</strong>. Fill in:</p>
        <ul className="ml-4 space-y-1.5 list-none">
          {[
            ["Project name", "e.g. 'HH Survey — Kandahar 2024'"],
            ["Objective tags", "Baseline / Endline / Needs Assessment / Midline"],
            ["Research questions", "Write 1–3 specific questions your analysis should answer"],
            ["Sampling method", "Simple random, stratified, cluster, purposive…"],
            ["Target population", "Who the sample represents"],
            ["Report audience", "Donor / Internal / Academic / Policy"],
          ].map(([label, hint]) => (
            <li key={label} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
              <span><strong>{label}</strong> — {hint}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-lg bg-yellow-50 p-3">
          <p className="font-medium text-yellow-800 mb-1">💡 Tip: Research Questions</p>
          <p className="text-yellow-700">Write them as real questions, e.g. <em>"To what extent do WLB and workload predict job satisfaction?"</em> — the AI uses these to choose statistical tests.</p>
        </div>
      </div>
    ),
  },
  {
    id: "upload",
    icon: Upload,
    title: "Upload your dataset",
    time: "3 min",
    color: "text-cyan-600",
    bg: "bg-cyan-50",
    content: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>Accepted formats: <strong>CSV, Excel (.xlsx, .xls)</strong></p>
        <div className="space-y-2">
          <p className="font-medium">Dataset requirements:</p>
          <ul className="ml-4 space-y-1.5 list-none">
            {[
              "First row must be column headers",
              "One row per respondent",
              "No merged cells (Excel)",
              "UTF-8 encoding recommended for non-Latin characters",
            ].map((req) => (
              <li key={req} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-cyan-50 p-3">
          <p className="font-medium text-cyan-800 mb-1">📋 Optional: Upload your questionnaire</p>
          <p className="text-cyan-700">Attach a Word (.docx), PDF, or XLSForm (.xlsx) questionnaire. The AI uses question labels to better understand your column structure.</p>
        </div>
      </div>
    ),
  },
  {
    id: "mapping",
    icon: Database,
    title: "Review column roles",
    time: "5–10 min",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    content: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>The AI assigns roles to each column. Review and correct any mismatches:</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["outcome", "Variables you want to explain (JobSatisfaction, Stress)"],
            ["covariate", "Explanatory variables (WLB, Workload)"],
            ["demographic", "Background variables (Gender, Age, Dept)"],
            ["identifier", "Row IDs — excluded from analysis"],
            ["ignore", "Columns to skip entirely"],
            ["weight", "Survey weighting variables"],
          ].map(([role, desc]) => (
            <div key={role} className="rounded-md bg-gray-50 p-2">
              <code className="text-xs font-medium text-gray-800">{role}</code>
              <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
        <p>Click <strong>Confirm All</strong> when done, or bulk-select columns to assign the same role.</p>
      </div>
    ),
  },
  {
    id: "quality",
    icon: Microscope,
    title: "Run quality analysis",
    time: "2–3 min (automated)",
    color: "text-orange-600",
    bg: "bg-orange-50",
    content: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>Click <strong>Start EDA</strong>. The system runs:</p>
        <ul className="ml-4 space-y-1.5 list-none">
          {[
            "Column profiling (missing %, unique count, distribution shape)",
            "Consistency checks (out-of-range values, impossible combinations)",
            "Bias detection (social desirability, selection bias, skew)",
            "AI interpretation of quality findings",
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>Review the cleaning suggestions and approve those you want applied before analysis.</p>
        <div className="rounded-lg bg-orange-50 p-3">
          <p className="font-medium text-orange-800 mb-1">⚠️ Quality gates</p>
          <p className="text-orange-700">The system will warn you if &gt;30% of values are missing or if bias flags are critical. You can proceed but the report will note the caveats.</p>
        </div>
      </div>
    ),
  },
  {
    id: "analysis",
    icon: Microscope,
    title: "Review & run analysis",
    time: "5 min review + ~2 min compute",
    color: "text-purple-600",
    bg: "bg-purple-50",
    content: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>The AI proposes statistical tests for each research question. For each proposal you can:</p>
        <ul className="ml-4 space-y-1.5 list-none">
          {[
            "✅ Approve — include in the analysis run",
            "❌ Reject — exclude this test",
            "➕ Add custom — specify your own test type, outcome, and predictor",
          ].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="rounded-lg bg-purple-50 p-3">
          <p className="font-medium text-purple-800 mb-1">📐 Test selection logic</p>
          <p className="text-purple-700">Likert-scale outcomes → Spearman/Mann-Whitney/Kruskal-Wallis. Continuous outcomes → Pearson/t-test/OLS. Binary outcomes → Logistic regression.</p>
        </div>
        <p>Click <strong>Run Analysis</strong>. Results appear within 1–2 minutes for datasets up to ~10,000 rows.</p>
      </div>
    ),
  },
  {
    id: "report",
    icon: FileText,
    title: "Generate & export report",
    time: "2–3 min (AI generation)",
    color: "text-rose-600",
    bg: "bg-rose-50",
    content: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>Choose a template matching your audience:</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Donor", "Executive summary, key findings, recommendations"],
            ["Internal", "Full statistical detail, assumptions, methodology"],
            ["Academic", "Abstract, methods, results, discussion, limitations"],
            ["Policy", "Recommendations first, evidence section, plain language"],
          ].map(([t, d]) => (
            <div key={t} className="rounded-md bg-gray-50 p-2">
              <p className="text-xs font-medium text-gray-800">{t}</p>
              <p className="text-xs text-gray-500">{d}</p>
            </div>
          ))}
        </div>
        <p>Review each AI-drafted section. Sections needing human review are flagged ⚠️. Edit inline, then export as <strong>DOCX</strong> or <strong>PDF</strong>.</p>
      </div>
    ),
  },
];

const FAQS = [
  {
    q: "What statistical tests does Chisquare support?",
    a: "Linear regression (OLS), logistic regression, Spearman, Pearson, Kendall tau, Point-biserial, t-test, Welch's t-test, One-way ANOVA, Mann-Whitney U, Kruskal-Wallis H, moderation analysis, mediation analysis (Sobel).",
  },
  {
    q: "Can I add my own analysis not suggested by the AI?",
    a: "Yes. In Step 5, use the 'Add custom analysis' button to specify any test type, outcome variable, predictor, and optional control variables.",
  },
  {
    q: "What file formats are supported?",
    a: "Datasets: CSV, XLSX, XLS. Questionnaires/instruments: Word (.docx), PDF, XLSForm (.xlsx). Reports exported as DOCX and PDF.",
  },
  {
    q: "How does Chisquare handle Likert scale data?",
    a: "Likert scales (1–5, 1–7) are treated as ordinal. The AI automatically selects non-parametric tests (Spearman, Kruskal-Wallis, Mann-Whitney). You can also add an OLS regression as a sensitivity analysis.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. All data is stored in Supabase with Row-Level Security — each user only sees their own projects. Files are stored in private storage buckets with signed download URLs.",
  },
  {
    q: "How large can my dataset be?",
    a: "Currently optimised for datasets up to ~50,000 rows and 100 columns. EDA runs in under 3 minutes for typical survey datasets (3,000–10,000 rows).",
  },
];

function AccordionItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-4 text-left text-sm font-medium"
      >
        {q}
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="pb-4 text-sm text-gray-600">{a}</p>}
    </div>
  );
}

function StepCard({ step, isLast }: { step: typeof SETUP_STEPS[0]; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex gap-4">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-5 top-12 bottom-0 w-px bg-gray-200" />
      )}
      {/* Icon */}
      <div className={`relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${step.bg}`}>
        <step.icon className={`h-5 w-5 ${step.color}`} />
      </div>
      {/* Content */}
      <div className="flex-1 pb-8">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-start justify-between gap-4 text-left"
        >
          <div>
            <h3 className="font-semibold">{step.title}</h3>
            <p className="mt-0.5 text-xs text-gray-500">⏱ {step.time}</p>
          </div>
          <ChevronDown className={`mt-1 h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-4 rounded-lg border bg-white p-4">
            {step.content}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/landing" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-bold">Chisquare</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">Get started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-16">
        {/* Header */}
        <div className="mb-12 text-center">
          <Badge className="mb-4 bg-blue-50 text-blue-700 hover:bg-blue-50">
            <BookOpen className="mr-1.5 h-3 w-3" />
            Setup Guide
          </Badge>
          <h1 className="mb-4 text-4xl font-bold">Get up and running in 20 minutes</h1>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            Follow these steps to go from zero to a published-quality analysis report. Each step includes tips from real users.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Steps timeline */}
          <div className="lg:col-span-2">
            <Card className="border-gray-100 bg-white p-6">
              <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold">
                <Layers className="h-5 w-5 text-blue-600" />
                Step-by-step walkthrough
              </h2>
              <div>
                {SETUP_STEPS.map((step, i) => (
                  <StepCard key={step.id} step={step} isLast={i === SETUP_STEPS.length - 1} />
                ))}
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-blue-800">
                  <Info className="h-4 w-4" />
                  Quick start
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-blue-700 space-y-2">
                <p>Already have a CSV and a research question? You can get to Step 6 in under 10 minutes.</p>
                <Link href="/auth/signup">
                  <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 mt-2">
                    Start now
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="border-gray-100">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <HelpCircle className="h-4 w-4 text-gray-500" />
                  Data format tips
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-gray-600 space-y-2">
                {[
                  "Name your columns clearly: JobSatisfaction not JS_q12",
                  "Use consistent values: Male/Female not M/F/male/FEMALE",
                  "Likert scale: use numbers 1–5, not text labels",
                  "Remove blank rows at the bottom of Excel files",
                ].map((tip) => (
                  <div key={tip} className="flex gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-green-500" />
                    <span>{tip}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-gray-100">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <LifeBuoy className="h-4 w-4 text-gray-500" />
                  Need help?
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-600 space-y-2">
                <p>Questions about statistical methods, data formats, or report templates?</p>
                <p className="text-xs text-gray-500">
                  Use the custom test form in Step 5 to add any analysis the AI didn&apos;t propose.
                </p>
              </CardContent>
            </Card>

            <Card className="border-gray-100">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ChevronRight className="h-4 w-4 text-gray-500" />
                  Other pages
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <Link href="/landing" className="block text-blue-600 hover:underline">← Back to home</Link>
                <Link href="/privacy" className="block text-blue-600 hover:underline">Data protection policy</Link>
                <Link href="/auth/signup" className="block text-blue-600 hover:underline">Create account</Link>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-16">
          <h2 className="mb-8 flex items-center gap-2 text-2xl font-bold">
            <HelpCircle className="h-6 w-6 text-gray-400" />
            Frequently asked questions
          </h2>
          <div className="rounded-xl border bg-white p-6">
            {FAQS.map((faq) => (
              <AccordionItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
