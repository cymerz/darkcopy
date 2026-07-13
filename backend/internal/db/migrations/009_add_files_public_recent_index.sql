-- Migration: 009_add_files_public_recent_index
-- Description: Add index for listing public recent files quickly

CREATE INDEX IF NOT EXISTS idx_files_public_recent ON files(created_at DESC) WHERE visibility = 'public';
