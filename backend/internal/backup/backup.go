// Package backup provides database backup export, snapshot management, and safe
// transactional restore capabilities for DarkCopy.
package backup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/cymerz/darkcopy/internal/paste"
	"github.com/cymerz/darkcopy/internal/report"
	"github.com/cymerz/darkcopy/internal/settings"
)

var (
	ErrInvalidFilename   = errors.New("invalid backup filename")
	ErrPathTraversal     = errors.New("path traversal attempt detected")
	ErrUnsupportedFormat = errors.New("unsupported backup file format")
	ErrBackupNotFound    = errors.New("backup file not found")
	ErrInvalidBackupData = errors.New("invalid or corrupted backup payload")
)

// BackupInfo contains metadata about a backup snapshot file.
type BackupInfo struct {
	Filename  string    `json:"filename"`
	SizeBytes int64     `json:"size_bytes"`
	CreatedAt time.Time `json:"created_at"`
	Format    string    `json:"format"` // "json", "sql", "sql.gz"
}

// BackupData represents a full JSON backup payload.
type BackupData struct {
	Version    string              `json:"version"`
	ExportedAt time.Time           `json:"exported_at"`
	Pastes     []*paste.Paste      `json:"pastes"`
	Files      []*paste.FileRecord `json:"files"`
	Settings   *settings.Settings  `json:"settings,omitempty"`
	Reports    []*report.Report    `json:"reports,omitempty"`
}

// RestoreResult summarizes the output of a restore operation.
type RestoreResult struct {
	Success         bool `json:"success"`
	RestoredPastes  int  `json:"restored_pastes"`
	RestoredFiles   int  `json:"restored_files"`
	RestoredReports int  `json:"restored_reports"`
	SettingsUpdated bool `json:"settings_updated"`
}

// Repository defines DB operations needed by the backup service.
type Repository interface {
	GetAllPastesFull(ctx context.Context) ([]*paste.Paste, error)
	GetAllFilesFull(ctx context.Context) ([]*paste.FileRecord, error)
	GetAllReportsFull(ctx context.Context) ([]*report.Report, error)
	GetSettings(ctx context.Context) (*settings.Settings, error)
	RestorePastes(ctx context.Context, pastes []*paste.Paste) (int, error)
	RestoreFiles(ctx context.Context, files []*paste.FileRecord) (int, error)
	RestoreReports(ctx context.Context, reports []*report.Report) (int, error)
	RestoreSettings(ctx context.Context, s *settings.Settings) error
}

// CacheFlusher invalidates all caches after a restore operation.
type CacheFlusher interface {
	FlushAllCaches(ctx context.Context) error
}

// Service manages backup listing, creation, and restoration.
type Service struct {
	backupDir string
	repo      Repository
	flusher   CacheFlusher
	now       func() time.Time
}

// NewService initializes a backup Service with a designated backup directory.
func NewService(backupDir string, repo Repository, flusher CacheFlusher) (*Service, error) {
	if backupDir == "" {
		backupDir = "./backups"
	}
	absDir, err := filepath.Abs(backupDir)
	if err != nil {
		return nil, fmt.Errorf("invalid backup dir: %w", err)
	}
	if err := os.MkdirAll(absDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create backup dir: %w", err)
	}
	return &Service{
		backupDir: absDir,
		repo:      repo,
		flusher:   flusher,
		now:       time.Now,
	}, nil
}

// GetBackupDir returns the absolute path to the backup directory.
func (s *Service) GetBackupDir() string {
	return s.backupDir
}

// ValidateFilename checks for path traversal and valid extensions. Returns the sanitized full path.
func (s *Service) ValidateFilename(filename string) (string, error) {
	trimmed := strings.TrimSpace(filename)
	if trimmed == "" {
		return "", ErrInvalidFilename
	}
	cleanName := filepath.Base(trimmed)
	if cleanName == "." || cleanName == "/" || cleanName == "\\" || cleanName != trimmed {
		return "", ErrPathTraversal
	}

	ext := strings.ToLower(filepath.Ext(cleanName))
	if ext != ".json" && ext != ".sql" && ext != ".gz" {
		return "", ErrUnsupportedFormat
	}

	fullPath := filepath.Join(s.backupDir, cleanName)
	rel, err := filepath.Rel(s.backupDir, fullPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", ErrPathTraversal
	}

	return fullPath, nil
}

// ListBackups returns all backup snapshot files in the backup directory, newest first.
func (s *Service) ListBackups(ctx context.Context) ([]BackupInfo, error) {
	entries, err := os.ReadDir(s.backupDir)
	if err != nil {
		return nil, err
	}

	var list []BackupInfo
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".json" && ext != ".sql" && ext != ".gz" {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		fmtType := "json"
		if strings.HasSuffix(name, ".sql.gz") || strings.HasSuffix(name, ".gz") {
			fmtType = "sql.gz"
		} else if ext == ".sql" {
			fmtType = "sql"
		}

		list = append(list, BackupInfo{
			Filename:  name,
			SizeBytes: info.Size(),
			CreatedAt: info.ModTime(),
			Format:    fmtType,
		})
	}

	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})

	return list, nil
}

// ExportJSON generates a full BackupData object containing current system state.
func (s *Service) ExportJSON(ctx context.Context) (*BackupData, error) {
	pastes, err := s.repo.GetAllPastesFull(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch pastes: %w", err)
	}
	if pastes == nil {
		pastes = []*paste.Paste{}
	}

	files, err := s.repo.GetAllFilesFull(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch files: %w", err)
	}
	if files == nil {
		files = []*paste.FileRecord{}
	}

	reports, err := s.repo.GetAllReportsFull(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch reports: %w", err)
	}
	if reports == nil {
		reports = []*report.Report{}
	}

	st, _ := s.repo.GetSettings(ctx)

	return &BackupData{
		Version:    "1.0",
		ExportedAt: s.now().UTC(),
		Pastes:     pastes,
		Files:      files,
		Settings:   st,
		Reports:    reports,
	}, nil
}

// CreateSnapshot creates a new timestamped JSON backup snapshot in the backup directory.
func (s *Service) CreateSnapshot(ctx context.Context) (*BackupInfo, error) {
	data, err := s.ExportJSON(ctx)
	if err != nil {
		return nil, err
	}

	timestamp := s.now().UTC().Format("2006-01-02T15-04-05")
	filename := fmt.Sprintf("darkcopy-backup-%s.json", timestamp)
	fullPath, err := s.ValidateFilename(filename)
	if err != nil {
		return nil, err
	}

	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal backup data: %w", err)
	}

	if err := os.WriteFile(fullPath, raw, 0600); err != nil {
		return nil, fmt.Errorf("failed to write snapshot file: %w", err)
	}

	info, _ := os.Stat(fullPath)
	size := int64(len(raw))
	modTime := s.now()
	if info != nil {
		size = info.Size()
		modTime = info.ModTime()
	}

	return &BackupInfo{
		Filename:  filename,
		SizeBytes: size,
		CreatedAt: modTime,
		Format:    "json",
	}, nil
}

// RestoreJSONPayload validates and restores system state from a JSON backup payload.
func (s *Service) RestoreJSONPayload(ctx context.Context, raw []byte) (*RestoreResult, error) {
	var data BackupData
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidBackupData, err)
	}

	if data.Version == "" {
		return nil, fmt.Errorf("%w: missing backup version", ErrInvalidBackupData)
	}

	restoredPastes := 0
	if len(data.Pastes) > 0 {
		count, err := s.repo.RestorePastes(ctx, data.Pastes)
		if err != nil {
			return nil, fmt.Errorf("failed restoring pastes: %w", err)
		}
		restoredPastes = count
	}

	restoredFiles := 0
	if len(data.Files) > 0 {
		count, err := s.repo.RestoreFiles(ctx, data.Files)
		if err != nil {
			return nil, fmt.Errorf("failed restoring files: %w", err)
		}
		restoredFiles = count
	}

	restoredReports := 0
	if len(data.Reports) > 0 {
		count, err := s.repo.RestoreReports(ctx, data.Reports)
		if err != nil {
			return nil, fmt.Errorf("failed restoring reports: %w", err)
		}
		restoredReports = count
	}

	settingsUpdated := false
	if data.Settings != nil {
		if err := s.repo.RestoreSettings(ctx, data.Settings); err == nil {
			settingsUpdated = true
		}
	}

	if s.flusher != nil {
		_ = s.flusher.FlushAllCaches(ctx)
	}

	return &RestoreResult{
		Success:         true,
		RestoredPastes:  restoredPastes,
		RestoredFiles:   restoredFiles,
		RestoredReports: restoredReports,
		SettingsUpdated: settingsUpdated,
	}, nil
}

// RestoreServerSnapshot restores state from an existing snapshot file in s.backupDir.
func (s *Service) RestoreServerSnapshot(ctx context.Context, filename string) (*RestoreResult, error) {
	fullPath, err := s.ValidateFilename(filename)
	if err != nil {
		return nil, err
	}

	raw, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrBackupNotFound
		}
		return nil, fmt.Errorf("failed reading backup file: %w", err)
	}

	return s.RestoreJSONPayload(ctx, raw)
}
