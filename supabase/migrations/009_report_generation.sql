-- ============================================================================
-- SurveyAI Analyst — Migration 009: Report Generation Support
-- Adds generate_report task type, enables Realtime on report tables
-- ============================================================================

-- Add generate_report to the task_type enum
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'generate_report' AFTER 'interpret_results';

-- Enable Realtime on report-related tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;
ALTER PUBLICATION supabase_realtime ADD TABLE public.report_sections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.report_exports;
