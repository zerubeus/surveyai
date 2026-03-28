"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BarChart3,
  Brain,
  CheckCircle2,
  ChevronRight,
  Database,
  FileText,
  Globe,
  Lock,
  Microscope,
  Shield,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Brain,
    title: "AI-Guided Analysis Planning",
    desc: "Gemini proposes the right statistical tests for your research questions — Kruskal-Wallis, Spearman, OLS regression, moderation, and more.",
    color: "text-violet-600",
    bg: "bg-violet-50",
  },
  {
    icon: BarChart3,
    title: "Automated EDA & Quality",
    desc: "Column profiling, bias detection, social desirability checks, and quality scores — all before you touch a single line of code.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: Microscope,
    title: "Statistical Rigour Built In",
    desc: "Effect sizes, exact p-values, assumption checking, and APA-style reporting. Non-parametric tests auto-selected for Likert scales.",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    icon: FileText,
    title: "Multi-Template Reports",
    desc: "Donor, internal, academic, or policy reports — each with appropriate language, depth, and formatting. AI drafts, you review.",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    icon: Database,
    title: "XLSForm & DOCX Support",
    desc: "Upload your survey instrument alongside the data. The AI maps question labels to dataset columns automatically.",
    color: "text-cyan-600",
    bg: "bg-cyan-50",
  },
  {
    icon: Shield,
    title: "GDPR-Ready Architecture",
    desc: "Row-level security on every table, data stays in EU region, signed export URLs with 7-day expiry.",
    color: "text-rose-600",
    bg: "bg-rose-50",
  },
];

const STEPS = [
  { step: "01", title: "Define Context", desc: "Name your study, set research questions, select sampling method and target population." },
  { step: "02", title: "Upload Data", desc: "CSV or Excel. Optionally attach your questionnaire (XLSForm / Word / PDF) for label mapping." },
  { step: "03", title: "Map Columns", desc: "AI suggests roles: outcome, covariate, demographic, identifier. You review and confirm." },
  { step: "04", title: "Quality Check", desc: "EDA, bias detection, and data cleaning suggestions — all with one click." },
  { step: "05", title: "Run Analysis", desc: "Approve the AI's analysis plan or add your own tests. All stats computed deterministically." },
  { step: "06", title: "Review Results", desc: "Per-RQ synthesis, traffic-light evidence verdicts, charts, and AI interpretations." },
  { step: "07", title: "Export Report", desc: "Download a publication-ready DOCX or PDF with methodology, findings, and recommendations." },
];

const AUDIENCES = [
  { icon: Globe, label: "NGOs & INGOs", desc: "Baseline/endline evaluations, needs assessments, donor reports" },
  { icon: Users, label: "Research Firms", desc: "Survey data analysis at scale, fast turnaround for clients" },
  { icon: Microscope, label: "Academic Teams", desc: "Publish-ready results with correct statistical notation" },
  { icon: FileText, label: "Policy Units", desc: "Plain-language summaries and actionable recommendations" },
];

const TESTIMONIALS = [
  {
    quote: "We used to spend 3 weeks on post-survey analysis. Chisquare compressed that to 2 days, including the donor report.",
    name: "Amira K.",
    role: "MEL Manager, humanitarian INGO",
    initials: "AK",
    color: "bg-violet-100 text-violet-700",
  },
  {
    quote: "The AI correctly identified that our Likert-scale data needed non-parametric tests. That alone saved us a reviewer rejection.",
    name: "Dr. R. Mensah",
    role: "Research Director, West Africa",
    initials: "RM",
    color: "bg-blue-100 text-blue-700",
  },
  {
    quote: "The evidence-per-RQ synthesis section is exactly what our policy team needed. No statistics background required.",
    name: "Sara T.",
    role: "Policy Analyst",
    initials: "ST",
    color: "bg-emerald-100 text-emerald-700",
  },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold">Chisquare</span>
          </div>
          <div className="hidden items-center gap-6 text-sm md:flex">
            <Link href="#features" className="text-gray-600 hover:text-gray-900">Features</Link>
            <Link href="#how-it-works" className="text-gray-600 hover:text-gray-900">How it works</Link>
            <Link href="#who-is-it-for" className="text-gray-600 hover:text-gray-900">Who it's for</Link>
            <Link href="/privacy" className="text-gray-600 hover:text-gray-900">Privacy</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                Get started free
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50 via-white to-white px-6 pb-24 pt-20">
        {/* Background blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-100/60 blur-3xl" />
          <div className="absolute -right-32 top-16 h-80 w-80 rounded-full bg-violet-100/50 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <Badge className="mb-6 bg-blue-100 text-blue-700 hover:bg-blue-100">
            <Sparkles className="mr-1.5 h-3 w-3" />
            Powered by Google Gemini
          </Badge>

          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-gray-900 md:text-6xl">
            From survey data to<br />
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              publication-ready reports
            </span>
            <br />in hours, not weeks.
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-xl text-gray-600">
            Chisquare automates the entire analysis pipeline — EDA, bias detection, statistical testing, and AI-drafted reports — for NGOs, research firms, and academic teams.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/auth/signup">
              <Button size="lg" className="h-12 gap-2 bg-blue-600 px-8 text-base hover:bg-blue-700">
                Start analysing for free
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="#how-it-works">
              <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                See how it works
              </Button>
            </Link>
          </div>

          <p className="mt-4 text-sm text-gray-500">No credit card required · GDPR-ready · Works with CSV, Excel, XLSForm</p>

          {/* Social proof strip */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500">
            {["Humanitarian", "Development", "Academic", "Policy"].map(tag => (
              <span key={tag} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {tag} sector ready
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-white px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <Badge className="mb-4 bg-blue-50 text-blue-700 hover:bg-blue-50">Features</Badge>
            <h2 className="mb-4 text-4xl font-bold">Everything for rigorous survey analysis</h2>
            <p className="mx-auto max-w-2xl text-lg text-gray-600">
              Built by researchers, for researchers. Every statistical decision is transparent, auditable, and explainable.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Card key={f.title} className="border-gray-100 transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${f.bg}`}>
                    <f.icon className={`h-5 w-5 ${f.color}`} />
                  </div>
                  <h3 className="mb-2 font-semibold">{f.title}</h3>
                  <p className="text-sm text-gray-600">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-gray-50 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <Badge className="mb-4 bg-gray-100 text-gray-700 hover:bg-gray-100">Workflow</Badge>
            <h2 className="mb-4 text-4xl font-bold">7 steps from upload to report</h2>
            <p className="mx-auto max-w-xl text-lg text-gray-600">
              A guided, linear workflow keeps you in control at every decision point.
            </p>
          </div>

          <div className="space-y-4">
            {STEPS.map((s, i) => (
              <div
                key={s.step}
                className="flex items-start gap-5 rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
                  {s.step}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-0.5 text-sm text-gray-600">{s.desc}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="mt-2 h-4 w-4 flex-shrink-0 text-gray-400" />
                )}
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link href="/auth/signup">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                Try the full workflow
                <Zap className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who-is-it-for" className="bg-white px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <Badge className="mb-4 bg-violet-50 text-violet-700 hover:bg-violet-50">Audience</Badge>
            <h2 className="mb-4 text-4xl font-bold">Built for evidence-driven teams</h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {AUDIENCES.map((a) => (
              <Card key={a.label} className="border-gray-100 text-center">
                <CardContent className="p-6">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
                    <a.icon className="h-6 w-6 text-blue-600" />
                  </div>
                  <h3 className="mb-1 font-semibold">{a.label}</h3>
                  <p className="text-xs text-gray-500">{a.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-gradient-to-b from-blue-50 to-white px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="text-4xl font-bold">Trusted by analysts who care about rigour</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <Card key={t.name} className="border-gray-100 shadow-sm">
                <CardContent className="p-6">
                  <p className="mb-4 text-sm leading-relaxed text-gray-700">&ldquo;{t.quote}&rdquo;</p>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${t.color}`}>
                      {t.initials}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-600 px-6 py-24 text-white">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-4 text-4xl font-bold">Ready to run your analysis?</h2>
          <p className="mb-10 text-xl text-blue-100">
            Join teams that use Chisquare to go from raw data to evidence-backed decisions — without the spreadsheet marathon.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/auth/signup">
              <Button size="lg" className="h-12 gap-2 bg-white px-8 text-base text-blue-600 hover:bg-blue-50">
                Get started — it&apos;s free
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/auth/login">
              <Button size="lg" variant="ghost" className="h-12 px-8 text-base text-white hover:bg-blue-500 hover:text-white">
                Sign in to your account
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col items-start justify-between gap-6 md:flex-row">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="font-bold">Chisquare</span>
              </div>
              <p className="text-sm text-gray-500 max-w-xs">
                AI-powered survey analysis for NGOs, research firms, and academic teams.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
              <Link href="/landing" className="text-gray-600 hover:text-gray-900">Home</Link>
              <Link href="/privacy" className="text-gray-600 hover:text-gray-900">Privacy Policy</Link>
              <Link href="/auth/signup" className="text-gray-600 hover:text-gray-900">Sign up</Link>
              <Link href="/setup" className="text-gray-600 hover:text-gray-900">Setup Guide</Link>
              <Link href="/auth/login" className="text-gray-600 hover:text-gray-900">Sign in</Link>
              <Link href="/auth/signup" className="text-gray-600 hover:text-gray-900">Get started</Link>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-4 border-t pt-6 text-xs text-gray-500 md:flex-row">
            <p>© {new Date().getFullYear()} Chisquare. All rights reserved.</p>
            <div className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              <span>GDPR-ready · Data stays in your region</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
