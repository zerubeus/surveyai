-- Add impute_value to cleaning_op_type enum
-- This operation type fills missing (NaN) values using statistical methods (mean, median, mode, or constant)

ALTER TYPE public.cleaning_op_type ADD VALUE IF NOT EXISTS 'impute_value';
