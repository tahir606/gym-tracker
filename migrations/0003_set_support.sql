-- How much help a set got from a spotter or partner: NULL (none), 'low' or 'high'.
-- Supported sets still count towards volume but never set a personal record.
ALTER TABLE sets ADD COLUMN support TEXT;
