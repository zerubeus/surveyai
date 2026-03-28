-- Sprint 11: Add pipeline step tracking to projects
-- current_step tracks which step user is on (1-7)
-- pipeline_status tracks state of each step

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS current_step integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pipeline_status jsonb NOT NULL DEFAULT '{"1":"active","2":"locked","3":"locked","4":"locked","5":"locked","6":"locked","7":"locked"}'::jsonb;

-- Add constraint to keep current_step in valid range
ALTER TABLE projects
  ADD CONSTRAINT projects_current_step_range CHECK (current_step >= 1 AND current_step <= 7);
