package backup_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/cymerz/darkcopy/internal/backup"
	"github.com/cymerz/darkcopy/internal/paste"
	"github.com/cymerz/darkcopy/internal/report"
	"github.com/cymerz/darkcopy/internal/settings"
)

type mockRepo struct {
	pastes   []*paste.Paste
	files    []*paste.FileRecord
	reports  []*report.Report
	settings *settings.Settings
}

func (m *mockRepo) GetAllPastesFull(ctx context.Context) ([]*paste.Paste, error) {
	return m.pastes, nil
}
func (m *mockRepo) GetAllFilesFull(ctx context.Context) ([]*paste.FileRecord, error) {
	return m.files, nil
}
func (m *mockRepo) GetAllReportsFull(ctx context.Context) ([]*report.Report, error) {
	return m.reports, nil
}
func (m *mockRepo) GetSettings(ctx context.Context) (*settings.Settings, error) {
	return m.settings, nil
}
func (m *mockRepo) RestorePastes(ctx context.Context, pastes []*paste.Paste) (int, error) {
	m.pastes = pastes
	return len(pastes), nil
}
func (m *mockRepo) RestoreFiles(ctx context.Context, files []*paste.FileRecord) (int, error) {
	m.files = files
	return len(files), nil
}
func (m *mockRepo) RestoreReports(ctx context.Context, reports []*report.Report) (int, error) {
	m.reports = reports
	return len(reports), nil
}
func (m *mockRepo) RestoreSettings(ctx context.Context, s *settings.Settings) error {
	m.settings = s
	return nil
}

type mockFlusher struct {
	flushed bool
}

func (f *mockFlusher) FlushAllCaches(ctx context.Context) error {
	f.flushed = true
	return nil
}

func TestValidateFilename_PathTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	svc, err := backup.NewService(tmpDir, &mockRepo{}, &mockFlusher{})
	if err != nil {
		t.Fatalf("Failed creating service: %v", err)
	}

	invalidNames := []string{
		"../.env",
		"../../etc/passwd",
		"..\\windows\\system32",
		"/etc/passwd",
		"C:\\boot.ini",
		"sub/folder/backup.json",
		"invalid.exe",
		"script.sh",
	}

	for _, name := range invalidNames {
		_, err := svc.ValidateFilename(name)
		if err == nil {
			t.Errorf("Expected error for invalid filename %q, got nil", name)
		}
	}
}

func TestValidateFilename_Valid(t *testing.T) {
	tmpDir := t.TempDir()
	svc, err := backup.NewService(tmpDir, &mockRepo{}, &mockFlusher{})
	if err != nil {
		t.Fatalf("Failed creating service: %v", err)
	}

	validNames := []string{
		"darkcopy-backup-2026-08-01.json",
		"db-backup-2026-08-01.sql",
		"db-backup-2026-08-01.sql.gz",
	}

	for _, name := range validNames {
		fullPath, err := svc.ValidateFilename(name)
		if err != nil {
			t.Errorf("Unexpected error for valid filename %q: %v", name, err)
		}
		expectedPath := filepath.Join(tmpDir, name)
		if fullPath != expectedPath {
			t.Errorf("Expected path %q, got %q", expectedPath, fullPath)
		}
	}
}

func TestCreateSnapshotAndRestore(t *testing.T) {
	tmpDir := t.TempDir()
	repo := &mockRepo{
		pastes: []*paste.Paste{
			{ID: uuid.New(), Slug: "testslug", Title: "Test Paste", Content: "Hello World", Language: "plaintext", Visibility: paste.VisibilityPublic, CreatedAt: time.Now()},
		},
		files: []*paste.FileRecord{
			{ID: uuid.New(), Slug: "fileslug", Filename: "test.txt", MIMEType: "text/plain", SizeBytes: 100, StorageKey: "uploads/fileslug/test.txt", Visibility: paste.VisibilityPublic, CreatedAt: time.Now()},
		},
	}
	flusher := &mockFlusher{}

	svc, err := backup.NewService(tmpDir, repo, flusher)
	if err != nil {
		t.Fatalf("Failed creating service: %v", err)
	}

	info, err := svc.CreateSnapshot(context.Background())
	if err != nil {
		t.Fatalf("Failed creating snapshot: %v", err)
	}

	if info.Filename == "" {
		t.Errorf("Expected filename, got empty")
	}

	backups, err := svc.ListBackups(context.Background())
	if err != nil {
		t.Fatalf("Failed listing backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("Expected 1 backup, got %d", len(backups))
	}

	// Reset mock repository state
	repo.pastes = nil
	repo.files = nil

	// Perform snapshot restore
	res, err := svc.RestoreServerSnapshot(context.Background(), info.Filename)
	if err != nil {
		t.Fatalf("Failed restoring snapshot: %v", err)
	}

	if !res.Success {
		t.Errorf("Expected restore success true")
	}
	if res.RestoredPastes != 1 {
		t.Errorf("Expected 1 restored paste, got %d", res.RestoredPastes)
	}
	if res.RestoredFiles != 1 {
		t.Errorf("Expected 1 restored file, got %d", res.RestoredFiles)
	}
	if !flusher.flushed {
		t.Errorf("Expected cache flusher to be called")
	}
}

func TestRestoreJSONPayload_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	svc, _ := backup.NewService(tmpDir, &mockRepo{}, &mockFlusher{})

	_, err := svc.RestoreJSONPayload(context.Background(), []byte("invalid json"))
	if err == nil {
		t.Errorf("Expected error for invalid json, got nil")
	}
}
