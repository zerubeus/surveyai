# Chisquare — Advanced Analytics + UI Improvements

## Context
Chisquare has a Python worker at `/root/projects/surveyai/worker/` and a Next.js frontend at `/root/projects/surveyai/frontend/`.

Current analysis tests available: t_test, mann_whitney, anova, kruskal_wallis, chi_square, fishers_exact, pearson, spearman, logistic_regression.

Branch: `sprint-11`

---

## TASK 1: Backend — Expand analytics in the worker

### Files to modify:
- `/root/projects/surveyai/worker/services/analysis_planner.py`
- `/root/projects/surveyai/worker/services/analysis_executor.py`

### New test types to add:

1. **linear_regression** — OLS multiple linear regression via statsmodels. Return: coefficients with 95% CI, p-values, SE, R², Adjusted R², F-statistic, Durbin-Watson. Support multiple independent variables using `control_variables` from the plan as covariates alongside `independent_variable`.

2. **point_biserial** — correlation between binary (0/1) and continuous variable via scipy.stats.pointbiserialr. Return: r, p-value, n.

3. **kendall_tau** — rank correlation via scipy.stats.kendalltau. Return: tau, p-value.

4. **welchs_t** — Welch t-test via scipy.stats.ttest_ind(equal_var=False). Return: t, p, df, mean1, mean2.

5. **moderation_analysis** — OLS with interaction term X*Z predicting Y. Return: main effects, interaction coefficient, p-value, R². Label this as "moderation test".

6. **mediation_analysis** — Sobel test for X→M→Y mediation. Return: a-path, b-path, Sobel z-score, p-value, indirect effect.

### Changes required:

In `analysis_planner.py`:
- Add all new test names to `VALID_TEST_TYPES`
- Add linear_regression, moderation_analysis to guidance rules in the AI prompt:
  - "For continuous outcome with multiple predictors: linear_regression"
  - "For testing if Z moderates X→Y: moderation_analysis"
  - "For testing X→M→Y indirect effect: mediation_analysis"
  - "For binary+continuous correlation: point_biserial"
  - "For rank correlation alternative: kendall_tau"

In `analysis_executor.py`:
- Add `_run_linear_regression(df, dep_var, indep_var, control_vars)` using statsmodels OLS
- Add `_run_moderation(df, dep_var, indep_var, moderator)` using OLS with interaction
- Add `_run_mediation(df, dep_var, mediator, indep_var)` using Sobel test formula
- Add to `_execute_test()` dispatcher for each new type
- Add to `_compute_effect_size()`: f-squared for regression, r for point_biserial
- Make all results JSON-serializable using `_json_safe()`

---

## TASK 2: Frontend UX Improvements

### 2a. Step 5 — "View Results" CTA when analysis already ran

**File:** `/root/projects/surveyai/frontend/components/workflow/steps/Step5Analysis.tsx`

When ALL plans have `status === "completed"`, show a prominent CTA at the top of the analysis plan section:

```
✓ Analysis complete
[View Results →] button that navigates to /projects/{projectId}/step/6
```

Replace the confusing "0 of N approved or completed / Run Analysis (0)" UI with this when plans are all completed.

Detection: `const allCompleted = plans.length > 0 && plans.every(p => p.status === "completed")`

Show the CTA banner above the plan cards, and keep showing the cards below for reference (read-only, no approve buttons).

### 2b. Step 6 Results — Summary Insights panel

**File:** `/root/projects/surveyai/frontend/components/workflow/steps/Step6Results.tsx`

Add a "Summary Insights" card at the very top (before individual RQ results) that shows:
- Total significant results: count of results where `p_value < 0.05`
- Total non-significant: total - significant
- Traffic light per RQ group:
  - 🟢 green = at least one p < 0.05 in this RQ
  - 🟡 yellow = mixed (some significant, some not)  
  - 🔴 red = no significant results in this RQ
- For regression results (test_type === "linear_regression"): show a compact "Key Predictors" table with variable name, coefficient, p-value

Use existing Card, Badge components. Keep it compact — max 2 rows of stats.

### 2c. Dashboard — Step progress bar on project cards

**File:** `/root/projects/surveyai/frontend/components/projects/ProjectCard.tsx`
**Also check:** `/root/projects/surveyai/frontend/app/dashboard/page.tsx` — make sure `pipeline_status` and `current_step` are fetched in the projects query.

Add a mini progress indicator to each project card showing workflow progress:
- Fetch `pipeline_status` and `current_step` in the dashboard query (add to `.select("*")` if not already)
- In ProjectCard: count completed steps from `pipeline_status` object (steps with value "completed")
- Show: `"Step {current_step} of 7"` with a thin progress bar (use native div with width%)
- Style: small text, muted color, progress bar in brand color

---

## Rules
- Branch: sprint-11
- Keep TypeScript strict, no `any` unless absolutely needed
- Don't break existing passing tests or functionality
- Commit after each task: `git add -A && git commit -m "feat: ..."`
- Push after all commits: `git push origin sprint-11`

When completely done, run: `openclaw system event --text "Done: Advanced analytics + UI improvements" --mode now`
