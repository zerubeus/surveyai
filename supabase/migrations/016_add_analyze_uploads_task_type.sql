-- Add analyze_uploads task type for AI-powered project brief autofill
ALTER TYPE public.tasks_task_type ADD VALUE IF NOT EXISTS 'analyze_uploads';
