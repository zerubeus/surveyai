-- ============================================================================
-- SurveyAI Analyst — Migration 003: Storage Buckets + Storage RLS
-- Invariant D7: Storage paths include user_id/project_id. Storage RLS enforces this.
-- Invariant D1: Original uploaded file lives in uploads/ bucket forever.
-- ============================================================================

-- ============================================================================
-- CREATE STORAGE BUCKETS
-- ============================================================================

-- uploads: Raw uploaded files (originals, NEVER modified — invariant D1)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  false,
  104857600,  -- 100MB limit
  ARRAY[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x-spss-sav',
    'application/x-stata-dta',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/xml',
    'text/xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);

-- datasets: Working copies of data (versioned, post-cleaning)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'datasets',
  'datasets',
  false,
  209715200,  -- 200MB limit
  ARRAY[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json',
    'application/x-parquet'
  ]
);

-- reports: Generated report files (DOCX, PDF, PPTX)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reports',
  'reports',
  false,
  52428800,  -- 50MB limit
  ARRAY[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/html'
  ]
);

-- charts: Generated chart images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'charts',
  'charts',
  false,
  10485760,  -- 10MB limit
  ARRAY[
    'image/png',
    'image/svg+xml',
    'image/jpeg',
    'application/json'
  ]
);

-- ============================================================================
-- STORAGE RLS POLICIES
-- Path convention: {user_id}/{project_id}/{filename}
-- Invariant D7: Storage paths include user_id/project_id
-- ============================================================================

-- --------------------------------------------------------------------------
-- UPLOADS BUCKET
-- --------------------------------------------------------------------------

-- Users can upload to their own path: {user_id}/{project_id}/*
CREATE POLICY "uploads_insert_own_path"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'uploads'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read files from projects in their org
CREATE POLICY "uploads_select_org_member"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'uploads'
    AND auth.uid() IS NOT NULL
    AND (
      -- Own uploads
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      -- Org member can access project uploads
      EXISTS (
        SELECT 1 FROM public.datasets d
        JOIN public.projects p ON p.id = d.project_id
        WHERE d.original_file_path = name
          AND public.is_org_member(p.organization_id)
      )
    )
  );

-- No updates to uploads (invariant D1: originals never modified)
-- No delete policy for uploads (originals are permanent)

-- --------------------------------------------------------------------------
-- DATASETS BUCKET
-- --------------------------------------------------------------------------

CREATE POLICY "datasets_insert_own_path"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'datasets'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "datasets_select_org_member"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'datasets'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      EXISTS (
        SELECT 1 FROM public.datasets d
        JOIN public.projects p ON p.id = d.project_id
        WHERE d.working_file_path = name
          AND public.is_org_member(p.organization_id)
      )
    )
  );

CREATE POLICY "datasets_update_own_path"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'datasets'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- --------------------------------------------------------------------------
-- REPORTS BUCKET
-- --------------------------------------------------------------------------

CREATE POLICY "reports_insert_own_path"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'reports'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reports_select_org_member"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'reports'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      EXISTS (
        SELECT 1 FROM public.report_exports re
        JOIN public.reports r ON r.id = re.report_id
        JOIN public.projects p ON p.id = r.project_id
        WHERE re.file_path = name
          AND public.is_org_member(p.organization_id)
      )
    )
  );

-- --------------------------------------------------------------------------
-- CHARTS BUCKET
-- --------------------------------------------------------------------------

CREATE POLICY "charts_insert_own_path"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'charts'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "charts_select_org_member"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'charts'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      EXISTS (
        SELECT 1 FROM public.charts c
        JOIN public.projects p ON p.id = c.project_id
        WHERE (c.file_path = name OR c.thumbnail_path = name)
          AND public.is_org_member(p.organization_id)
      )
    )
  );

CREATE POLICY "charts_update_own_path"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'charts'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
