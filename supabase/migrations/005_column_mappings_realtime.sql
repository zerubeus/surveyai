-- Sprint 6: Enable Realtime for column_mappings table
-- Required for useColumnMappings hook to receive live INSERT/UPDATE events
ALTER PUBLICATION supabase_realtime ADD TABLE public.column_mappings;
