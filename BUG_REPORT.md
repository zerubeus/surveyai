# SurveyAI Sprint 11 — Bug Report
Generated: 2026-03-28

## 🔴 BUG-01: Dashboard — Raw JSON in project description
**File:** `frontend/components/projects/ProjectCard.tsx`
**Issue:** The `description` field in DB is stored as a JSON string: `{"text":"...","tags":["KAP Study"]}`. The `ProjectCard` renders it directly without parsing, showing raw JSON to users.
**Fix:** Parse the description if it's valid JSON and extract `.text`. Optionally render tags as badges.

```tsx
// Current (broken)
{project.description && (
  <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
    {project.description}
  </p>
)}

// Fix: parse JSON description
const getDescriptionText = (desc: string | null) => {
  if (!desc) return null;
  try {
    const parsed = JSON.parse(desc);
    return parsed.text ?? desc;
  } catch {
    return desc;
  }
};
```

---

## 🔴 BUG-02: Step 5 — "Run Analysis" has no hint when disabled
**File:** `frontend/components/workflow/steps/Step5Analysis.tsx`
**Issue:** The "Run Analysis (0)" button is disabled when 0 RQs are approved, but there's no visual hint/tooltip telling the user they need to approve RQs first.
**Fix:** Add a helper text below the button: "Approve at least one research question above to run analysis". Also consider highlighting unapproved cards with a yellow border.

---

## 🟡 BUG-03: Step 3 — 24 inputs without accessible labels
**File:** `frontend/components/workflow/steps/Step3Columns.tsx` (or similar)
**Issue:** Column role dropdowns (select elements) have no associated `<label>` elements and no `aria-label` attributes. This breaks screen reader accessibility and is a WCAG violation.
**Fix:** Add `aria-label` to each role selector: `aria-label={`Role for column ${col.name}`}`

---

## 🟡 BUG-04: Step 1 — 5 inputs without accessible labels
**File:** `frontend/components/workflow/steps/Step1Form.tsx`
**Issue:** Research question inputs (text fields for RQ entries) lack `<label>` or `aria-label`.
**Fix:** Add `aria-label={`Research question ${index + 1}`}` to each dynamic input.

---

## 🟡 BUG-05: Login page — No visible H1 heading
**File:** `frontend/app/auth/login/page.tsx`
**Issue:** The CardTitle contains "SurveyAI Analyst" but it renders as a `<div>`, not an `<h1>`. The page has no semantic H1 for SEO and screen readers.
**Fix:** The CardTitle should render as `<h1>` on the login page. Either use `asChild` prop or add an explicit H1.

---

## 🟡 BUG-06: Step 6 — Results section showing unexpected content
**Current content visible:** "how is the business culture in the rural environment?" — this appears to be a research question being shown in an unexpected place, or a previous result from an unrelated analysis being shown without proper project scoping.
**File:** `frontend/components/workflow/steps/Step6Results.tsx` (or similar)
**Fix:** Verify that results are scoped to the current project. Check the `useAnalysisResults` hook for proper project_id filtering.

---

## 🟡 BUG-07: Dashboard — Project name has leading space
**Data:** `" Employee Wellness & Workplace Satisfaction Study"` — note the leading space in the name
**Fix:** Either trim in DB (data issue), or add `.trim()` in `ProjectCard` when rendering the title.

---

## 🔵 BUG-08: All pages — No sidebar/navigation
**Issue:** The app lacks a persistent sidebar or left-nav. Only a top header with "Sign out" is present. Dashboard is only accessible via hardcoded URL. Consider adding a simple sidebar with Dashboard, New Project links.

---

## 🔵 BUG-09: Mobile — Touch targets may be too small
**File:** Various component files
**Issue:** Multiple buttons have height < 36px on mobile. Minimum recommended touch target is 44px.
**Fix:** Ensure all interactive elements have `min-h-[44px]` on mobile, or use `h-10` (40px) as minimum.

---

## Task Breakdown for Claude Code

### TASK 1 (HIGH — 15 min)
Fix BUG-01: Parse JSON description in `ProjectCard.tsx`

### TASK 2 (HIGH — 10 min)
Fix BUG-02: Add disabled hint for "Run Analysis" button in `Step5Analysis.tsx`

### TASK 3 (MEDIUM — 20 min)
Fix BUG-03 + BUG-04: Add aria-labels to all unlabeled inputs in Step 1 and Step 3

### TASK 4 (MEDIUM — 5 min)
Fix BUG-05: H1 heading on login page

### TASK 5 (MEDIUM — 20 min)
Investigate BUG-06: Verify results scoping in Step 6

### TASK 6 (LOW — 5 min)
Fix BUG-07: Trim project name on display

---
Screenshots: /root/projects/surveyai/screenshots/
