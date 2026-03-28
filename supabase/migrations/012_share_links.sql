-- ============================================================================
-- 012_share_links.sql — Read-only report share links
-- ============================================================================

-- Share tokens table: maps a short token to a report_id with optional expiry
CREATE TABLE IF NOT EXISTS public.report_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ,               -- NULL = never expires
  view_count    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_report_shares_token ON public.report_shares(token) WHERE is_active = TRUE;

-- RLS
ALTER TABLE public.report_shares ENABLE ROW LEVEL SECURITY;

-- Owners can manage their own shares
CREATE POLICY "share_owner_all"
  ON public.report_shares FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Public read-only access (no auth required) — only via the token lookup function below
-- We use a DB function so we can validate expiry and increment view_count atomically

-- Function: resolve_share_token(token) — returns report data for a valid, non-expired token
CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token TEXT)
RETURNS TABLE (
  share_id        UUID,
  report_id       UUID,
  report_name     TEXT,
  report_template TEXT,
  project_name    TEXT,
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN
) SECURITY DEFINER AS $$
BEGIN
  -- Increment view count and return share metadata
  UPDATE public.report_shares
  SET view_count = view_count + 1, updated_at = now()
  WHERE token = p_token
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > now());

  RETURN QUERY
  SELECT
    rs.id,
    rs.report_id,
    r.name,
    r.template,
    p.name,
    rs.expires_at,
    rs.is_active
  FROM public.report_shares rs
  JOIN public.reports r ON r.id = rs.report_id
  JOIN public.projects p ON p.id = r.project_id
  WHERE rs.token = p_token
    AND rs.is_active = TRUE
    AND (rs.expires_at IS NULL OR rs.expires_at > now());
END;
$$ LANGUAGE plpgsql;

-- Function to get sections for a shared report (no auth required)
CREATE OR REPLACE FUNCTION public.get_shared_report_sections(p_token TEXT)
RETURNS TABLE (
  section_key   TEXT,
  title         TEXT,
  content       TEXT,
  sort_order    INTEGER,
  confidence    TEXT
) SECURITY DEFINER AS $$
DECLARE
  v_report_id UUID;
BEGIN
  -- Validate token
  SELECT rs.report_id INTO v_report_id
  FROM public.report_shares rs
  WHERE rs.token = p_token
    AND rs.is_active = TRUE
    AND (rs.expires_at IS NULL OR rs.expires_at > now());

  IF v_report_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sec.section_key,
    sec.title,
    sec.content,
    sec.sort_order,
    sec.confidence
  FROM public.report_sections sec
  WHERE sec.report_id = v_report_id
  ORDER BY sec.sort_order ASC;
END;
$$ LANGUAGE plpgsql;
