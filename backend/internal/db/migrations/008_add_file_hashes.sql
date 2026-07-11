-- Migration: 008_add_file_hashes
-- Description: Add md5_hash and sha256_hash columns to files table

ALTER TABLE files ADD COLUMN IF NOT EXISTS md5_hash VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN IF NOT EXISTS sha256_hash VARCHAR(64) NOT NULL DEFAULT '';
