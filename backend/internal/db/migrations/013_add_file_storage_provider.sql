-- Migration: 013_add_file_storage_provider
-- Description: Add storage_provider column to files table for Multi-S3 sharding tracking

ALTER TABLE files ADD COLUMN storage_provider VARCHAR(50);
