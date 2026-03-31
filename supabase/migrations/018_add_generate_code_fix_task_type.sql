-- Add generate_code_fix task type for AI-generated pandas code custom fixes
ALTER TYPE public.tasks_task_type ADD VALUE IF NOT EXISTS 'generate_code_fix';
