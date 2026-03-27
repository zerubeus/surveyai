-- ============================================================================
-- SurveyAI Analyst — Migration 004: Database Functions
-- Task queue: claim_next_task() with atomic, skip-locked semantics
-- ============================================================================

-- ============================================================================
-- CLAIM_NEXT_TASK: Atomic task claiming for the Python worker
-- Uses FOR UPDATE SKIP LOCKED to prevent race conditions between workers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_next_task(
  p_worker_id TEXT,
  p_task_types public.task_type[] DEFAULT NULL
)
RETURNS TABLE (
  task_id UUID,
  task_type public.task_type,
  project_id UUID,
  payload JSONB
) AS $$
DECLARE
  v_task_id UUID;
BEGIN
  -- Atomically claim the next pending task
  -- SKIP LOCKED ensures multiple workers don't fight over the same task
  UPDATE public.tasks t
  SET
    status = 'claimed',
    claimed_by = p_worker_id,
    claimed_at = now(),
    updated_at = now()
  WHERE t.id = (
    SELECT t2.id
    FROM public.tasks t2
    WHERE t2.status = 'pending'
      AND (p_task_types IS NULL OR t2.task_type = ANY(p_task_types))
    ORDER BY t2.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING t.id INTO v_task_id;

  -- Return the claimed task details (or empty if nothing to claim)
  IF v_task_id IS NOT NULL THEN
    RETURN QUERY
    SELECT t.id, t.task_type, t.project_id, t.payload
    FROM public.tasks t
    WHERE t.id = v_task_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE_TASK_PROGRESS: Worker updates progress (triggers Realtime)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_task_progress(
  p_task_id UUID,
  p_progress INTEGER,
  p_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.tasks
  SET
    progress = p_progress,
    progress_message = COALESCE(p_message, progress_message),
    status = CASE
      WHEN p_progress >= 100 THEN 'completed'::public.task_status
      WHEN status = 'claimed' THEN 'running'::public.task_status
      ELSE status
    END,
    started_at = CASE
      WHEN started_at IS NULL AND p_progress > 0 THEN now()
      ELSE started_at
    END,
    completed_at = CASE
      WHEN p_progress >= 100 THEN now()
      ELSE completed_at
    END,
    updated_at = now()
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMPLETE_TASK: Mark task as completed with result
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_task(
  p_task_id UUID,
  p_result JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.tasks
  SET
    status = 'completed',
    progress = 100,
    result = p_result,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FAIL_TASK: Mark task as failed with error
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fail_task(
  p_task_id UUID,
  p_error TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.tasks
  SET
    status = 'failed',
    error = p_error,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- CREATE_ORG_WITH_OWNER: Create an organization and add the creator as owner
-- Called during onboarding flow
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_org_with_owner(
  p_name TEXT,
  p_slug TEXT
)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Create organization
  INSERT INTO public.organizations (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_org_id;

  -- Add creator as owner
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org_id, auth.uid(), 'owner');

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- CREATE_DATASET_VERSION: Create a new version of a dataset
-- Enforces invariant D3: linked list via parent_id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_dataset_version(
  p_parent_id UUID,
  p_working_file_path TEXT
)
RETURNS UUID AS $$
DECLARE
  v_parent RECORD;
  v_new_id UUID;
BEGIN
  -- Get parent dataset info
  SELECT * INTO v_parent FROM public.datasets WHERE id = p_parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent dataset not found: %', p_parent_id;
  END IF;

  -- Mark parent as no longer current
  UPDATE public.datasets
  SET is_current = false, updated_at = now()
  WHERE id = p_parent_id;

  -- Create new version
  INSERT INTO public.datasets (
    project_id, parent_id, uploaded_by, name, version,
    status, original_file_path, working_file_path, file_type,
    file_size_bytes, encoding, delimiter, row_count, column_count,
    columns, is_current
  ) VALUES (
    v_parent.project_id, p_parent_id, v_parent.uploaded_by,
    v_parent.name, v_parent.version + 1,
    'cleaning'::public.dataset_status, v_parent.original_file_path,
    p_working_file_path, v_parent.file_type,
    v_parent.file_size_bytes, v_parent.encoding, v_parent.delimiter,
    v_parent.row_count, v_parent.column_count,
    v_parent.columns, true
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- REALTIME PUBLICATION
-- Enable Realtime on the tasks table for progress subscriptions
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
