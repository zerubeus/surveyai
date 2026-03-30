-- ============================================================================
-- Migration 014: Fix claim_next_task to return created_by
-- The analysis_planner and other services require created_by in the payload.
-- Previously it was not returned, causing ValueError in analysis_planner.py.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_next_task(
  p_worker_id TEXT,
  p_task_types public.task_type[] DEFAULT NULL
)
RETURNS TABLE (
  task_id UUID,
  task_type public.task_type,
  project_id UUID,
  payload JSONB,
  created_by UUID
) AS $$
DECLARE
  v_task_id UUID;
BEGIN
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

  IF v_task_id IS NOT NULL THEN
    RETURN QUERY
    SELECT t.id, t.task_type, t.project_id, t.payload, t.created_by
    FROM public.tasks t
    WHERE t.id = v_task_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
