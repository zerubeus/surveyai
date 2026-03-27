-- ============================================================================
-- SurveyAI Analyst — Migration 002: Row Level Security Policies
-- Invariant D6: RLS enforces tenant data isolation on every table
-- ============================================================================

-- ============================================================================
-- HELPER FUNCTION: Check if user is member of organization
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- HELPER FUNCTION: Check if user has specific role in organization
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_org_role(org_id UUID, required_role public.organization_role)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role <= required_role  -- owner < admin < analyst < viewer (enum ordering)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- HELPER FUNCTION: Get organization_id for a project
-- ============================================================================

CREATE OR REPLACE FUNCTION public.project_org_id(p_id UUID)
RETURNS UUID AS $$
  SELECT organization_id FROM public.projects WHERE id = p_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- ORGANIZATIONS POLICIES
-- ============================================================================

-- Members can view their organizations
CREATE POLICY "org_select_member"
  ON public.organizations FOR SELECT
  USING (public.is_org_member(id));

-- Only authenticated users can create organizations (they become owner)
CREATE POLICY "org_insert_authenticated"
  ON public.organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only owners/admins can update organization
CREATE POLICY "org_update_admin"
  ON public.organizations FOR UPDATE
  USING (public.has_org_role(id, 'admin'));

-- Only owners can delete organization
CREATE POLICY "org_delete_owner"
  ON public.organizations FOR DELETE
  USING (public.has_org_role(id, 'owner'));

-- ============================================================================
-- ORGANIZATION MEMBERS POLICIES
-- ============================================================================

-- Members can see other members in their org
CREATE POLICY "orgmember_select_member"
  ON public.organization_members FOR SELECT
  USING (public.is_org_member(organization_id));

-- Admins+ can add members
CREATE POLICY "orgmember_insert_admin"
  ON public.organization_members FOR INSERT
  WITH CHECK (public.has_org_role(organization_id, 'admin'));

-- Admins+ can update member roles
CREATE POLICY "orgmember_update_admin"
  ON public.organization_members FOR UPDATE
  USING (public.has_org_role(organization_id, 'admin'));

-- Admins+ can remove members (except self-removal which is always allowed)
CREATE POLICY "orgmember_delete_admin"
  ON public.organization_members FOR DELETE
  USING (
    public.has_org_role(organization_id, 'admin')
    OR user_id = auth.uid()
  );

-- ============================================================================
-- PROJECTS POLICIES
-- ============================================================================

-- Members can view projects in their org
CREATE POLICY "project_select_member"
  ON public.projects FOR SELECT
  USING (public.is_org_member(organization_id));

-- Analysts+ can create projects
CREATE POLICY "project_insert_analyst"
  ON public.projects FOR INSERT
  WITH CHECK (
    public.has_org_role(organization_id, 'analyst')
    AND created_by = auth.uid()
  );

-- Analysts+ can update projects in their org
CREATE POLICY "project_update_analyst"
  ON public.projects FOR UPDATE
  USING (public.is_org_member(organization_id));

-- Admins+ can delete projects
CREATE POLICY "project_delete_admin"
  ON public.projects FOR DELETE
  USING (public.has_org_role(organization_id, 'admin'));

-- ============================================================================
-- INSTRUMENTS POLICIES
-- ============================================================================

CREATE POLICY "instrument_select_member"
  ON public.instruments FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "instrument_insert_analyst"
  ON public.instruments FOR INSERT
  WITH CHECK (
    public.is_org_member(public.project_org_id(project_id))
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "instrument_update_analyst"
  ON public.instruments FOR UPDATE
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "instrument_delete_admin"
  ON public.instruments FOR DELETE
  USING (public.has_org_role(public.project_org_id(project_id), 'admin'));

-- ============================================================================
-- DATASETS POLICIES
-- ============================================================================

CREATE POLICY "dataset_select_member"
  ON public.datasets FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "dataset_insert_analyst"
  ON public.datasets FOR INSERT
  WITH CHECK (
    public.is_org_member(public.project_org_id(project_id))
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "dataset_update_analyst"
  ON public.datasets FOR UPDATE
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "dataset_delete_admin"
  ON public.datasets FOR DELETE
  USING (public.has_org_role(public.project_org_id(project_id), 'admin'));

-- ============================================================================
-- COLUMN MAPPINGS POLICIES
-- ============================================================================

CREATE POLICY "colmap_select_member"
  ON public.column_mappings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

CREATE POLICY "colmap_insert_analyst"
  ON public.column_mappings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

CREATE POLICY "colmap_update_analyst"
  ON public.column_mappings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

CREATE POLICY "colmap_delete_analyst"
  ON public.column_mappings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

-- ============================================================================
-- EDA RESULTS POLICIES
-- ============================================================================

CREATE POLICY "eda_select_member"
  ON public.eda_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

-- EDA results are created by the worker (service_role bypasses RLS)
-- But we still allow insert for completeness
CREATE POLICY "eda_insert_service"
  ON public.eda_results FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

-- ============================================================================
-- CLEANING OPERATIONS POLICIES
-- ============================================================================

CREATE POLICY "cleanop_select_member"
  ON public.cleaning_operations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

CREATE POLICY "cleanop_insert_analyst"
  ON public.cleaning_operations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

CREATE POLICY "cleanop_update_analyst"
  ON public.cleaning_operations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.datasets d
      WHERE d.id = dataset_id
        AND public.is_org_member(public.project_org_id(d.project_id))
    )
  );

-- ============================================================================
-- TASKS POLICIES
-- ============================================================================

-- Members can view tasks for their projects
CREATE POLICY "task_select_member"
  ON public.tasks FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

-- Members can create tasks (dispatch work)
CREATE POLICY "task_insert_member"
  ON public.tasks FOR INSERT
  WITH CHECK (
    public.is_org_member(public.project_org_id(project_id))
    AND created_by = auth.uid()
  );

-- Task updates come from worker (service_role) or project members
CREATE POLICY "task_update_member"
  ON public.tasks FOR UPDATE
  USING (public.is_org_member(public.project_org_id(project_id)));

-- ============================================================================
-- ANALYSIS PLANS POLICIES
-- ============================================================================

CREATE POLICY "analysisplan_select_member"
  ON public.analysis_plans FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "analysisplan_insert_analyst"
  ON public.analysis_plans FOR INSERT
  WITH CHECK (
    public.is_org_member(public.project_org_id(project_id))
    AND created_by = auth.uid()
  );

CREATE POLICY "analysisplan_update_analyst"
  ON public.analysis_plans FOR UPDATE
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "analysisplan_delete_analyst"
  ON public.analysis_plans FOR DELETE
  USING (public.is_org_member(public.project_org_id(project_id)));

-- ============================================================================
-- ANALYSIS RESULTS POLICIES
-- ============================================================================

CREATE POLICY "analysisresult_select_member"
  ON public.analysis_results FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "analysisresult_insert_service"
  ON public.analysis_results FOR INSERT
  WITH CHECK (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "analysisresult_update_member"
  ON public.analysis_results FOR UPDATE
  USING (public.is_org_member(public.project_org_id(project_id)));

-- ============================================================================
-- REPORTS POLICIES
-- ============================================================================

CREATE POLICY "report_select_member"
  ON public.reports FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "report_insert_analyst"
  ON public.reports FOR INSERT
  WITH CHECK (
    public.is_org_member(public.project_org_id(project_id))
    AND created_by = auth.uid()
  );

CREATE POLICY "report_update_analyst"
  ON public.reports FOR UPDATE
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "report_delete_admin"
  ON public.reports FOR DELETE
  USING (public.has_org_role(public.project_org_id(project_id), 'admin'));

-- ============================================================================
-- REPORT SECTIONS POLICIES
-- ============================================================================

CREATE POLICY "reportsection_select_member"
  ON public.report_sections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
        AND public.is_org_member(public.project_org_id(r.project_id))
    )
  );

CREATE POLICY "reportsection_insert_analyst"
  ON public.report_sections FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
        AND public.is_org_member(public.project_org_id(r.project_id))
    )
  );

CREATE POLICY "reportsection_update_analyst"
  ON public.report_sections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
        AND public.is_org_member(public.project_org_id(r.project_id))
    )
  );

-- ============================================================================
-- CHARTS POLICIES
-- ============================================================================

CREATE POLICY "chart_select_member"
  ON public.charts FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "chart_insert_analyst"
  ON public.charts FOR INSERT
  WITH CHECK (
    public.is_org_member(public.project_org_id(project_id))
    AND created_by = auth.uid()
  );

CREATE POLICY "chart_update_analyst"
  ON public.charts FOR UPDATE
  USING (public.is_org_member(public.project_org_id(project_id)));

CREATE POLICY "chart_delete_analyst"
  ON public.charts FOR DELETE
  USING (public.is_org_member(public.project_org_id(project_id)));

-- ============================================================================
-- REPORT EXPORTS POLICIES
-- ============================================================================

CREATE POLICY "reportexport_select_member"
  ON public.report_exports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
        AND public.is_org_member(public.project_org_id(r.project_id))
    )
  );

CREATE POLICY "reportexport_insert_analyst"
  ON public.report_exports FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
        AND public.is_org_member(public.project_org_id(r.project_id))
    )
  );

-- ============================================================================
-- AUDIT LOG POLICIES
-- ============================================================================

CREATE POLICY "auditlog_select_member"
  ON public.audit_log FOR SELECT
  USING (public.is_org_member(public.project_org_id(project_id)));

-- Audit log inserts come from the worker (service_role) or project members
CREATE POLICY "auditlog_insert_member"
  ON public.audit_log FOR INSERT
  WITH CHECK (public.is_org_member(public.project_org_id(project_id)));
