-- ============================================================================
-- 013_audit_log.sql — Audit trail for data access events
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,         -- 'dataset_download', 'report_export', 'report_share_view', 'project_delete', 'analysis_run'
  resource_type TEXT NOT NULL,         -- 'dataset', 'report', 'project', 'analysis'
  resource_id   UUID,
  project_id    UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  metadata      JSONB DEFAULT '{}',    -- e.g. file format, share token, IP
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_project_id ON public.audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action, created_at DESC);

-- RLS: users can only read their own audit logs; service role can write all
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_own_read"
  ON public.audit_log FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT policy for auth users — only service role (worker) writes audit logs
