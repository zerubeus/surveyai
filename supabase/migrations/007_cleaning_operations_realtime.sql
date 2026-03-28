-- Sprint 8: Enable Realtime for cleaning_operations table
-- Allows live streaming of cleaning suggestion updates to the frontend
ALTER PUBLICATION supabase_realtime ADD TABLE public.cleaning_operations;
