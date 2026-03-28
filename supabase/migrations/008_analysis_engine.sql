-- ============================================================================
-- SurveyAI Analyst — Migration 008: Analysis Engine Support
-- Adds generate_analysis_plan task type, enables Realtime on analysis tables
-- ============================================================================

-- Add generate_analysis_plan to the task_type enum
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'generate_analysis_plan' AFTER 'apply_cleaning_operation';

-- Enable Realtime on analysis_plans
ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_plans;

-- Enable Realtime on analysis_results
ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_results;
