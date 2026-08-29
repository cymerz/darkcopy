package db

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/cymerz/darkcopy/internal/paste"
	"github.com/cymerz/darkcopy/internal/report"
	"github.com/cymerz/darkcopy/internal/settings"
)

// BackupRepo provides repository methods for backing up and restoring database state.
type BackupRepo struct {
	writePool *pgxpool.Pool
	readPool  *pgxpool.Pool
	rdb       *redis.Client
}

// NewBackupRepo creates a new BackupRepo.
func NewBackupRepo(writePool, readPool *pgxpool.Pool) *BackupRepo {
	if readPool == nil {
		readPool = writePool
	}
	return &BackupRepo{
		writePool: writePool,
		readPool:  readPool,
	}
}

// WithRedis sets the Redis client for cache invalidation.
func (r *BackupRepo) WithRedis(rdb *redis.Client) *BackupRepo {
	r.rdb = rdb
	return r
}

// GetAllPastesFull returns all pastes in the database with complete column data.
func (r *BackupRepo) GetAllPastesFull(ctx context.Context) ([]*paste.Paste, error) {
	rows, err := r.readPool.Query(ctx, `
		SELECT id, slug, title, content, language, visibility, password_hash, expires_at, created_at, views, burn_after_read, is_encrypted
		FROM pastes
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*paste.Paste
	for rows.Next() {
		p := &paste.Paste{}
		var passwordHash *string
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Content, &p.Language, &p.Visibility, &passwordHash, &p.ExpiresAt, &p.CreatedAt, &p.Views, &p.BurnAfterRead, &p.IsEncrypted); err != nil {
			return nil, err
		}
		if passwordHash != nil {
			p.PasswordHash = *passwordHash
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

// GetAllFilesFull returns all file records in the database with complete column data.
func (r *BackupRepo) GetAllFilesFull(ctx context.Context) ([]*paste.FileRecord, error) {
	rows, err := r.readPool.Query(ctx, `
		SELECT id, slug, filename, mime_type, size_bytes, storage_key, visibility, password_hash, expires_at, created_at, downloads, md5_hash, sha256_hash, storage_provider
		FROM files
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*paste.FileRecord
	for rows.Next() {
		f := &paste.FileRecord{}
		var passwordHash, storageProvider *string
		if err := rows.Scan(&f.ID, &f.Slug, &f.Filename, &f.MIMEType, &f.SizeBytes, &f.StorageKey, &f.Visibility, &passwordHash, &f.ExpiresAt, &f.CreatedAt, &f.Downloads, &f.MD5Hash, &f.SHA256Hash, &storageProvider); err != nil {
			return nil, err
		}
		if passwordHash != nil {
			f.PasswordHash = *passwordHash
		}
		if storageProvider != nil {
			f.StorageProvider = *storageProvider
		}
		items = append(items, f)
	}
	return items, rows.Err()
}

// GetAllReportsFull returns all reports in the database with complete column data.
func (r *BackupRepo) GetAllReportsFull(ctx context.Context) ([]*report.Report, error) {
	rows, err := r.readPool.Query(ctx, `
		SELECT id, resource_type, slug, reason, details, reporter_ip, status, created_at, reviewed_at
		FROM reports
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*report.Report
	for rows.Next() {
		rep := &report.Report{}
		if err := rows.Scan(&rep.ID, &rep.ResourceType, &rep.Slug, &rep.Reason, &rep.Details, &rep.ReporterIP, &rep.Status, &rep.CreatedAt, &rep.ReviewedAt); err != nil {
			return nil, err
		}
		items = append(items, rep)
	}
	return items, rows.Err()
}

// GetSettings retrieves the current settings from the app_settings table.
func (r *BackupRepo) GetSettings(ctx context.Context) (*settings.Settings, error) {
	var raw []byte
	err := r.readPool.QueryRow(ctx, `SELECT data FROM app_settings WHERE id = 1`).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	var s settings.Settings
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// WipeAllData truncates all pastes, files, and reports in the database inside a transaction.
func (r *BackupRepo) WipeAllData(ctx context.Context) error {
	tx, err := r.writePool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `TRUNCATE TABLE reports, files, pastes CASCADE`); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// RestorePastes performs transactional upsert of pastes.
func (r *BackupRepo) RestorePastes(ctx context.Context, pastes []*paste.Paste) (int, error) {
	tx, err := r.writePool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	count := 0
	for _, p := range pastes {
		if p.Slug == "" {
			continue
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO pastes (id, slug, title, content, language, visibility, password_hash, expires_at, created_at, views, burn_after_read, is_encrypted)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (slug) DO UPDATE SET
				title = EXCLUDED.title,
				content = EXCLUDED.content,
				language = EXCLUDED.language,
				visibility = EXCLUDED.visibility,
				password_hash = EXCLUDED.password_hash,
				expires_at = EXCLUDED.expires_at,
				views = EXCLUDED.views,
				burn_after_read = EXCLUDED.burn_after_read,
				is_encrypted = EXCLUDED.is_encrypted
		`, p.ID, p.Slug, p.Title, p.Content, p.Language, p.Visibility, nilIfEmpty(p.PasswordHash), p.ExpiresAt, p.CreatedAt, p.Views, p.BurnAfterRead, p.IsEncrypted)
		if err != nil {
			return 0, err
		}
		count++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

// RestoreFiles performs transactional upsert of file records.
func (r *BackupRepo) RestoreFiles(ctx context.Context, files []*paste.FileRecord) (int, error) {
	tx, err := r.writePool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	count := 0
	for _, f := range files {
		if f.Slug == "" {
			continue
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO files (id, slug, filename, mime_type, size_bytes, storage_key, visibility, password_hash, expires_at, created_at, downloads, md5_hash, sha256_hash, storage_provider)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
			ON CONFLICT (slug) DO UPDATE SET
				filename = EXCLUDED.filename,
				mime_type = EXCLUDED.mime_type,
				size_bytes = EXCLUDED.size_bytes,
				storage_key = EXCLUDED.storage_key,
				visibility = EXCLUDED.visibility,
				password_hash = EXCLUDED.password_hash,
				expires_at = EXCLUDED.expires_at,
				downloads = EXCLUDED.downloads,
				md5_hash = EXCLUDED.md5_hash,
				sha256_hash = EXCLUDED.sha256_hash,
				storage_provider = EXCLUDED.storage_provider
		`, f.ID, f.Slug, f.Filename, f.MIMEType, f.SizeBytes, f.StorageKey, f.Visibility, nilIfEmpty(f.PasswordHash), f.ExpiresAt, f.CreatedAt, f.Downloads, f.MD5Hash, f.SHA256Hash, nilIfEmpty(f.StorageProvider))
		if err != nil {
			return 0, err
		}
		count++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

// RestoreReports performs transactional upsert of reports.
func (r *BackupRepo) RestoreReports(ctx context.Context, reports []*report.Report) (int, error) {
	tx, err := r.writePool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	count := 0
	for _, rep := range reports {
		_, err := tx.Exec(ctx, `
			INSERT INTO reports (id, resource_type, slug, reason, details, reporter_ip, status, created_at, reviewed_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (id) DO UPDATE SET
				status = EXCLUDED.status,
				reviewed_at = EXCLUDED.reviewed_at
		`, rep.ID, rep.ResourceType, rep.Slug, rep.Reason, rep.Details, rep.ReporterIP, rep.Status, rep.CreatedAt, rep.ReviewedAt)
		if err != nil {
			return 0, err
		}
		count++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

// RestoreSettings upserts settings document into app_settings table.
func (r *BackupRepo) RestoreSettings(ctx context.Context, s *settings.Settings) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = r.writePool.Exec(ctx, `
		INSERT INTO app_settings (id, data, updated_at)
		VALUES (1, $1, NOW())
		ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
	`, raw)
	return err
}

// FlushAllCaches flushes Redis caches for pastes and files.
func (r *BackupRepo) FlushAllCaches(ctx context.Context) error {
	if r.rdb == nil {
		return nil
	}
	_ = r.rdb.Del(ctx, "paste:recent", "file:recent").Err()
	// Scan and delete paste cache and file cache keys
	iter := r.rdb.Scan(ctx, 0, "paste:cache:*", 0).Iterator()
	for iter.Next(ctx) {
		_ = r.rdb.Del(ctx, iter.Val())
	}
	fIter := r.rdb.Scan(ctx, 0, "file:cache:*", 0).Iterator()
	for fIter.Next(ctx) {
		_ = r.rdb.Del(ctx, fIter.Val())
	}
	return nil
}
