-- Sprint 7: Enhance eda_results for quality dashboard + AI interpretation

-- Add column_role and data_type for direct querying (mirrors column_mappings)
ALTER TABLE public.eda_results ADD COLUMN IF NOT EXISTS column_role public.column_role;
ALTER TABLE public.eda_results ADD COLUMN IF NOT EXISTS data_type public.column_data_type;

-- AI interpretation stored per-dataset (result_type = 'interpretation')
ALTER TABLE public.eda_results ADD COLUMN IF NOT EXISTS interpretation JSONB;

-- Enable Realtime for eda_results — live streaming to QualityDashboard
ALTER PUBLICATION supabase_realtime ADD TABLE public.eda_results;

-- Add missing columns that worker requires
ALTER TABLE public.eda_results 
  ADD COLUMN IF NOT EXISTS column_role text,
  ADD COLUMN IF NOT EXISTS data_type text,
  ADD COLUMN IF NOT EXISTS interpretation jsonb;

-- Add generate_analysis_plan to task_type enum (was missing from original schema)
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'generate_analysis_plan';
