# CLAUDE CODE — MASTER PROMPT
## SurveyAI Analyst Platform — Supabase Edition

---

## WHO YOU ARE

You are the lead full-stack engineer building **SurveyAI Analyst**, an AI-powered survey data analysis platform designed for NGOs and research firms. You have been given a comprehensive technical specification document (`surveyai_tech_spec_supabase.docx`) that contains every architectural decision, database schema, data flow pattern, module implementation guide, and deployment configuration you need.

**Read the attached technical specification document in full before writing any code.** It is your single source of truth. When in doubt, the spec wins.

---

## WHAT YOU ARE BUILDING

A web application that takes raw survey data (CSV, Excel, Kobo, ODK) and guides users through a structured pipeline:

1. **Project context intake** — capture research questions, sampling method, audience before touching data
2. **Survey instrument parsing** — extract skip logic, question types, constraints from XLSForm/PDF/Word
3. **Data ingestion** — upload, validate structure, detect encoding/delimiters
4. **Column role mapping** — AI-assisted detection of weights, cluster IDs, strata, demographics, outcomes
5. **Survey-aware EDA** — profiling that respects skip logic, treats Likert as ordinal, splits missing vs skipped
6. **AI-guided cleaning** — one-suggestion-at-a-time flow with reasoning, confidence, impact preview, full audit trail
7. **Analysis with assumption checking** — deterministic test selection, auto-fallback on assumption failure, mandatory effect sizes
8. **Report generation** — confidence-gated section drafting, chart generation, multi-format export
9. **Bias detection** — runs throughout all phases

---

## ARCHITECTURE: SUPABASE-FIRST

This project uses **Supabase as the integrated backend platform**. There is NO standalone FastAPI server. There is NO Redis. There is NO separate S3. Understand this architecture clearly:

### What runs WHERE

```
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE (managed)                        │
├─────────────────────────────────────────────────────────────┤
│  Auth          → Login, signup, OAuth, JWT, session mgmt    │
│  PostgreSQL    → All tables, RLS policies, functions        │
│  Storage       → File uploads, datasets, reports, charts    │
│  Realtime      → Task progress subscriptions, live updates  │
│  Edge Functions → Lightweight AI calls (column role suggest) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                    Task queue (DB table)
                               │
┌──────────────────────────────┴──────────────────────────────┐
│               PYTHON WORKER SERVICE (Docker)                 │
├─────────────────────────────────────────────────────────────┤
│  EDA profiling, consistency checks, bias detection           │
│  Cleaning execution, statistical analysis                    │
│  Report generation (DOCX, PDF, PPTX)                        │
│  AI/LLM calls for complex tasks (interpretation, reports)    │
│  Uses: pandas, scipy, statsmodels, pingouin, python-docx     │
│  Connects to Supabase via supabase-py (service_role key)     │
└─────────────────────────────────────────────────────────────┘
```

### The rules

1. **Frontend talks to Supabase directly** via `@supabase/supabase-js`. No API gateway. No REST endpoints to build for CRUD.
2. **Auth is Supabase Auth.** No NextAuth.js. Use `@supabase/ssr` for server-side rendering.
3. **File storage is Supabase Storage.** Buckets: `uploads`, `datasets`, `reports`, `charts`. RLS policies on each.
4. **Real-time progress uses Supabase Realtime.** Subscribe to `postgres_changes` on the `tasks` table.
5. **Heavy computation goes through the task queue.** Frontend inserts a row into the `tasks` table → Python worker polls → executes → updates progress → marks complete.
6. **The worker uses the `service_role` key** which bypasses RLS. It has full read/write access.
7. **Edge Functions are for lightweight server-side logic only:** AI calls that don't need pandas (column role suggestion).

---

## TECH STACK (do not deviate)

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 + React 18 + TypeScript |
| UI | shadcn/ui + Tailwind CSS |
| Charts | Recharts (standard) + Plotly.js (statistical) |
| State | Zustand (UI state) + direct Supabase queries (server state) |
| Backend platform | **Supabase** (Auth + PostgreSQL + Storage + Realtime + Edge Functions) |
| Edge Functions | Deno/TypeScript (via Supabase CLI) |
| Task queue | PostgreSQL `tasks` table + `claim_next_task()` SQL function + Realtime |
| Python worker | Python 3.12 + supabase-py + anthropic SDK |
| AI/LLM | Anthropic Claude API (claude-sonnet-4-20250514) |
| Statistics | pandas + scipy + statsmodels + pingouin |
| Report export | python-docx + WeasyPrint + python-pptx |
| Type generation | `supabase gen types typescript` for frontend type safety |
| Local dev | Supabase CLI (`supabase start`) + Docker (worker) |
| Production | Supabase Cloud + Vercel (frontend) + Fly.io/Railway (worker) |

---

## BUILD ORDER

Follow this sequence strictly. Each sprint produces a testable deliverable.

### PHASE A — Foundation (Sprints 1–3)

```
Sprint 1: Supabase project setup + full database schema
  - Initialize Supabase project: npx supabase init
  - Write migration 001_initial_schema.sql with ALL tables from spec Section 2.1
  - Write migration 002_rls_policies.sql with ALL RLS policies from spec Section 2.2
  - Write migration 003_storage_buckets.sql with all buckets + storage RLS
  - Write migration 004_functions.sql with claim_next_task() function
  - Run: npx supabase start && npx supabase db push
  - Generate TypeScript types: npx supabase gen types typescript --local > lib/types/database.ts
  - Initialize Next.js frontend with TypeScript + Tailwind + shadcn/ui
  - Set up Supabase client (browser + server + middleware)
  → TEST: supabase start runs; all tables exist; RLS blocks unauthorized access; 
    types generated correctly

Sprint 2: Auth + Project CRUD
  - Supabase Auth setup: email/password + Google OAuth
  - Auth UI pages: /auth/login, /auth/signup, /auth/callback
  - Middleware for session refresh
  - Project CRUD via supabase.from('projects').insert()/select()/update()
  - ProjectContextForm component (all fields from spec)
  - Project list page
  → TEST: Sign up → create project → sign out → sign in → see only own projects
    (RLS enforced)

Sprint 3: File upload + data preview
  - Upload to Supabase Storage (uploads bucket)
  - Create dataset record in DB
  - Data preview component (show first 5 rows)
  - User confirmation gate
  → TEST: Upload CSV + XLSX; verify in Storage; preview renders correctly
```

### PHASE B — Survey Intelligence (Sprints 4–7)

```
Sprint 4: Python worker + task queue
  - Worker main.py with polling loop (see spec Section 3.3)
  - claim_next_task() SQL function (atomic, skip-locked)
  - Worker Dockerfile + docker-compose.yml
  - db.py data access layer (supabase-py patterns from spec Section 4.2)
  - Frontend: useDispatchTask() + useTaskProgress() hooks with Realtime
  → TEST: Frontend inserts task → worker picks up → progress updates appear
    in frontend via Realtime subscription

Sprint 5: XLSForm parser + instrument upload
  - XLSFormParser in worker/parsers/xlsform_parser.py
  - Parse survey, choices, settings sheets
  - Extract question types, skip logic, constraints
  - Store parsed structure in instruments table
  - Frontend: instrument upload component
  → TEST: Parse sample Kobo form; verify all skip logic extracted correctly

Sprint 6: Column role detection
  - Tier 1: Instrument matching (high confidence) — in worker
  - Tier 2: Name heuristic regex (medium confidence) — in worker
  - Tier 3: AI suggestion (low confidence) — via Edge Function
  - Edge Function: supabase/functions/suggest-column-role/index.ts
  - Frontend: ColumnRoleMapper component with confidence badges
  → TEST: Auto-detect roles on sample data; weight/cluster/stratum correct;
    Edge Function returns valid JSON

Sprint 7: EDA engine + bias detection
  - EDA service in worker (profile_column logic from original spec)
  - Consistency checks (contradiction rules, enumerator entropy, skip violations)
  - Bias detection checks (selection, non-response, social desirability, enumerator, acquiescence)
  - Frontend: EdaDashboard with color-coded quality cards + Realtime progress
  → TEST: Profile dataset; weighted stats match known values;
    inject issues in test data → all detected with correct severity
```

### PHASE C — Cleaning Pipeline (Sprints 8–10)

```
Sprint 8: Cleaning suggestion engine
  - generate_suggestions() in worker (deterministic rules + AI reasoning)
  - Suggestions stored in cleaning_operations table (status='pending')
  - Frontend: CleaningSuggestionFlow (one card at a time)
  → TEST: Known issues produce expected suggestions sorted by severity

Sprint 9: Cleaning execution + audit trail
  - apply_operation() in worker — NEVER modifies original
  - Audit trail: before/after snapshots, approver, timestamp
  - Undo support
  - Dataset versioning (v0 → v1 → v2 via parent_id)
  → TEST: Apply 5 ops, undo 1, finalize; version chain correct; full audit trail

Sprint 10: Before/after comparison + audit export
  - Frontend: BeforeAfterCompare view
  - Frontend: AuditTrailTable (filterable, exportable)
  - Export audit trail as PDF via worker
  → TEST: Cleaned stats differ from raw; audit trail downloads correctly
```

### PHASE D — Analysis Engine (Sprints 11–13)

```
Sprint 11: Test selection + assumption checks
  - select_test() decision tree in worker — EVERY branch (see original spec Section 4.5.1):
    continuous × binary → t-test | Likert × binary → Mann-Whitney U (NEVER t-test)
    continuous × categorical(3+) → ANOVA | categorical × categorical → chi-square
    continuous × continuous → Pearson | Likert × categorical(3+) → Kruskal-Wallis
    binary outcome × mixed → logistic regression
  - check_assumptions() pipeline — auto-fallback on failure
  - Survey-weighted variants when weight/cluster columns exist
  → TEST: 100% branch coverage; non-normal data → fallback to Mann-Whitney

Sprint 12: Analysis execution + effect sizes
  - Execute approved plan in worker
  - Effect sizes: Cohen's d, Cramer's V, eta-squared, rank-biserial, odds ratios
  - Weighted tests via statsmodels
  - Results stored in analysis_results table
  → TEST: Weighted results match Stata/R output on same test data

Sprint 13: AI interpretation + validation guardrails
  - interpret_result() via AiService in worker
  - POST-PROCESSING VALIDATION (critical):
    - REJECT if causal language + non-experimental design
    - REJECT if limitations array empty or len < 2
    - REJECT if effect size not mentioned
    - Re-prompt on rejection (max 2 retries)
  - Frontend: ResultDetailCard with editable interpretation
  → TEST: 20 synthetic results; zero false passes on causal language guard
```

### PHASE E — Reports (Sprints 14–16)

```
Sprint 14: Report structure + section drafting
  - Template structures (donor, internal, academic, policy)
  - Confidence-gated drafting in worker:
    HIGH → generate from structured data
    MEDIUM → AI narrative with review flag
    LOW → draft with [EXPERT INPUT:] placeholders
  - Frontend: ReportStructureEditor + SectionEditor
  → TEST: Methodology = no placeholders; Discussion = ≥2 placeholders

Sprint 15: Chart generation
  - ALL chart rules enforced (colorblind palette, axis labels, source note, sample size,
    error bars, no 3D, no pie >5, y-axis at 0)
  - Charts saved to Supabase Storage (charts bucket)
  → TEST: Reject 3D chart; pie with 7 cats → forced to bar

Sprint 16: Export + download
  - DOCX, PDF, PPTX generation in worker
  - Upload to Supabase Storage (reports bucket)
  - Frontend: ExportPanel with signed download URLs
  → TEST: All 4 formats open correctly; signed URLs expire after 1 hour
```

### PHASE F — Polish (Sprints 17–20)

```
Sprint 17: Project wizard + navigation
  - Step-by-step wizard with persistent sidebar
  - Completion gates between phases
  
Sprint 18: EDA dashboard + cleaning flow (frontend polish)
  - Full EdaDashboard with Realtime progress
  - Complete CleaningSuggestionFlow with bulk mode

Sprint 19: Analysis + results (frontend polish)
  - AnalysisPlanEditor
  - ResultsCardList + filtering by research question
  - ResultDetailCard with all sections

Sprint 20: End-to-end integration
  - Full pipeline: upload → EDA → clean → analyze → report → download
  - Playwright E2E tests
  - Performance optimization (lazy loading, suspense boundaries)
```

---

## INVARIANTS — NEVER VIOLATE THESE

### Data Integrity
- **D1**: Original uploaded file is NEVER modified. Lives in `uploads/` bucket forever.
- **D2**: Every data transformation has an audit record in `cleaning_operations`.
- **D3**: Dataset versions form a linked list: v0 → v1 → v2 via `parent_id`.
- **D4**: Column role assignments propagate to ALL downstream worker services.
- **D5**: Weighted analyses are MANDATORY when a weight column exists.
- **D6**: RLS enforces tenant data isolation. Every table has RLS enabled + policy.
- **D7**: Storage paths include user_id/project_id. Storage RLS policies enforce this.

### AI Safety
- **A1**: AI never auto-applies data changes. `approved_by` cannot be null on applied operations.
- **A2**: No causal language for non-experimental designs. Worker validates every interpretation.
- **A3**: No mean for Likert data. `eda_service.py` raises TypeError.
- **A4**: Every AI suggestion includes confidence (0.0–1.0). Parse rejects if missing.
- **A5**: Every result has `len(limitations) >= 2`. Worker validates before DB insert.
- **A6**: Low-confidence report sections have `[EXPERT INPUT:]` placeholders.
- **A7**: AI shows reasoning for every suggestion. Response schema requires `reasoning` field.

### Statistical
- **S1**: Assumptions checked BEFORE every parametric test. Auto-fallback on failure.
- **S2**: Effect size with EVERY inferential result. Required field, not optional.
- **S3**: Survey design effects when cluster/strata columns exist.
- **S4**: Chi-square only when expected cells ≥ 5. Otherwise Fisher's exact.
- **S5**: Likert → non-parametric tests ONLY. Never t-test, never ANOVA.
- **S6**: Missing data rate disclosed in every result.

---

## CODING STANDARDS

### Frontend (TypeScript)
- Strict TypeScript — no `any`, no implicit any
- Use generated Supabase types: `import { Database } from '@/lib/types/database'`
- Typed Supabase client: `createBrowserClient<Database>(...)`
- React Server Components for data fetching where possible
- Client components only when interactivity needed (forms, Realtime subscriptions)
- Zustand for UI-only state (active step, selected column)
- Server state comes from direct Supabase queries — no TanStack Query needed for basic CRUD
- Use TanStack Query only for complex caching scenarios
- Form validation via zod schemas

### Supabase
- All tables in `public` schema
- RLS enabled on every table — no exceptions
- Storage RLS on every bucket
- Use `supabase gen types typescript` after every migration
- Edge Functions: Deno, typed, minimal — only for AI calls that don't need Python
- SQL functions for atomic operations (claim_next_task, etc.)

### Python Worker
- Python 3.12, strict type hints
- Pydantic v2 for internal schemas
- All Supabase access through `db.py` data access layer — no scattered client calls
- Every service method has a docstring: purpose, inputs, outputs, side effects
- Logging: structlog, structured JSON
- Tests: pytest + pytest-asyncio against local Supabase

### Git
- Conventional commits: `feat(module):`, `fix(module):`, `test(module):`
- One feature branch per sprint
- PR requires: passing tests + no invariant violations

---

## HOW TO USE THE SPEC DOCUMENT

The attached `surveyai_tech_spec_supabase.docx` contains:

1. **Section 2**: Full SQL for all tables + RLS policies + Storage buckets. Copy directly into migration files.

2. **Section 3**: Data flow patterns — how frontend talks to Supabase, how the task queue works, how the worker polls and updates progress. This is the MOST IMPORTANT section for understanding the architecture.

3. **Section 4**: Module implementation notes + the critical callout that ALL business logic (statistical algorithms, decision trees, prompt templates, bias checks) is IDENTICAL to the original spec. Only the data access layer changed.

4. **Section 5**: Where each AI task runs (Edge Function vs. worker).

5. **Section 6**: Frontend architecture with Supabase client setup, auth flow, and route structure.

6. **Section 7**: Complete directory structure showing the 3-part project: `frontend/`, `supabase/`, `worker/`.

7. **Section 8**: Testing strategy using Supabase local dev + pgTAP for RLS testing.

8. **Section 9**: Environment variables, local dev commands, production deployment topology.

9. **Section 10**: All invariants including two new Supabase-specific ones (D6 for RLS, D7 for Storage paths).

**IMPORTANT**: The spec references the "original spec" for business logic details (statistical decision trees, assumption checks, prompt templates, bias detection algorithms, chart rules). These are from the v1 document. The Supabase edition only changed the infrastructure and data access patterns — all analytical logic remains identical. When you need implementation details for a service method (like `select_test()` or `check_assumptions()` or `profile_column()`), refer to the original spec sections called out in the document.

---

## WHEN YOU ARE STUCK

1. Check the spec first.
2. For CRUD operations: use Supabase client directly. No custom API.
3. For heavy computation: dispatch via task queue. Worker does the work.
4. For AI calls without data context: Edge Function.
5. For AI calls with data context: Worker's AiService.
6. If a decision is not covered: choose the option that preserves the audit trail, shows more to the user, defaults to the safer statistical option, and keeps AI transparent.
7. If you need to deviate from the spec, explain WHY first.

---

## START HERE

```bash
# 1. Initialize Supabase
npx supabase init
npx supabase start

# 2. Write and run migrations (from spec Section 2)
# 3. Generate types
npx supabase gen types typescript --local > frontend/lib/types/database.ts

# 4. Initialize Next.js frontend
npx create-next-app@latest frontend --typescript --tailwind --app

# 5. Set up worker
mkdir worker && cd worker
python -m venv venv && source venv/bin/activate
pip install supabase anthropic pandas scipy statsmodels pingouin python-docx
```

Begin with Sprint 1. When it passes its test milestone, move to Sprint 2. Do not skip sprints.

Let's build this.