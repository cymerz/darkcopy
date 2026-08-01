package handler

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/cymerz/darkcopy/internal/admin"
	"github.com/cymerz/darkcopy/internal/backup"
	"github.com/cymerz/darkcopy/internal/report"
	"github.com/cymerz/darkcopy/internal/settings"
)

// AdminService defines the administrative operations used by the handler.
type AdminService interface {
	ListPastes(ctx context.Context, limit, offset int) ([]*admin.PasteItem, error)
	DeletePaste(ctx context.Context, slug string) error
	ListFiles(ctx context.Context, limit, offset int) ([]*admin.FileItem, error)
	DeleteFile(ctx context.Context, slug string) error
	Stats(ctx context.Context) (*admin.Stats, error)
	PurgeExpired(ctx context.Context) (int, error)
}

// BackupService defines operations for managing system backups and restores.
type BackupService interface {
	ListBackups(ctx context.Context) ([]backup.BackupInfo, error)
	CreateSnapshot(ctx context.Context) (*backup.BackupInfo, error)
	ValidateFilename(filename string) (string, error)
	RestoreServerSnapshot(ctx context.Context, filename string, wipeFirst bool) (*backup.RestoreResult, error)
	RestoreJSONPayload(ctx context.Context, raw []byte, wipeFirst bool) (*backup.RestoreResult, error)
}

// SettingsManager exposes read/update of runtime settings to the admin handler.
// It is satisfied by *settings.Manager. May be nil when settings management is
// not wired, in which case the settings endpoints return 503.
type SettingsManager interface {
	Get() settings.Settings
	Update(ctx context.Context, s settings.Settings) error
}

// ReportManager exposes report review operations to the admin handler. It is
// satisfied by *report.Service. May be nil to disable the report endpoints.
type ReportManager interface {
	List(ctx context.Context, status string, limit, offset int) ([]*report.Report, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status report.Status) error
	Delete(ctx context.Context, id uuid.UUID) error
	CountPending(ctx context.Context) (int, error)
}

// AdminHandler handles HTTP requests for administrative operations. Access is
// guarded by a shared secret token compared in constant time; when the token is
// empty the admin API is disabled entirely (all routes return 404).
type AdminHandler struct {
	adminService AdminService
	settings     SettingsManager
	reports      ReportManager
	backups      BackupService
	token        string
}

// NewAdminHandler creates a new AdminHandler. An empty token disables the admin
// API (every request is rejected with 404 to avoid revealing the endpoint).
// settingsMgr and reportMgr may be nil to disable their respective endpoints.
func NewAdminHandler(as AdminService, settingsMgr SettingsManager, reportMgr ReportManager, token string) *AdminHandler {
	return &AdminHandler{
		adminService: as,
		settings:     settingsMgr,
		reports:      reportMgr,
		token:        token,
	}
}

// WithBackupService attaches a BackupService to the AdminHandler.
func (h *AdminHandler) WithBackupService(bs BackupService) *AdminHandler {
	h.backups = bs
	return h
}

// RegisterAdminRoutes mounts all admin routes under the /admin prefix. Mounting
// under a dedicated prefix keeps them clear of the root-level "/{slug}" route.
func RegisterAdminRoutes(r chi.Router, h *AdminHandler) {
	r.Route("/admin", func(ar chi.Router) {
		ar.Use(h.requireToken)
		ar.Get("/stats", h.HandleStats)
		ar.Get("/pastes", h.HandleListPastes)
		ar.Delete("/pastes/{slug}", h.HandleDeletePaste)
		ar.Get("/files", h.HandleListFiles)
		ar.Delete("/files/{slug}", h.HandleDeleteFile)
		ar.Post("/purge-expired", h.HandlePurgeExpired)
		ar.Get("/settings", h.HandleGetSettings)
		ar.Put("/settings", h.HandleUpdateSettings)
		ar.Get("/reports", h.HandleListReports)
		ar.Patch("/reports/{id}", h.HandleUpdateReportStatus)
		ar.Delete("/reports/{id}", h.HandleDeleteReport)
		ar.Get("/backups", h.HandleListBackups)
		ar.Post("/backups/create", h.HandleCreateSnapshot)
		ar.Get("/backups/download/{filename}", h.HandleDownloadBackup)
		ar.Post("/backups/restore", h.HandleRestoreRecentBackup)
		ar.Post("/backups/restore-json", h.HandleRestoreUploadedJSON)
	})
}

// requireToken is middleware that enforces the admin token. The token may be
// provided via the "X-Admin-Token" header or an "Authorization: Bearer <token>"
// header. When no token is configured the admin API is disabled and responds
// with 404 so its existence is not advertised.
func (h *AdminHandler) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.token == "" {
			http.NotFound(w, r)
			return
		}

		provided := r.Header.Get("X-Admin-Token")
		if provided == "" {
			if auth := r.Header.Get("Authorization"); len(auth) > 7 && auth[:7] == "Bearer " {
				provided = auth[7:]
			}
		}
		if provided == "" {
			provided = r.URL.Query().Get("token")
		}

		if subtle.ConstantTimeCompare([]byte(provided), []byte(h.token)) != 1 {
			writeJSONError(w, http.StatusUnauthorized, "Invalid admin token", "ADMIN_UNAUTHORIZED")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// HandleStats returns aggregate counts of pastes and files.
func (h *AdminHandler) HandleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.adminService.Stats(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to load statistics", "INTERNAL_ERROR")
		return
	}

	// Include the count of reports awaiting review when reports are enabled.
	pendingReports := 0
	if h.reports != nil {
		if n, cerr := h.reports.CountPending(r.Context()); cerr == nil {
			pendingReports = n
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_pastes":    stats.TotalPastes,
		"total_files":     stats.TotalFiles,
		"total_bytes":     stats.TotalBytes,
		"provider_stats":  stats.ProviderStats,
		"pending_reports": pendingReports,
		"top_pastes":      stats.TopPastes,
		"top_files":       stats.TopFiles,
	})
}

// HandlePurgeExpired triggers an immediate cleanup of all expired pastes and
// files (DB rows and file blobs), returning how many items were removed.
func (h *AdminHandler) HandlePurgeExpired(w http.ResponseWriter, r *http.Request) {
	deleted, err := h.adminService.PurgeExpired(r.Context())
	if err != nil {
		if errors.Is(err, admin.ErrPurgeUnavailable) {
			writeJSONError(w, http.StatusServiceUnavailable, "Expired purge not available", "PURGE_UNAVAILABLE")
			return
		}
		// Some items may have been removed before the error; report the failure
		// but the client can refresh to see partial progress.
		writeJSONError(w, http.StatusInternalServerError, "Failed to clean expired items", "INTERNAL_ERROR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "deleted": deleted})
}

// HandleGetSettings returns the current runtime settings.
func (h *AdminHandler) HandleGetSettings(w http.ResponseWriter, r *http.Request) {
	if h.settings == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Settings not available", "SETTINGS_UNAVAILABLE")
		return
	}
	writeJSON(w, http.StatusOK, h.settings.Get())
}

// HandleUpdateSettings validates and applies a full settings update.
func (h *AdminHandler) HandleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	if h.settings == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Settings not available", "SETTINGS_UNAVAILABLE")
		return
	}

	var s settings.Settings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid request body", "BAD_REQUEST")
		return
	}

	if err := h.settings.Update(r.Context(), s); err != nil {
		// Validation errors carry a user-facing message.
		if errors.Is(err, settings.ErrInvalidPasteSize) ||
			errors.Is(err, settings.ErrInvalidFileSize) ||
			errors.Is(err, settings.ErrNoExpiryOptions) ||
			errors.Is(err, settings.ErrTooManyExpiry) ||
			errors.Is(err, settings.ErrInvalidExpiry) ||
			errors.Is(err, settings.ErrInvalidDailyLimit) {
			writeJSONError(w, http.StatusBadRequest, err.Error(), "VALIDATION_ERROR")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to save settings", "INTERNAL_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, h.settings.Get())
}

// HandleListReports returns reports, optionally filtered by ?status=.
func (h *AdminHandler) HandleListReports(w http.ResponseWriter, r *http.Request) {
	if h.reports == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Reports not available", "REPORTS_UNAVAILABLE")
		return
	}

	limit, offset := paginationParams(r)
	status := r.URL.Query().Get("status")

	reports, err := h.reports.List(r.Context(), status, limit, offset)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to load reports", "INTERNAL_ERROR")
		return
	}
	if reports == nil {
		reports = []*report.Report{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"reports": reports})
}

// HandleUpdateReportStatus changes a report's review status. The body is
// {"status": "reviewed"|"dismissed"|"pending"}.
func (h *AdminHandler) HandleUpdateReportStatus(w http.ResponseWriter, r *http.Request) {
	if h.reports == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Reports not available", "REPORTS_UNAVAILABLE")
		return
	}

	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid report ID", "BAD_REQUEST")
		return
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid request body", "BAD_REQUEST")
		return
	}

	if err := h.reports.UpdateStatus(r.Context(), id, report.Status(body.Status)); err != nil {
		if errors.Is(err, report.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "Report not found", "NOT_FOUND")
			return
		}
		if errors.Is(err, report.ErrInvalidStatus) {
			writeJSONError(w, http.StatusBadRequest, err.Error(), "VALIDATION_ERROR")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to update report", "INTERNAL_ERROR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

// HandleDeleteReport removes a report by id.
func (h *AdminHandler) HandleDeleteReport(w http.ResponseWriter, r *http.Request) {
	if h.reports == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Reports not available", "REPORTS_UNAVAILABLE")
		return
	}

	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid report ID", "BAD_REQUEST")
		return
	}

	if err := h.reports.Delete(r.Context(), id); err != nil {
		if errors.Is(err, report.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "Report not found", "NOT_FOUND")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to delete report", "INTERNAL_ERROR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}
func (h *AdminHandler) HandleListPastes(w http.ResponseWriter, r *http.Request) {
	limit, offset := paginationParams(r)

	pastes, err := h.adminService.ListPastes(r.Context(), limit, offset)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to load paste list", "INTERNAL_ERROR")
		return
	}
	if pastes == nil {
		pastes = []*admin.PasteItem{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"pastes": pastes})
}

// HandleDeletePaste deletes a paste by its slug.
func (h *AdminHandler) HandleDeletePaste(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	if err := h.adminService.DeletePaste(r.Context(), slug); err != nil {
		if errors.Is(err, admin.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "Paste not found", "NOT_FOUND")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to delete paste", "INTERNAL_ERROR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "slug": slug})
}

// HandleListFiles returns all uploaded files with optional pagination.
func (h *AdminHandler) HandleListFiles(w http.ResponseWriter, r *http.Request) {
	limit, offset := paginationParams(r)

	files, err := h.adminService.ListFiles(r.Context(), limit, offset)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to load file list", "INTERNAL_ERROR")
		return
	}
	if files == nil {
		files = []*admin.FileItem{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"files": files})
}

// HandleDeleteFile deletes a file (record and blob) by its slug.
func (h *AdminHandler) HandleDeleteFile(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	if err := h.adminService.DeleteFile(r.Context(), slug); err != nil {
		if errors.Is(err, admin.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "File not found", "NOT_FOUND")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to delete file", "INTERNAL_ERROR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "slug": slug})
}

// paginationParams reads optional "limit" and "offset" query parameters,
// clamping limit to the range [1, 200] with a default of 100, and offset to a
// minimum of 0.
func paginationParams(r *http.Request) (limit, offset int) {
	limit = 100
	offset = 0

	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 200 {
		limit = 200
	}

	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			offset = n
		}
	}
	return limit, offset
}

// HandleListBackups returns available backup snapshots.
func (h *AdminHandler) HandleListBackups(w http.ResponseWriter, r *http.Request) {
	if h.backups == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Backup service not available", "BACKUP_UNAVAILABLE")
		return
	}
	list, err := h.backups.ListBackups(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to list backups", "INTERNAL_ERROR")
		return
	}
	if list == nil {
		list = []backup.BackupInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"backups": list})
}

// HandleCreateSnapshot generates a new backup snapshot file on the server.
func (h *AdminHandler) HandleCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.backups == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Backup service not available", "BACKUP_UNAVAILABLE")
		return
	}
	info, err := h.backups.CreateSnapshot(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to create snapshot", "INTERNAL_ERROR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "backup": info})
}

// HandleDownloadBackup streams a backup snapshot file to the client.
func (h *AdminHandler) HandleDownloadBackup(w http.ResponseWriter, r *http.Request) {
	if h.backups == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Backup service not available", "BACKUP_UNAVAILABLE")
		return
	}
	filename := chi.URLParam(r, "filename")
	fullPath, err := h.backups.ValidateFilename(filename)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}

	file, err := os.Open(fullPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeJSONError(w, http.StatusNotFound, "Backup file not found", "NOT_FOUND")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed opening backup file", "INTERNAL_ERROR")
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	_, _ = io.Copy(w, file)
}

// HandleRestoreRecentBackup restores state from a server snapshot file.
func (h *AdminHandler) HandleRestoreRecentBackup(w http.ResponseWriter, r *http.Request) {
	if h.backups == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Backup service not available", "BACKUP_UNAVAILABLE")
		return
	}

	var body struct {
		Filename  string `json:"filename"`
		WipeFirst bool   `json:"wipe_first"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Filename == "" {
		writeJSONError(w, http.StatusBadRequest, "Invalid request body: filename required", "BAD_REQUEST")
		return
	}

	res, err := h.backups.RestoreServerSnapshot(r.Context(), body.Filename, body.WipeFirst)
	if err != nil {
		if errors.Is(err, backup.ErrBackupNotFound) {
			writeJSONError(w, http.StatusNotFound, "Backup snapshot not found", "NOT_FOUND")
			return
		}
		if errors.Is(err, backup.ErrPathTraversal) || errors.Is(err, backup.ErrInvalidFilename) || errors.Is(err, backup.ErrUnsupportedFormat) {
			writeJSONError(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to restore backup: "+err.Error(), "INTERNAL_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, res)
}

// HandleRestoreUploadedJSON validates and restores state from an uploaded JSON file payload.
func (h *AdminHandler) HandleRestoreUploadedJSON(w http.ResponseWriter, r *http.Request) {
	if h.backups == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Backup service not available", "BACKUP_UNAVAILABLE")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 100<<20) // Cap upload at 100MB
	var raw []byte
	var err error

	if contentType := r.Header.Get("Content-Type"); len(contentType) >= 19 && contentType[:19] == "multipart/form-data" {
		file, _, ferr := r.FormFile("file")
		if ferr != nil {
			writeJSONError(w, http.StatusBadRequest, "Missing file in multipart request", "BAD_REQUEST")
			return
		}
		defer file.Close()
		raw, err = io.ReadAll(file)
	} else {
		raw, err = io.ReadAll(r.Body)
	}

	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Failed to read backup payload", "BAD_REQUEST")
		return
	}

	wipeFirst := r.FormValue("wipe_first") == "true" || r.URL.Query().Get("wipe_first") == "true"
	res, err := h.backups.RestoreJSONPayload(r.Context(), raw, wipeFirst)
	if err != nil {
		if errors.Is(err, backup.ErrInvalidBackupData) {
			writeJSONError(w, http.StatusBadRequest, err.Error(), "VALIDATION_ERROR")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to restore backup payload: "+err.Error(), "INTERNAL_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, res)
}

