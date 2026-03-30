-- Migration 015: Add generate_cross_analysis task type
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'generate_cross_analysis';
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'export_zip';
