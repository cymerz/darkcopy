-- Add burn-after-read support for pastes only
-- Files do not support burn-after-read

ALTER TABLE pastes ADD COLUMN burn_after_read BOOLEAN NOT NULL DEFAULT FALSE;
