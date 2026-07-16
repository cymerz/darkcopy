package db

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/cymerz/darkcopy/internal/settings"
)

// SettingsRepo persists application settings in the single-row app_settings
// table as a JSONB document. It implements settings.Store.
type SettingsRepo struct {
	writePool *pgxpool.Pool
	readPool  *pgxpool.Pool
}

// NewSettingsRepo creates a new SettingsRepo.
func NewSettingsRepo(writePool, readPool *pgxpool.Pool) *SettingsRepo {
	if readPool == nil {
		readPool = writePool
	}
	return &SettingsRepo{
		writePool: writePool,
		readPool:  readPool,
	}
}

// Load returns the persisted settings, or (nil, nil) when none have been saved
// yet (first run).
// Note: We query the writePool directly for settings to avoid stale reads
// during replication lag immediately following a settings update notification.
func (r *SettingsRepo) Load(ctx context.Context) (*settings.Settings, error) {
	var raw []byte
	err := r.writePool.QueryRow(ctx, `SELECT data FROM app_settings WHERE id = 1`).Scan(&raw)
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

// Save upserts the settings document into the single-row table.
func (r *SettingsRepo) Save(ctx context.Context, s settings.Settings) error {
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
