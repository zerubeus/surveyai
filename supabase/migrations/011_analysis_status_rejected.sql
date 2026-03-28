-- ============================================================================
-- SurveyAI Analyst — Migration 011: Add 'rejected' to analysis_status enum
-- Allows users to explicitly reject AI-proposed analysis plans
-- ============================================================================

ALTER TYPE public.analysis_status ADD VALUE IF NOT EXISTS 'rejected' AFTER 'approved';
