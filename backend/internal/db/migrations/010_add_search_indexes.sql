-- Full-text search support for pastes and files
-- Uses PostgreSQL's built-in GIN indexes with to_tsvector

CREATE INDEX idx_pastes_search ON pastes
USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

CREATE INDEX idx_files_search ON files
USING gin(to_tsvector('english', coalesce(filename, '')));
