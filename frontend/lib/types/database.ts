/**
 * SurveyAI Analyst — Database Types
 *
 * AUTO-GENERATED PLACEHOLDER — Replace with output of:
 *   npx supabase gen types typescript --local > lib/types/database.ts
 *
 * This file provides type safety for all Supabase client operations.
 * It mirrors the schema defined in supabase/migrations/001_initial_schema.sql.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          logo_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          logo_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["organization_role"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["organization_role"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["organization_role"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string;
          name: string;
          description: string | null;
          status: Database["public"]["Enums"]["project_status"];
          research_questions: Json;
          sampling_method: Database["public"]["Enums"]["sampling_method"] | null;
          study_design: Database["public"]["Enums"]["study_design"] | null;
          target_population: string | null;
          sample_size_planned: number | null;
          geographic_scope: string | null;
          data_collection_start: string | null;
          data_collection_end: string | null;
          ethical_approval: string | null;
          funding_source: string | null;
          additional_context: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          created_by: string;
          name: string;
          description?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          research_questions?: Json;
          sampling_method?: Database["public"]["Enums"]["sampling_method"] | null;
          study_design?: Database["public"]["Enums"]["study_design"] | null;
          target_population?: string | null;
          sample_size_planned?: number | null;
          geographic_scope?: string | null;
          data_collection_start?: string | null;
          data_collection_end?: string | null;
          ethical_approval?: string | null;
          funding_source?: string | null;
          additional_context?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          created_by?: string;
          name?: string;
          description?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          research_questions?: Json;
          sampling_method?: Database["public"]["Enums"]["sampling_method"] | null;
          study_design?: Database["public"]["Enums"]["study_design"] | null;
          target_population?: string | null;
          sample_size_planned?: number | null;
          geographic_scope?: string | null;
          data_collection_start?: string | null;
          data_collection_end?: string | null;
          ethical_approval?: string | null;
          funding_source?: string | null;
          additional_context?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      instruments: {
        Row: {
          id: string;
          project_id: string;
          uploaded_by: string;
          name: string;
          file_path: string;
          file_type: string;
          parsed_structure: Json | null;
          questions: Json;
          skip_logic: Json;
          choice_lists: Json;
          settings: Json;
          parse_status: string;
          parse_errors: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          uploaded_by: string;
          name: string;
          file_path: string;
          file_type: string;
          parsed_structure?: Json | null;
          questions?: Json;
          skip_logic?: Json;
          choice_lists?: Json;
          settings?: Json;
          parse_status?: string;
          parse_errors?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          uploaded_by?: string;
          name?: string;
          file_path?: string;
          file_type?: string;
          parsed_structure?: Json | null;
          questions?: Json;
          skip_logic?: Json;
          choice_lists?: Json;
          settings?: Json;
          parse_status?: string;
          parse_errors?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instruments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      datasets: {
        Row: {
          id: string;
          project_id: string;
          parent_id: string | null;
          uploaded_by: string;
          name: string;
          version: number;
          status: Database["public"]["Enums"]["dataset_status"];
          original_file_path: string;
          working_file_path: string | null;
          file_type: string;
          file_size_bytes: number | null;
          encoding: string;
          delimiter: string;
          row_count: number | null;
          column_count: number | null;
          columns: Json;
          preview_data: Json | null;
          is_current: boolean;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          parent_id?: string | null;
          uploaded_by: string;
          name: string;
          version?: number;
          status?: Database["public"]["Enums"]["dataset_status"];
          original_file_path: string;
          working_file_path?: string | null;
          file_type: string;
          file_size_bytes?: number | null;
          encoding?: string;
          delimiter?: string;
          row_count?: number | null;
          column_count?: number | null;
          columns?: Json;
          preview_data?: Json | null;
          is_current?: boolean;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          parent_id?: string | null;
          uploaded_by?: string;
          name?: string;
          version?: number;
          status?: Database["public"]["Enums"]["dataset_status"];
          original_file_path?: string;
          working_file_path?: string | null;
          file_type?: string;
          file_size_bytes?: number | null;
          encoding?: string;
          delimiter?: string;
          row_count?: number | null;
          column_count?: number | null;
          columns?: Json;
          preview_data?: Json | null;
          is_current?: boolean;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "datasets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "datasets_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      column_mappings: {
        Row: {
          id: string;
          dataset_id: string;
          column_name: string;
          column_index: number;
          role: Database["public"]["Enums"]["column_role"] | null;
          data_type: Database["public"]["Enums"]["column_data_type"] | null;
          is_likert: boolean;
          likert_scale_min: number | null;
          likert_scale_max: number | null;
          detection_method: string | null;
          detection_confidence: number | null;
          ai_reasoning: string | null;
          confirmed_by: string | null;
          confirmed_at: string | null;
          instrument_question_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          dataset_id: string;
          column_name: string;
          column_index: number;
          role?: Database["public"]["Enums"]["column_role"] | null;
          data_type?: Database["public"]["Enums"]["column_data_type"] | null;
          is_likert?: boolean;
          likert_scale_min?: number | null;
          likert_scale_max?: number | null;
          detection_method?: string | null;
          detection_confidence?: number | null;
          ai_reasoning?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          instrument_question_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          dataset_id?: string;
          column_name?: string;
          column_index?: number;
          role?: Database["public"]["Enums"]["column_role"] | null;
          data_type?: Database["public"]["Enums"]["column_data_type"] | null;
          is_likert?: boolean;
          likert_scale_min?: number | null;
          likert_scale_max?: number | null;
          detection_method?: string | null;
          detection_confidence?: number | null;
          ai_reasoning?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          instrument_question_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "column_mappings_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      eda_results: {
        Row: {
          id: string;
          dataset_id: string;
          column_name: string | null;
          result_type: string;
          profile: Json | null;
          quality_score: number | null;
          issues: Json;
          bias_type: Database["public"]["Enums"]["bias_type"] | null;
          bias_severity: Database["public"]["Enums"]["severity_level"] | null;
          bias_evidence: Json | null;
          bias_recommendation: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          dataset_id: string;
          column_name?: string | null;
          result_type: string;
          profile?: Json | null;
          quality_score?: number | null;
          issues?: Json;
          bias_type?: Database["public"]["Enums"]["bias_type"] | null;
          bias_severity?: Database["public"]["Enums"]["severity_level"] | null;
          bias_evidence?: Json | null;
          bias_recommendation?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          dataset_id?: string;
          column_name?: string | null;
          result_type?: string;
          profile?: Json | null;
          quality_score?: number | null;
          issues?: Json;
          bias_type?: Database["public"]["Enums"]["bias_type"] | null;
          bias_severity?: Database["public"]["Enums"]["severity_level"] | null;
          bias_evidence?: Json | null;
          bias_recommendation?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "eda_results_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      cleaning_operations: {
        Row: {
          id: string;
          dataset_id: string;
          operation_type: Database["public"]["Enums"]["cleaning_op_type"];
          status: Database["public"]["Enums"]["cleaning_op_status"];
          severity: Database["public"]["Enums"]["severity_level"];
          priority: number;
          column_name: string | null;
          description: string;
          reasoning: string;
          confidence: number;
          parameters: Json;
          affected_rows_estimate: number | null;
          impact_preview: Json | null;
          approved_by: string | null;
          approved_at: string | null;
          applied_at: string | null;
          rejected_by: string | null;
          rejected_at: string | null;
          rejection_reason: string | null;
          undone_at: string | null;
          undone_by: string | null;
          before_snapshot: Json | null;
          after_snapshot: Json | null;
          resulting_dataset_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          dataset_id: string;
          operation_type: Database["public"]["Enums"]["cleaning_op_type"];
          status?: Database["public"]["Enums"]["cleaning_op_status"];
          severity?: Database["public"]["Enums"]["severity_level"];
          priority?: number;
          column_name?: string | null;
          description: string;
          reasoning: string;
          confidence: number;
          parameters?: Json;
          affected_rows_estimate?: number | null;
          impact_preview?: Json | null;
          approved_by?: string | null;
          approved_at?: string | null;
          applied_at?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          rejection_reason?: string | null;
          undone_at?: string | null;
          undone_by?: string | null;
          before_snapshot?: Json | null;
          after_snapshot?: Json | null;
          resulting_dataset_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          dataset_id?: string;
          operation_type?: Database["public"]["Enums"]["cleaning_op_type"];
          status?: Database["public"]["Enums"]["cleaning_op_status"];
          severity?: Database["public"]["Enums"]["severity_level"];
          priority?: number;
          column_name?: string | null;
          description?: string;
          reasoning?: string;
          confidence?: number;
          parameters?: Json;
          affected_rows_estimate?: number | null;
          impact_preview?: Json | null;
          approved_by?: string | null;
          approved_at?: string | null;
          applied_at?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          rejection_reason?: string | null;
          undone_at?: string | null;
          undone_by?: string | null;
          before_snapshot?: Json | null;
          after_snapshot?: Json | null;
          resulting_dataset_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cleaning_operations_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          id: string;
          project_id: string;
          task_type: Database["public"]["Enums"]["task_type"];
          status: Database["public"]["Enums"]["task_status"];
          payload: Json;
          result: Json | null;
          error: string | null;
          progress: number;
          progress_message: string | null;
          claimed_by: string | null;
          claimed_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          task_type: Database["public"]["Enums"]["task_type"];
          status?: Database["public"]["Enums"]["task_status"];
          payload?: Json;
          result?: Json | null;
          error?: string | null;
          progress?: number;
          progress_message?: string | null;
          claimed_by?: string | null;
          claimed_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          task_type?: Database["public"]["Enums"]["task_type"];
          status?: Database["public"]["Enums"]["task_status"];
          payload?: Json;
          result?: Json | null;
          error?: string | null;
          progress?: number;
          progress_message?: string | null;
          claimed_by?: string | null;
          claimed_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_by?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      analysis_plans: {
        Row: {
          id: string;
          project_id: string;
          dataset_id: string;
          created_by: string;
          research_question_id: string | null;
          research_question_text: string | null;
          dependent_variable: string;
          independent_variable: string;
          control_variables: Json;
          selected_test: string;
          test_rationale: string;
          fallback_test: string | null;
          assumptions_checked: Json;
          assumptions_passed: boolean | null;
          is_weighted: boolean;
          weight_column: string | null;
          cluster_column: string | null;
          stratum_column: string | null;
          status: Database["public"]["Enums"]["analysis_status"];
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          dataset_id: string;
          created_by: string;
          research_question_id?: string | null;
          research_question_text?: string | null;
          dependent_variable: string;
          independent_variable: string;
          control_variables?: Json;
          selected_test: string;
          test_rationale: string;
          fallback_test?: string | null;
          assumptions_checked?: Json;
          assumptions_passed?: boolean | null;
          is_weighted?: boolean;
          weight_column?: string | null;
          cluster_column?: string | null;
          stratum_column?: string | null;
          status?: Database["public"]["Enums"]["analysis_status"];
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          dataset_id?: string;
          created_by?: string;
          research_question_id?: string | null;
          research_question_text?: string | null;
          dependent_variable?: string;
          independent_variable?: string;
          control_variables?: Json;
          selected_test?: string;
          test_rationale?: string;
          fallback_test?: string | null;
          assumptions_checked?: Json;
          assumptions_passed?: boolean | null;
          is_weighted?: boolean;
          weight_column?: string | null;
          cluster_column?: string | null;
          stratum_column?: string | null;
          status?: Database["public"]["Enums"]["analysis_status"];
          approved_by?: string | null;
          approved_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_plans_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analysis_plans_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      analysis_results: {
        Row: {
          id: string;
          plan_id: string;
          project_id: string;
          dataset_id: string;
          test_name: string;
          test_statistic: number | null;
          p_value: number | null;
          degrees_of_freedom: number | null;
          confidence_interval: Json | null;
          effect_size_name: string;
          effect_size_value: number;
          effect_size_interpretation: string;
          design_effect: number | null;
          effective_sample_size: number | null;
          sample_size: number;
          missing_data_rate: number;
          assumptions_met: boolean;
          fallback_used: boolean;
          interpretation: string | null;
          limitations: Json;
          ai_confidence: number | null;
          interpretation_validated: boolean;
          raw_output: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          project_id: string;
          dataset_id: string;
          test_name: string;
          test_statistic?: number | null;
          p_value?: number | null;
          degrees_of_freedom?: number | null;
          confidence_interval?: Json | null;
          effect_size_name: string;
          effect_size_value: number;
          effect_size_interpretation: string;
          design_effect?: number | null;
          effective_sample_size?: number | null;
          sample_size: number;
          missing_data_rate: number;
          assumptions_met: boolean;
          fallback_used?: boolean;
          interpretation?: string | null;
          limitations?: Json;
          ai_confidence?: number | null;
          interpretation_validated?: boolean;
          raw_output?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          project_id?: string;
          dataset_id?: string;
          test_name?: string;
          test_statistic?: number | null;
          p_value?: number | null;
          degrees_of_freedom?: number | null;
          confidence_interval?: Json | null;
          effect_size_name?: string;
          effect_size_value?: number;
          effect_size_interpretation?: string;
          design_effect?: number | null;
          effective_sample_size?: number | null;
          sample_size?: number;
          missing_data_rate?: number;
          assumptions_met?: boolean;
          fallback_used?: boolean;
          interpretation?: string | null;
          limitations?: Json;
          ai_confidence?: number | null;
          interpretation_validated?: boolean;
          raw_output?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_results_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "analysis_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analysis_results_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analysis_results_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          id: string;
          project_id: string;
          created_by: string;
          name: string;
          template: Database["public"]["Enums"]["report_template"];
          status: string;
          sections: Json;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          created_by: string;
          name: string;
          template?: Database["public"]["Enums"]["report_template"];
          status?: string;
          sections?: Json;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          created_by?: string;
          name?: string;
          template?: Database["public"]["Enums"]["report_template"];
          status?: string;
          sections?: Json;
          metadata?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      report_sections: {
        Row: {
          id: string;
          report_id: string;
          section_key: string;
          title: string;
          sort_order: number;
          content: string | null;
          status: Database["public"]["Enums"]["report_section_status"];
          confidence: Database["public"]["Enums"]["confidence_level"] | null;
          ai_generated: boolean;
          has_placeholders: boolean;
          review_notes: string | null;
          linked_results: Json;
          linked_charts: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          section_key: string;
          title: string;
          sort_order?: number;
          content?: string | null;
          status?: Database["public"]["Enums"]["report_section_status"];
          confidence?: Database["public"]["Enums"]["confidence_level"] | null;
          ai_generated?: boolean;
          has_placeholders?: boolean;
          review_notes?: string | null;
          linked_results?: Json;
          linked_charts?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          report_id?: string;
          section_key?: string;
          title?: string;
          sort_order?: number;
          content?: string | null;
          status?: Database["public"]["Enums"]["report_section_status"];
          confidence?: Database["public"]["Enums"]["confidence_level"] | null;
          ai_generated?: boolean;
          has_placeholders?: boolean;
          review_notes?: string | null;
          linked_results?: Json;
          linked_charts?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_sections_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
        ];
      };
      charts: {
        Row: {
          id: string;
          project_id: string;
          analysis_result_id: string | null;
          created_by: string;
          chart_type: string;
          title: string;
          subtitle: string | null;
          config: Json;
          data: Json;
          file_path: string | null;
          thumbnail_path: string | null;
          has_error_bars: boolean;
          has_source_note: boolean;
          has_sample_size: boolean;
          y_axis_starts_at_zero: boolean;
          is_colorblind_safe: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          analysis_result_id?: string | null;
          created_by: string;
          chart_type: string;
          title: string;
          subtitle?: string | null;
          config?: Json;
          data?: Json;
          file_path?: string | null;
          thumbnail_path?: string | null;
          has_error_bars?: boolean;
          has_source_note?: boolean;
          has_sample_size?: boolean;
          y_axis_starts_at_zero?: boolean;
          is_colorblind_safe?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          analysis_result_id?: string | null;
          created_by?: string;
          chart_type?: string;
          title?: string;
          subtitle?: string | null;
          config?: Json;
          data?: Json;
          file_path?: string | null;
          thumbnail_path?: string | null;
          has_error_bars?: boolean;
          has_source_note?: boolean;
          has_sample_size?: boolean;
          y_axis_starts_at_zero?: boolean;
          is_colorblind_safe?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "charts_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "charts_analysis_result_id_fkey";
            columns: ["analysis_result_id"];
            isOneToOne: false;
            referencedRelation: "analysis_results";
            referencedColumns: ["id"];
          },
        ];
      };
      report_exports: {
        Row: {
          id: string;
          report_id: string;
          format: Database["public"]["Enums"]["export_format"];
          file_path: string | null;
          file_size_bytes: number | null;
          generated_by: string;
          generated_at: string;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          format: Database["public"]["Enums"]["export_format"];
          file_path?: string | null;
          file_size_bytes?: number | null;
          generated_by: string;
          generated_at?: string;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          report_id?: string;
          format?: Database["public"]["Enums"]["export_format"];
          file_path?: string | null;
          file_size_bytes?: number | null;
          generated_by?: string;
          generated_at?: string;
          expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "report_exports_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          project_id: string;
          user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          details?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string;
          details?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_next_task: {
        Args: {
          p_worker_id: string;
          p_task_types?: Database["public"]["Enums"]["task_type"][] | null;
        };
        Returns: {
          task_id: string;
          task_type: Database["public"]["Enums"]["task_type"];
          project_id: string;
          payload: Json;
        }[];
      };
      update_task_progress: {
        Args: {
          p_task_id: string;
          p_progress: number;
          p_message?: string | null;
        };
        Returns: undefined;
      };
      complete_task: {
        Args: {
          p_task_id: string;
          p_result?: Json | null;
        };
        Returns: undefined;
      };
      fail_task: {
        Args: {
          p_task_id: string;
          p_error: string;
        };
        Returns: undefined;
      };
      create_org_with_owner: {
        Args: {
          p_name: string;
          p_slug: string;
        };
        Returns: string;
      };
      create_dataset_version: {
        Args: {
          p_parent_id: string;
          p_working_file_path: string;
        };
        Returns: string;
      };
      is_org_member: {
        Args: {
          org_id: string;
        };
        Returns: boolean;
      };
      has_org_role: {
        Args: {
          org_id: string;
          required_role: Database["public"]["Enums"]["organization_role"];
        };
        Returns: boolean;
      };
      project_org_id: {
        Args: {
          p_id: string;
        };
        Returns: string;
      };
    };
    Enums: {
      organization_role: "owner" | "admin" | "analyst" | "viewer";
      project_status:
        | "draft"
        | "context_set"
        | "instrument_uploaded"
        | "data_uploaded"
        | "roles_mapped"
        | "eda_complete"
        | "cleaning_complete"
        | "analysis_complete"
        | "report_complete";
      sampling_method:
        | "simple_random"
        | "stratified"
        | "cluster"
        | "multi_stage"
        | "convenience"
        | "purposive"
        | "snowball"
        | "quota"
        | "systematic"
        | "other";
      study_design:
        | "cross_sectional"
        | "longitudinal"
        | "experimental"
        | "quasi_experimental"
        | "pre_post"
        | "cohort"
        | "case_control"
        | "other";
      dataset_status:
        | "uploading"
        | "uploaded"
        | "previewed"
        | "confirmed"
        | "profiled"
        | "cleaning"
        | "cleaned"
        | "analyzed";
      column_role:
        | "identifier"
        | "weight"
        | "cluster_id"
        | "stratum"
        | "demographic"
        | "outcome"
        | "covariate"
        | "skip_logic"
        | "metadata"
        | "open_text"
        | "ignore";
      column_data_type:
        | "continuous"
        | "categorical"
        | "binary"
        | "ordinal"
        | "likert"
        | "date"
        | "text"
        | "identifier";
      confidence_level: "high" | "medium" | "low";
      task_status:
        | "pending"
        | "claimed"
        | "running"
        | "completed"
        | "failed"
        | "cancelled";
      task_type:
        | "parse_instrument"
        | "detect_column_roles"
        | "run_eda"
        | "run_consistency_checks"
        | "run_bias_detection"
        | "generate_cleaning_suggestions"
        | "apply_cleaning_operation"
        | "run_analysis"
        | "interpret_results"
        | "generate_report_section"
        | "generate_chart"
        | "export_report"
        | "export_audit_trail";
      cleaning_op_status:
        | "pending"
        | "approved"
        | "applied"
        | "rejected"
        | "undone";
      cleaning_op_type:
        | "remove_duplicates"
        | "fix_encoding"
        | "standardize_missing"
        | "recode_values"
        | "fix_outlier"
        | "impute_value"
        | "drop_column"
        | "rename_column"
        | "split_column"
        | "merge_columns"
        | "fix_data_type"
        | "fix_skip_logic"
        | "custom";
      severity_level: "critical" | "warning" | "info";
      bias_type:
        | "selection_bias"
        | "non_response_bias"
        | "social_desirability_bias"
        | "enumerator_bias"
        | "acquiescence_bias"
        | "measurement_bias"
        | "recall_bias";
      analysis_status:
        | "planned"
        | "approved"
        | "running"
        | "completed"
        | "failed";
      report_template: "donor" | "internal" | "academic" | "policy";
      report_section_status:
        | "pending"
        | "drafted"
        | "review_needed"
        | "approved"
        | "finalized";
      export_format: "docx" | "pdf" | "pptx" | "html";
    };
    CompositeTypes: Record<string, never>;
  };
};

// Convenience type helpers
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
export type Functions<T extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][T];
