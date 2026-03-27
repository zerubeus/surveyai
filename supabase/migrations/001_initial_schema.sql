-- ============================================================================
-- SurveyAI Analyst — Migration 001: Initial Schema
-- All tables in public schema with RLS enabled (policies in 002)
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE public.organization_role AS ENUM ('owner', 'admin', 'analyst', 'viewer');
CREATE TYPE public.project_status AS ENUM ('draft', 'context_set', 'instrument_uploaded', 'data_uploaded', 'roles_mapped', 'eda_complete', 'cleaning_complete', 'analysis_complete', 'report_complete');
CREATE TYPE public.sampling_method AS ENUM ('simple_random', 'stratified', 'cluster', 'multi_stage', 'convenience', 'purposive', 'snowball', 'quota', 'systematic', 'other');
CREATE TYPE public.study_design AS ENUM ('cross_sectional', 'longitudinal', 'experimental', 'quasi_experimental', 'pre_post', 'cohort', 'case_control', 'other');
CREATE TYPE public.dataset_status AS ENUM ('uploading', 'uploaded', 'previewed', 'confirmed', 'profiled', 'cleaning', 'cleaned', 'analyzed');
CREATE TYPE public.column_role AS ENUM ('identifier', 'weight', 'cluster_id', 'stratum', 'demographic', 'outcome', 'covariate', 'skip_logic', 'metadata', 'open_text', 'ignore');
CREATE TYPE public.column_data_type AS ENUM ('continuous', 'categorical', 'binary', 'ordinal', 'likert', 'date', 'text', 'identifier');
CREATE TYPE public.confidence_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE public.task_status AS ENUM ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE public.task_type AS ENUM (
  'parse_instrument', 'detect_column_roles', 'run_eda', 'run_consistency_checks',
  'run_bias_detection', 'generate_cleaning_suggestions', 'apply_cleaning_operation',
  'run_analysis', 'interpret_results', 'generate_report_section', 'generate_chart',
  'export_report', 'export_audit_trail'
);
CREATE TYPE public.cleaning_op_status AS ENUM ('pending', 'approved', 'applied', 'rejected', 'undone');
CREATE TYPE public.cleaning_op_type AS ENUM (
  'remove_duplicates', 'fix_encoding', 'standardize_missing', 'recode_values',
  'fix_outlier', 'impute_value', 'drop_column', 'rename_column', 'split_column',
  'merge_columns', 'fix_data_type', 'fix_skip_logic', 'custom'
);
CREATE TYPE public.severity_level AS ENUM ('critical', 'warning', 'info');
CREATE TYPE public.bias_type AS ENUM (
  'selection_bias', 'non_response_bias', 'social_desirability_bias',
  'enumerator_bias', 'acquiescence_bias', 'measurement_bias', 'recall_bias'
);
CREATE TYPE public.analysis_status AS ENUM ('planned', 'approved', 'running', 'completed', 'failed');
CREATE TYPE public.report_template AS ENUM ('donor', 'internal', 'academic', 'policy');
CREATE TYPE public.report_section_status AS ENUM ('pending', 'drafted', 'review_needed', 'approved', 'finalized');
CREATE TYPE public.export_format AS ENUM ('docx', 'pdf', 'pptx', 'html');

-- ============================================================================
-- ORGANIZATIONS
-- ============================================================================

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ORGANIZATION MEMBERS (join table)
-- ============================================================================

CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.organization_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PROJECTS
-- ============================================================================

CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  status public.project_status NOT NULL DEFAULT 'draft',

  -- Context fields (Phase 1: project context intake)
  research_questions JSONB DEFAULT '[]'::jsonb,        -- array of {id, text, type}
  sampling_method public.sampling_method,
  study_design public.study_design,
  target_population TEXT,
  sample_size_planned INTEGER,
  geographic_scope TEXT,
  data_collection_start DATE,
  data_collection_end DATE,
  ethical_approval TEXT,
  funding_source TEXT,
  additional_context TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Index for org-level queries
CREATE INDEX idx_projects_organization_id ON public.projects(organization_id);
CREATE INDEX idx_projects_created_by ON public.projects(created_by);

-- ============================================================================
-- INSTRUMENTS (survey forms / questionnaires)
-- ============================================================================

CREATE TABLE public.instruments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,                            -- path in Supabase Storage
  file_type TEXT NOT NULL,                            -- xlsform, pdf, docx, odk
  parsed_structure JSONB,                             -- full parsed instrument
  questions JSONB DEFAULT '[]'::jsonb,                -- array of parsed questions
  skip_logic JSONB DEFAULT '[]'::jsonb,               -- array of skip logic rules
  choice_lists JSONB DEFAULT '{}'::jsonb,             -- choice list definitions
  settings JSONB DEFAULT '{}',                        -- instrument settings
  parse_status TEXT DEFAULT 'pending',                -- pending, parsing, parsed, failed
  parse_errors JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_instruments_project_id ON public.instruments(project_id);

-- ============================================================================
-- DATASETS
-- ============================================================================

CREATE TABLE public.datasets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.datasets(id),      -- for versioning: v0 → v1 → v2
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  status public.dataset_status NOT NULL DEFAULT 'uploading',

  -- File info
  original_file_path TEXT NOT NULL,                    -- path in uploads bucket (NEVER modified)
  working_file_path TEXT,                              -- path in datasets bucket (current version)
  file_type TEXT NOT NULL,                             -- csv, xlsx, sav, dta
  file_size_bytes BIGINT,
  encoding TEXT DEFAULT 'utf-8',
  delimiter TEXT DEFAULT ',',

  -- Schema info (populated after preview/confirm)
  row_count INTEGER,
  column_count INTEGER,
  columns JSONB DEFAULT '[]'::jsonb,                   -- array of {name, detected_type, sample_values}
  preview_data JSONB,                                  -- first N rows for preview

  -- Metadata
  is_current BOOLEAN NOT NULL DEFAULT true,            -- only latest version is current
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES auth.users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_datasets_project_id ON public.datasets(project_id);
CREATE INDEX idx_datasets_parent_id ON public.datasets(parent_id);
CREATE INDEX idx_datasets_is_current ON public.datasets(project_id, is_current) WHERE is_current = true;

-- ============================================================================
-- COLUMN MAPPINGS (role assignments per column per dataset)
-- ============================================================================

CREATE TABLE public.column_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  column_index INTEGER NOT NULL,

  -- Role assignment
  role public.column_role,
  data_type public.column_data_type,
  is_likert BOOLEAN DEFAULT false,
  likert_scale_min INTEGER,
  likert_scale_max INTEGER,

  -- Detection provenance
  detection_method TEXT,                               -- 'instrument_match', 'heuristic', 'ai_suggestion', 'manual'
  detection_confidence NUMERIC(3,2) CHECK (detection_confidence >= 0 AND detection_confidence <= 1),
  ai_reasoning TEXT,
  confirmed_by UUID REFERENCES auth.users(id),
  confirmed_at TIMESTAMPTZ,

  -- Linked instrument question (if matched)
  instrument_question_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dataset_id, column_name)
);

ALTER TABLE public.column_mappings ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_column_mappings_dataset_id ON public.column_mappings(dataset_id);

-- ============================================================================
-- EDA RESULTS
-- ============================================================================

CREATE TABLE public.eda_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  column_name TEXT,                                    -- null for dataset-level results
  result_type TEXT NOT NULL,                           -- 'column_profile', 'consistency_check', 'bias_check', 'dataset_summary'

  -- Profile data
  profile JSONB,                                       -- full column profile (stats, distribution, missing analysis)
  quality_score NUMERIC(5,2),                          -- 0-100
  issues JSONB DEFAULT '[]'::jsonb,                    -- array of {type, severity, description, details}

  -- Bias detection
  bias_type public.bias_type,
  bias_severity public.severity_level,
  bias_evidence JSONB,
  bias_recommendation TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.eda_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_eda_results_dataset_id ON public.eda_results(dataset_id);
CREATE INDEX idx_eda_results_type ON public.eda_results(dataset_id, result_type);

-- ============================================================================
-- CLEANING OPERATIONS
-- ============================================================================

CREATE TABLE public.cleaning_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  operation_type public.cleaning_op_type NOT NULL,
  status public.cleaning_op_status NOT NULL DEFAULT 'pending',
  severity public.severity_level NOT NULL DEFAULT 'info',
  priority INTEGER NOT NULL DEFAULT 0,                 -- higher = more urgent

  -- Operation details
  column_name TEXT,
  description TEXT NOT NULL,
  reasoning TEXT NOT NULL,                             -- AI reasoning (invariant A7)
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1), -- invariant A4

  -- Parameters for execution
  parameters JSONB NOT NULL DEFAULT '{}',              -- operation-specific params
  affected_rows_estimate INTEGER,
  impact_preview JSONB,                                -- before/after preview

  -- Approval & execution
  approved_by UUID REFERENCES auth.users(id),          -- invariant A1: cannot be null when applied
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  undone_at TIMESTAMPTZ,
  undone_by UUID REFERENCES auth.users(id),

  -- Audit trail
  before_snapshot JSONB,                               -- affected data before operation
  after_snapshot JSONB,                                -- affected data after operation
  resulting_dataset_id UUID REFERENCES public.datasets(id), -- the new dataset version

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce invariant A1: approved_by must be set when status is 'applied'
  CONSTRAINT chk_approved_when_applied CHECK (
    status != 'applied' OR approved_by IS NOT NULL
  )
);

ALTER TABLE public.cleaning_operations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_cleaning_ops_dataset_id ON public.cleaning_operations(dataset_id);
CREATE INDEX idx_cleaning_ops_status ON public.cleaning_operations(dataset_id, status);

-- ============================================================================
-- TASKS (queue for Python worker)
-- ============================================================================

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_type public.task_type NOT NULL,
  status public.task_status NOT NULL DEFAULT 'pending',

  -- Input/output
  payload JSONB NOT NULL DEFAULT '{}',                 -- input parameters
  result JSONB,                                        -- output data
  error TEXT,                                          -- error message if failed

  -- Progress tracking (for Realtime subscriptions)
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  progress_message TEXT,

  -- Worker tracking
  claimed_by TEXT,                                     -- worker instance ID
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Ownership
  created_by UUID NOT NULL REFERENCES auth.users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_tasks_project_id ON public.tasks(project_id);
CREATE INDEX idx_tasks_status ON public.tasks(status) WHERE status IN ('pending', 'claimed', 'running');
CREATE INDEX idx_tasks_type_status ON public.tasks(task_type, status);

-- ============================================================================
-- ANALYSIS PLANS
-- ============================================================================

CREATE TABLE public.analysis_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),

  -- Plan details
  research_question_id TEXT,                           -- links to projects.research_questions[].id
  research_question_text TEXT,
  dependent_variable TEXT NOT NULL,
  independent_variable TEXT NOT NULL,
  control_variables JSONB DEFAULT '[]'::jsonb,

  -- Test selection (deterministic decision tree)
  selected_test TEXT NOT NULL,                         -- e.g. 'independent_t_test', 'mann_whitney_u'
  test_rationale TEXT NOT NULL,                        -- why this test was selected
  fallback_test TEXT,                                  -- used if assumptions fail
  assumptions_checked JSONB DEFAULT '[]'::jsonb,       -- array of {name, passed, details}
  assumptions_passed BOOLEAN,

  -- Survey design
  is_weighted BOOLEAN DEFAULT false,
  weight_column TEXT,
  cluster_column TEXT,
  stratum_column TEXT,

  -- Status
  status public.analysis_status NOT NULL DEFAULT 'planned',
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.analysis_plans ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_analysis_plans_project_id ON public.analysis_plans(project_id);
CREATE INDEX idx_analysis_plans_dataset_id ON public.analysis_plans(dataset_id);

-- ============================================================================
-- ANALYSIS RESULTS
-- ============================================================================

CREATE TABLE public.analysis_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES public.analysis_plans(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,

  -- Test results
  test_name TEXT NOT NULL,
  test_statistic NUMERIC,
  p_value NUMERIC,
  degrees_of_freedom NUMERIC,
  confidence_interval JSONB,                           -- {lower, upper, level}

  -- Effect size (invariant S2: required, not optional)
  effect_size_name TEXT NOT NULL,                       -- e.g. 'cohens_d', 'cramers_v', 'eta_squared'
  effect_size_value NUMERIC NOT NULL,
  effect_size_interpretation TEXT NOT NULL,             -- 'small', 'medium', 'large'

  -- Survey design effects (invariant S3)
  design_effect NUMERIC,
  effective_sample_size NUMERIC,

  -- Data quality
  sample_size INTEGER NOT NULL,
  missing_data_rate NUMERIC NOT NULL,                  -- invariant S6
  assumptions_met BOOLEAN NOT NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT false,

  -- AI interpretation
  interpretation TEXT,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,      -- invariant A5: len >= 2
  ai_confidence NUMERIC(3,2),
  interpretation_validated BOOLEAN DEFAULT false,

  -- Full output
  raw_output JSONB,                                    -- full statistical output

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce invariant A5: at least 2 limitations
  CONSTRAINT chk_limitations_min_2 CHECK (
    jsonb_array_length(limitations) >= 2 OR interpretation IS NULL
  )
);

ALTER TABLE public.analysis_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_analysis_results_plan_id ON public.analysis_results(plan_id);
CREATE INDEX idx_analysis_results_project_id ON public.analysis_results(project_id);

-- ============================================================================
-- REPORTS
-- ============================================================================

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  template public.report_template NOT NULL DEFAULT 'donor',
  status TEXT NOT NULL DEFAULT 'draft',                -- draft, generating, review, finalized

  -- Structure
  sections JSONB DEFAULT '[]'::jsonb,                  -- ordered array of section configs
  metadata JSONB DEFAULT '{}',                         -- report-level metadata

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_reports_project_id ON public.reports(project_id);

-- ============================================================================
-- REPORT SECTIONS
-- ============================================================================

CREATE TABLE public.report_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,                           -- e.g. 'executive_summary', 'methodology'
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Content
  content TEXT,                                        -- markdown content
  status public.report_section_status NOT NULL DEFAULT 'pending',
  confidence public.confidence_level,

  -- Confidence-gated drafting
  ai_generated BOOLEAN DEFAULT false,
  has_placeholders BOOLEAN DEFAULT false,              -- true if contains [EXPERT INPUT:] markers
  review_notes TEXT,

  -- Linked data
  linked_results JSONB DEFAULT '[]'::jsonb,            -- array of analysis_result IDs
  linked_charts JSONB DEFAULT '[]'::jsonb,             -- array of chart IDs

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_sections ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_report_sections_report_id ON public.report_sections(report_id);

-- ============================================================================
-- CHARTS
-- ============================================================================

CREATE TABLE public.charts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  analysis_result_id UUID REFERENCES public.analysis_results(id),
  created_by UUID NOT NULL REFERENCES auth.users(id),

  -- Chart config
  chart_type TEXT NOT NULL,                            -- bar, line, scatter, box, histogram, grouped_bar, stacked_bar
  title TEXT NOT NULL,
  subtitle TEXT,
  config JSONB NOT NULL DEFAULT '{}',                  -- full chart configuration
  data JSONB NOT NULL DEFAULT '{}',                    -- chart data

  -- Rendering
  file_path TEXT,                                      -- path in charts bucket
  thumbnail_path TEXT,

  -- Chart rules enforcement
  has_error_bars BOOLEAN DEFAULT false,
  has_source_note BOOLEAN DEFAULT false,
  has_sample_size BOOLEAN DEFAULT false,
  y_axis_starts_at_zero BOOLEAN DEFAULT true,
  is_colorblind_safe BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.charts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_charts_project_id ON public.charts(project_id);

-- ============================================================================
-- REPORT EXPORTS
-- ============================================================================

CREATE TABLE public.report_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  format public.export_format NOT NULL,
  file_path TEXT,                                      -- path in reports bucket
  file_size_bytes BIGINT,
  generated_by UUID NOT NULL REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,                              -- signed URL expiry

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_report_exports_report_id ON public.report_exports(report_id);

-- ============================================================================
-- AUDIT LOG (cross-cutting)
-- ============================================================================

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,                                -- e.g. 'cleaning_operation_applied', 'analysis_approved'
  entity_type TEXT NOT NULL,                           -- table name
  entity_id UUID NOT NULL,                             -- row ID
  details JSONB DEFAULT '{}',                          -- action-specific details
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_audit_log_project_id ON public.audit_log(project_id);
CREATE INDEX idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON public.audit_log(project_id, created_at DESC);

-- ============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables that have updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.instruments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.column_mappings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.cleaning_operations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.analysis_plans FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.analysis_results FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.report_sections FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.charts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
