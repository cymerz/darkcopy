-- Add is_encrypted column for Client-Side End-to-End Encryption support
ALTER TABLE pastes ADD COLUMN is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;
