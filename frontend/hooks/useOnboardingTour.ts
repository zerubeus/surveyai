"use client";

import { useEffect, useCallback, useRef } from "react";

const TOUR_COMPLETED_KEY = "chisquare_tour_v1_done";

interface TourStep {
  element?: string;
  popover: {
    title: string;
    description: string;
    side?: "top" | "bottom" | "left" | "right";
    align?: "start" | "center" | "end";
  };
}

const STEP_TOURS: Record<number, TourStep[]> = {
  1: [
    {
      popover: {
        title: "Welcome to Chisquare 👋",
        description: "Let's walk you through your first project. This takes about 2 minutes.",
      },
    },
    {
      element: '[data-tour="project-name"]',
      popover: {
        title: "Name your project",
        description: "Give your project a descriptive name — e.g. 'HH Survey Kandahar 2024'. You'll reference this in your report.",
        side: "bottom",
      },
    },
    {
      element: '[data-tour="objective-tags"]',
      popover: {
        title: "Choose your study type",
        description: "Select a tag like Baseline or Needs Assessment. This unlocks research question templates.",
        side: "bottom",
      },
    },
    {
      element: '[data-tour="research-questions"]',
      popover: {
        title: "Define your research questions",
        description: "These are the specific questions your analysis should answer. The AI uses them to choose the right statistical tests. Use the templates above to get started.",
        side: "top",
      },
    },
  ],
  2: [
    {
      element: '[data-tour="dataset-upload"]',
      popover: {
        title: "Upload your dataset",
        description: "Drag & drop your CSV or Excel file here. First row should be column headers, one row per respondent.",
        side: "bottom",
      },
    },
    {
      element: '[data-tour="instrument-upload"]',
      popover: {
        title: "Optionally: upload your questionnaire",
        description: "Attach a Word, PDF, or XLSForm file. The AI uses question labels to better understand your dataset columns.",
        side: "top",
      },
    },
  ],
  3: [
    {
      element: '[data-tour="column-table"]',
      popover: {
        title: "Review column roles",
        description: "The AI has suggested a role for each column. Check that outcome variables (what you want to explain) and covariates (predictors) are correct.",
        side: "top",
      },
    },
    {
      element: '[data-tour="confirm-all"]',
      popover: {
        title: "Confirm and continue",
        description: "Once satisfied, click 'Confirm All' to lock in the roles and proceed to data quality analysis.",
        side: "top",
      },
    },
  ],
  4: [
    {
      element: '[data-tour="start-eda"]',
      popover: {
        title: "Run quality analysis",
        description: "Click here to start automated EDA: column profiling, bias detection, and consistency checks. Takes about 1-2 minutes.",
        side: "bottom",
      },
    },
  ],
  5: [
    {
      element: '[data-tour="plan-list"]',
      popover: {
        title: "Review the analysis plan",
        description: "The AI has proposed statistical tests for each research question. Approve, reject, or add your own custom tests.",
        side: "right",
      },
    },
    {
      element: '[data-tour="run-analysis"]',
      popover: {
        title: "Run the analysis",
        description: "Once you've approved at least one test, click 'Run Analysis'. Results appear in 1-2 minutes.",
        side: "top",
      },
    },
  ],
  6: [
    {
      element: '[data-tour="rq-summary"]',
      popover: {
        title: "Evidence per research question",
        description: "Traffic lights show the evidence verdict per RQ: 🟢 Evidence found / 🟡 Mixed / 🔴 No evidence.",
        side: "bottom",
      },
    },
    {
      element: '[data-tour="result-card"]',
      popover: {
        title: "Expand a result",
        description: "Each card shows the test name, p-value, effect size, confidence interval, and AI interpretation. Click ↺ Re-run to redo a single test.",
        side: "left",
      },
    },
  ],
  7: [
    {
      element: '[data-tour="generate-report"]',
      popover: {
        title: "Generate your report",
        description: "Choose a template (Donor, Internal, Academic, Policy) and click Generate. The AI drafts all sections in about 2 minutes.",
        side: "bottom",
      },
    },
    {
      element: '[data-tour="share-link"]',
      popover: {
        title: "Share with stakeholders",
        description: "Generate a read-only share link that anyone can view — no login required. Valid for 30 days.",
        side: "top",
      },
    },
  ],
};

export function useOnboardingTour(step: number, isFirstProject: boolean) {
  const driverRef = useRef<ReturnType<typeof import("driver.js")["driver"]> | null>(null);
  const hasRun = useRef(false);

  const runTour = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!isFirstProject) return;
    if (localStorage.getItem(`${TOUR_COMPLETED_KEY}_step${step}`)) return;
    if (hasRun.current) return;

    const steps = STEP_TOURS[step];
    if (!steps || steps.length === 0) return;

    // Delay to let the page render
    await new Promise((r) => setTimeout(r, 800));

    // Dynamic import to avoid SSR issues
    const { driver } = await import("driver.js");
    try { await import("driver.js/dist/driver.css" as never); } catch { /* CSS already loaded */ }

    const d = driver({
      showProgress: true,
      animate: true,
      overlayOpacity: 0.4,
      allowClose: true,
      doneBtnText: "Got it →",
      nextBtnText: "Next →",
      prevBtnText: "← Back",
      onDestroyed: () => {
        localStorage.setItem(`${TOUR_COMPLETED_KEY}_step${step}`, "1");
      },
      steps: steps.map((s) => ({
        element: s.element,
        popover: {
          ...s.popover,
          progressText: "{{current}} of {{total}}",
        },
      })),
    });

    driverRef.current = d;
    hasRun.current = true;
    d.drive();
  }, [step, isFirstProject]);

  useEffect(() => {
    runTour();
    return () => {
      driverRef.current?.destroy();
    };
  }, [runTour]);

  /** Force-restart the tour (e.g. from a "Show tour" button) */
  const restartTour = useCallback(async () => {
    localStorage.removeItem(`${TOUR_COMPLETED_KEY}_step${step}`);
    hasRun.current = false;
    await runTour();
  }, [step, runTour]);

  return { restartTour };
}
