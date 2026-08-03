package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/cymerz/darkcopy/internal/file"
	"github.com/cymerz/darkcopy/internal/paste"
)

// FileService defines the interface for file operations used by the handler.
type FileService interface {
	Upload(ctx context.Context, req paste.UploadFileRequest) (*paste.FileRecord, error)
	GetBySlug(ctx context.Context, slug string) (*paste.FileRecord, error)
	ServeFile(ctx context.Context, slug string, w http.ResponseWriter) error
	ValidatePassword(ctx context.Context, slug, password string) (bool, error)
	ListPublicRecent(ctx context.Context, limit int) ([]*paste.FileSummary, error)
	PresignDownloadURL(ctx context.Context, slug string, inline bool) (string, error)
	IncrementDownloads(ctx context.Context, slug string) error
	Search(ctx context.Context, query string, limit int) ([]*paste.FileSummary, error)

	// Direct S3 upload methods
	SupportsUploadPresigning() bool
	PresignUploadURL(ctx context.Context, filename, contentType string, size int64) (slug, storageKey, uploadURL string, err error)
	RegisterUploadedFile(ctx context.Context, req paste.RegisterFileRequest) (*paste.FileRecord, error)
}

// FileHandler handles HTTP requests for file upload and retrieval.
type FileHandler struct {
	fileService      FileService
	accessController AccessController
	// settings supplies runtime-configurable expiry options; may be nil.
	settings SettingsProvider
	// quota enforces per-IP daily upload limits; may be nil (no limit).
	quota DailyQuota
	// sizeQuota enforces global/per-IP daily upload size limits; may be nil.
	sizeQuota DailySizeQuota

	// maxMultipartMem is the max RAM in bytes allowed for parsing a single multipart form.
	// Larger portions of the upload are automatically written to the VPS disk temp directory.
	maxMultipartMem int64
	// maxMemTotalUsage is the global RAM cap in bytes for all concurrent uploads combined.
	maxMemTotalUsage int64
	// activeUploads tracks the count of currently parsing multipart upload requests (thread-safe).
	activeUploads int64
}

// NewFileHandler creates a new FileHandler with the given dependencies.
func NewFileHandler(fs FileService, ac AccessController) *FileHandler {
	return &FileHandler{
		fileService:      fs,
		accessController: ac,
	}
}

// SetMaxMultipartMemory configures the dynamic multipart memory limits (in bytes) for uploads.
func (h *FileHandler) SetMaxMultipartMemory(perRequestBytes, totalBytes int64) {
	if perRequestBytes <= 0 {
		perRequestBytes = 32 * 1024 * 1024
	}
	if totalBytes <= 0 {
		totalBytes = 64 * 1024 * 1024
	}
	h.maxMultipartMem = perRequestBytes
	h.maxMemTotalUsage = totalBytes
}

// SetSettings installs a settings provider used for dynamic expiry options.
func (h *FileHandler) SetSettings(sp SettingsProvider) { h.settings = sp }

// SetQuota installs a daily quota enforcer for file uploads.
func (h *FileHandler) SetQuota(q DailyQuota) { h.quota = q }

// SetSizeQuota installs a daily size quota enforcer for file uploads.
func (h *FileHandler) SetSizeQuota(q DailySizeQuota) { h.sizeQuota = q }

// RegisterFileRoutes registers all file-related routes on the given chi router.
func RegisterFileRoutes(r chi.Router, h *FileHandler) {
	r.Get("/upload", h.ShowUploadForm)
	r.Post("/upload", h.HandleUpload)
	r.Post("/upload/presign", h.HandlePresignUpload)
	r.Post("/upload/register", h.HandleRegisterUploadedFile)
	r.Get("/f/search", h.HandleSearchFiles)
	r.Get("/f/{slug}", h.GetFile)
	r.Head("/f/{slug}", h.GetFile)
	r.Get("/f/{slug}/direct", h.DirectDownload)
	r.Post("/f/{slug}/unlock", h.UnlockFile)
}

// ShowUploadForm renders the file upload form with expiry and visibility options.
func (h *FileHandler) ShowUploadForm(w http.ResponseWriter, r *http.Request) {
	maxFileSize := int64(file.MaxFileSize)
	disableFileUploads := false
	useDirectUpload := false
	if h.settings != nil {
		maxFileSize = h.settings.Get().MaxFileSizeBytes
		disableFileUploads = h.settings.Get().DisableFileUploads
		useDirectUpload = h.settings.Get().UseDirectUpload
	}
	resp := map[string]interface{}{
		"expiry_options":       h.fileExpiryOptions(),
		"visibilities":         []string{"public", "unlisted", "password_protected"},
		"max_file_size":        maxFileSize,
		"disable_file_uploads": disableFileUploads,
		"use_direct_upload":    useDirectUpload && h.fileService.SupportsUploadPresigning(),
	}
	writeJSON(w, http.StatusOK, resp)
}

// fileExpiryOptions returns the upload form's expiry options in the
// {label, duration(min)} wire shape, using dynamic settings when available and
// falling back to the built-in paste.FileExpiryOptions.
func (h *FileHandler) fileExpiryOptions() []map[string]interface{} {
	if h.settings != nil {
		opts := h.settings.Get().FileExpiryOptions
		if len(opts) > 0 {
			out := make([]map[string]interface{}, 0, len(opts))
			for _, o := range opts {
				out = append(out, map[string]interface{}{"label": o.Label, "duration": o.Minutes})
			}
			return out
		}
	}
	out := make([]map[string]interface{}, 0, len(paste.FileExpiryOptions))
	for _, o := range paste.FileExpiryOptions {
		out = append(out, map[string]interface{}{"label": o.Label, "duration": int64(o.Duration.Minutes())})
	}
	return out
}

// HandleUpload processes a multipart file upload form submission.
func (h *FileHandler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	// Enforce temporary disable setting
	if h.settings != nil && h.settings.Get().DisableFileUploads {
		writeJSON(w, http.StatusForbidden, errorResponse{
			Error:  "File uploads are temporarily disabled by the administrator.",
			Code:   "UPLOADS_DISABLED",
			Status: http.StatusForbidden,
		})
		return
	}

	// Enforce direct upload policy for API/CLI when configured by administrator.
	if h.settings != nil && h.settings.Get().EnforceDirectUploadAPI && h.fileService.SupportsUploadPresigning() {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Direct server uploads are disabled by admin policy. Please use the pre-signed upload API.",
			Code:   "DIRECT_UPLOAD_REQUIRED",
			Status: http.StatusBadRequest,
		})
		return
	}

	// Enforce per-IP daily upload limit when configured.
	if h.quota != nil && h.settings != nil {
		limit := h.settings.Get().MaxFileUploadsPerDayPerIP
		if limit > 0 {
			key := "upload:" + fileClientIP(r)
			if allowed, _ := h.quota.Allow(key, limit); !allowed {
				writeJSON(w, http.StatusTooManyRequests, errorResponse{
					Error:  "Daily file upload limit reached. Try again tomorrow.",
					Code:   "DAILY_LIMIT_REACHED",
					Status: http.StatusTooManyRequests,
				})
				return
			}
		}
	}

	// Apply max body size cap before parsing multipart form.
	// We use the configured file size cap from settings + 10MB headroom for form fields, with a hard 100MB minimum.
	fileSizeCap := int64(file.MaxFileSize)
	if h.settings != nil {
		if s := h.settings.Get().MaxFileSizeBytes; s > 0 {
			fileSizeCap = s
		}
	}
	const headroom = 10 << 20 // 10MB for multipart overhead and form fields
	maxBodySize := fileSizeCap + headroom
	r.Body = http.MaxBytesReader(w, r.Body, maxBodySize)

	// Dynamic memory allocation: scale down per-request RAM based on concurrent upload count.
	// This keeps the total RAM across all uploads bounded by maxMemTotalUsage while using
	// up to maxMultipartMem for a single idle request.
	activeCount := atomic.AddInt64(&h.activeUploads, 1)
	defer atomic.AddInt64(&h.activeUploads, -1)

	allocatedBytes := h.maxMemTotalUsage / activeCount
	if allocatedBytes > h.maxMultipartMem {
		allocatedBytes = h.maxMultipartMem
	}
	const minMemoryBytes int64 = 1 * 1024 * 1024 // 1 MB minimum to prevent thrashing
	if allocatedBytes < minMemoryBytes {
		allocatedBytes = minMemoryBytes
	}

	if err := r.ParseMultipartForm(allocatedBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Failed to process upload form",
			Code:   "INVALID_FORM",
			Status: http.StatusBadRequest,
		})
		return
	}
	// Ensure temporary files in /tmp (from ParseMultipartForm disk overflow) are cleaned up.
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	// Extract file from form field "file".
	f, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "File not found in form",
			Code:   "FILE_MISSING",
			Status: http.StatusBadRequest,
		})
		return
	}
	defer f.Close()

	// Enforce daily size limits (global and per-IP) when configured.
	if h.sizeQuota != nil && h.settings != nil {
		set := h.settings.Get()
		clientIP := fileClientIP(r)

		// 1. Enforce global daily upload size limit
		if set.MaxDailyUploadBytes > 0 {
			allowed, _ := h.sizeQuota.Allow("global_size", header.Size, set.MaxDailyUploadBytes)
			if !allowed {
				writeJSON(w, http.StatusTooManyRequests, errorResponse{
					Error:  "System daily upload size limit reached.",
					Code:   "GLOBAL_DAILY_SIZE_LIMIT_REACHED",
					Status: http.StatusTooManyRequests,
				})
				return
			}
		}

		// 2. Enforce per-IP daily upload size limit
		if set.MaxDailyUploadBytesPerIP > 0 {
			allowed, _ := h.sizeQuota.Allow("ip_size:"+clientIP, header.Size, set.MaxDailyUploadBytesPerIP)
			if !allowed {
				writeJSON(w, http.StatusTooManyRequests, errorResponse{
					Error:  "Your daily upload size limit reached. Try again tomorrow.",
					Code:   "IP_DAILY_SIZE_LIMIT_REACHED",
					Status: http.StatusTooManyRequests,
				})
				return
			}
		}
	}

	// Extract form values.
	visibility := paste.Visibility(r.FormValue("visibility"))
	if visibility == "" {
		visibility = paste.VisibilityPublic
	}
	password := r.FormValue("password")
	expiresInStr := r.FormValue("expires_in")

	// Parse expires_in as duration string.
	expiresIn, err := parseExpiryDuration(expiresInStr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Invalid expiration duration format",
			Code:   "INVALID_EXPIRY",
			Status: http.StatusBadRequest,
		})
		return
	}

	// Detect MIME type from file header.
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	req := paste.UploadFileRequest{
		Filename:   header.Filename,
		MIMEType:   mimeType,
		Size:       header.Size,
		Reader:     f,
		Visibility: visibility,
		Password:   password,
		ExpiresIn:  expiresIn,
	}

	record, err := h.fileService.Upload(r.Context(), req)
	if err != nil {
		handleFileServiceError(w, err)
		return
	}

	if wantsPlain(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(getBaseURL(r) + "/f/" + record.Slug + "\n"))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"success":  true,
		"slug":     record.Slug,
		"url":      fmt.Sprintf("/f/%s", record.Slug),
		"full_url": getBaseURL(r) + "/f/" + record.Slug,
		"md5_hash": record.MD5Hash,
	})
}

// GetFile retrieves a file by slug and serves it or indicates password protection.
func (h *FileHandler) GetFile(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	record, err := h.fileService.GetBySlug(r.Context(), slug)
	if err != nil {
		handleFileServiceError(w, err)
		return
	}

	// If file is password protected, return 401 indicating password required.
	if record.Visibility == paste.VisibilityPasswordProtected {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"error":             "This file is password protected",
			"code":              "PASSWORD_REQUIRED",
			"status":            http.StatusUnauthorized,
			"password_required": true,
			"slug":              record.Slug,
		})
		return
	}

	// Check if preview/inline is requested via query param
	inline := r.URL.Query().Get("preview") == "true" || r.URL.Query().Get("inline") == "true"
	ctx := r.Context()
	if inline {
		ctx = context.WithValue(ctx, "serve_inline", true)
	}

	// Capture and forward HTTP Range headers for media seeking
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		ctx = context.WithValue(ctx, "range_header", rangeHeader)
	}

	// SECURITY (VULN-03): Force attachment for dangerous MIME types to prevent stored XSS.
	mimeNormalized := strings.ToLower(strings.TrimSpace(record.MIMEType))
	if file.IsDangerousMIME(mimeNormalized) {
		inline = false
	}

	// Serve the file.
	if r.Method == "HEAD" {
		disposition := "attachment"
		if inline {
			disposition = "inline"
		}
		// SECURITY (VULN-01): Sanitize filename in Content-Disposition header.
		safeName := strings.NewReplacer(`"`, `'`, "\r", "", "\n", "", "\x00", "").Replace(record.Filename)
		w.Header().Set("Content-Type", record.MIMEType)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, safeName))
		w.Header().Set("Content-Length", strconv.FormatInt(record.SizeBytes, 10))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Downloads-Count", strconv.Itoa(record.Downloads))
			if record.MD5Hash != "" {
				w.Header().Set("X-File-MD5", record.MD5Hash)
			}
						if record.SHA256Hash != "" {
				w.Header().Set("X-File-SHA256", record.SHA256Hash)
			}
				if record.ExpiresAt != nil {
					w.Header().Set("X-File-Expires-At", record.ExpiresAt.Format(time.RFC3339))
			}
		w.WriteHeader(http.StatusOK)
		return
	}

	if err := h.fileService.ServeFile(ctx, slug, w); err != nil {
		log.Printf("ERROR: failed to serve file %s: %v", slug, err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error:  "Failed to serve file",
			Code:   "SERVE_ERROR",
			Status: http.StatusInternalServerError,
		})
	}
}

// DirectDownload generates a presigned S3 URL and redirects the client directly
// to S3 for downloading the file, bypassing the backend streaming proxy entirely.
// Supports ?preview=true for inline display (images, videos, audio).
func (h *FileHandler) DirectDownload(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	record, err := h.fileService.GetBySlug(r.Context(), slug)
	if err != nil {
		handleFileServiceError(w, err)
		return
	}

	// Password-protected files cannot use direct download without unlocking.
	if record.Visibility == paste.VisibilityPasswordProtected {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"error":             "This file is password protected",
			"code":              "PASSWORD_REQUIRED",
			"status":            http.StatusUnauthorized,
			"password_required": true,
			"slug":              record.Slug,
		})
		return
	}

	inline := r.URL.Query().Get("preview") == "true" || r.URL.Query().Get("inline") == "true"

	// SECURITY: Force attachment for dangerous MIME types even on direct/CDN path
	// to prevent stored XSS via inline HTML/SVG/JS rendering.
	mimeNormalized := strings.ToLower(strings.TrimSpace(record.MIMEType))
	if file.IsDangerousMIME(mimeNormalized) {
		inline = false
	}

	presignedURL, err := h.fileService.PresignDownloadURL(r.Context(), slug, inline)
	if err != nil {
		// Fallback: presigning failed (local storage, S3 error, etc.).
		// Serve the file directly via the streaming proxy so it still works.
		ctx := r.Context()
		if inline {
			ctx = context.WithValue(ctx, "serve_inline", true)
		}
		if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
			ctx = context.WithValue(ctx, "range_header", rangeHeader)
		}
		if serveErr := h.fileService.ServeFile(ctx, slug, w); serveErr != nil {
			log.Printf("ERROR: fallback serve failed for %s: %v", slug, serveErr)
			handleFileServiceError(w, serveErr)
		}
		return
	}

	// Increment downloads!
	_ = h.fileService.IncrementDownloads(r.Context(), slug)

	// Redirect browser directly to the presigned S3 URL.
	http.Redirect(w, r, presignedURL, http.StatusTemporaryRedirect)
}

// UnlockFile processes a password submission to access a protected file.
func (h *FileHandler) UnlockFile(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	clientIP := fileClientIP(r)

	// Check rate limiting first.
	limited, err := h.accessController.IsRateLimited(r.Context(), clientIP, slug)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error:  "Internal error",
			Code:   "INTERNAL_ERROR",
			Status: http.StatusInternalServerError,
		})
		return
	}
	if limited {
		writeJSON(w, http.StatusTooManyRequests, errorResponse{
			Error:  "Too many attempts. Try again later.",
			Code:   "RATE_LIMITED",
			Status: http.StatusTooManyRequests,
		})
		return
	}

	// Parse password from form.
	if err := r.ParseForm(); err != nil {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Invalid form",
			Code:   "BAD_REQUEST",
			Status: http.StatusBadRequest,
		})
		return
	}

	password := r.FormValue("password")
	if password == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Password cannot be empty",
			Code:   "PASSWORD_EMPTY",
			Status: http.StatusBadRequest,
		})
		return
	}

	// Validate password.
	valid, err := h.fileService.ValidatePassword(r.Context(), slug, password)
	if err != nil {
		handleFileServiceError(w, err)
		return
	}

	if !valid {
		// Record failed attempt.
		_ = h.accessController.RecordFailedAttempt(r.Context(), clientIP, slug)
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error:  "Incorrect password",
			Code:   "INVALID_PASSWORD",
			Status: http.StatusUnauthorized,
		})
		return
	}

	// Password correct — reset rate limit and serve file.
	h.accessController.ResetRateLimit(r.Context(), clientIP, slug)

	ctx := r.Context()
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		ctx = context.WithValue(ctx, "range_header", rangeHeader)
	}

	if err := h.fileService.ServeFile(ctx, slug, w); err != nil {
		log.Printf("ERROR: failed to serve unlocked file %s: %v", slug, err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error:  "Failed to serve file",
			Code:   "SERVE_ERROR",
			Status: http.StatusInternalServerError,
		})
	}
}

// parseExpiryDuration parses an expiry duration string.
// Accepts:
//   - ""   → 0 (use service-layer default)
//   - "0"  → NeverExpires sentinel
//   - plain integer string → treated as minutes (e.g. "60" = 1 hour)
//   - Go duration string   → parsed directly (e.g. "1h", "24h")
func parseExpiryDuration(s string) (time.Duration, error) {
	if s == "" {
		return 0, nil // use default in service layer
	}

	// Try parsing as a plain integer (minutes), which is what the frontend sends.
	if minutes, err := strconv.ParseInt(s, 10, 64); err == nil {
		if minutes == 0 {
			return file.NeverExpires, nil // "Selamanya"
		}
		if minutes < 0 {
			return file.NeverExpires, nil // legacy "-1" sentinel
		}
		return time.Duration(minutes) * time.Minute, nil
	}

	// Fall back to Go duration string format (e.g. "1h", "24h").
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, err
	}
	if d <= 0 {
		return 0, fmt.Errorf("duration must be positive or 0 for never")
	}
	return d, nil
}

// handleFileServiceError maps file service errors to appropriate HTTP responses.
func handleFileServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, file.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{
			Error:  "File not found",
			Code:   "NOT_FOUND",
			Status: http.StatusNotFound,
		})
	case errors.Is(err, file.ErrExpired):
		writeJSON(w, http.StatusGone, errorResponse{
			Error:  "This file has expired",
			Code:   "RESOURCE_EXPIRED",
			Status: http.StatusGone,
		})
	case errors.Is(err, file.ErrFileTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{
			Error:  err.Error(),
			Code:   "FILE_TOO_LARGE",
			Status: http.StatusRequestEntityTooLarge,
		})
	case errors.Is(err, file.ErrPasswordRequired):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  err.Error(),
			Code:   "PASSWORD_REQUIRED",
			Status: http.StatusBadRequest,
		})
	case errors.Is(err, file.ErrInvalidSlug):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  err.Error(),
			Code:   "INVALID_SLUG",
			Status: http.StatusBadRequest,
		})
	case errors.Is(err, file.ErrDangerousFileType):
		writeJSON(w, http.StatusUnsupportedMediaType, errorResponse{
			Error:  err.Error(),
			Code:   "DANGEROUS_FILE_TYPE",
			Status: http.StatusUnsupportedMediaType,
		})
	default:
		log.Printf("ERROR: unexpected internal server error: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error:  "Internal server error",
			Code:   "INTERNAL_ERROR",
			Status: http.StatusInternalServerError,
		})
	}
}

// fileClientIP extracts the client IP address from the request.
// SECURITY (VULN-04): This function now relies solely on r.RemoteAddr, which is
// set by the trusted-proxy-aware RealIPMiddleware. It no longer reads forwarded
// headers directly, preventing IP spoofing when the server is exposed without a proxy.
func fileClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type presignUploadRequest struct {
	Filename   string `json:"filename"`
	SizeBytes  int64  `json:"size_bytes"`
	MIMEType   string `json:"mime_type"`
	Visibility string `json:"visibility"`
	Password   string `json:"password"`
	ExpiresIn  string `json:"expires_in"`
}

// HandlePresignUpload generates a pre-signed PUT URL for uploading file to S3.
func (h *FileHandler) HandlePresignUpload(w http.ResponseWriter, r *http.Request) {
	// Enforce temporary disable setting
	if h.settings != nil && h.settings.Get().DisableFileUploads {
		writeJSON(w, http.StatusForbidden, errorResponse{
			Error:  "Unggah file sedang dinonaktifkan sementara oleh administrator.",
			Code:   "UPLOADS_DISABLED",
			Status: http.StatusForbidden,
		})
		return
	}

	var req presignUploadRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Invalid request payload",
			Code:   "BAD_REQUEST",
			Status: http.StatusBadRequest,
		})
		return
	}

	// SECURITY (VULN-02): Enforce max file size BEFORE issuing the pre-signed URL.
	// Without this, clients could bypass size limits by uploading directly to S3.
	maxSize := int64(file.MaxFileSize)
	if h.settings != nil {
		if s := h.settings.Get().MaxFileSizeBytes; s > 0 {
			maxSize = s
		}
	}
	if req.SizeBytes <= 0 || req.SizeBytes > maxSize {
		writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{
			Error:  fmt.Sprintf("File size exceeds maximum limit of %s", formatBytes(maxSize)),
			Code:   "FILE_TOO_LARGE",
			Status: http.StatusRequestEntityTooLarge,
		})
		return
	}

	// Enforce per-IP daily upload limit when configured.
	if h.quota != nil && h.settings != nil {
		limit := h.settings.Get().MaxFileUploadsPerDayPerIP
		if limit > 0 {
			key := "upload:" + fileClientIP(r)
			if allowed, _ := h.quota.Allow(key, limit); !allowed {
				writeJSON(w, http.StatusTooManyRequests, errorResponse{
					Error:  "Batas unggah file harian tercapai. Coba lagi besok.",
					Code:   "DAILY_LIMIT_REACHED",
					Status: http.StatusTooManyRequests,
				})
				return
			}
		}
	}

	// Enforce daily size limits (global and per-IP) when configured.
	if h.sizeQuota != nil && h.settings != nil {
		set := h.settings.Get()
		clientIP := fileClientIP(r)

		// 1. Enforce global daily upload size limit
		if set.MaxDailyUploadBytes > 0 {
			allowed, _ := h.sizeQuota.Allow("global_size", req.SizeBytes, set.MaxDailyUploadBytes)
			if !allowed {
				writeJSON(w, http.StatusTooManyRequests, errorResponse{
					Error:  "System daily upload size limit reached.",
					Code:   "GLOBAL_DAILY_SIZE_LIMIT_REACHED",
					Status: http.StatusTooManyRequests,
				})
				return
			}
		}

		// 2. Enforce per-IP daily upload size limit
		if set.MaxDailyUploadBytesPerIP > 0 {
			allowed, _ := h.sizeQuota.Allow("ip_size:"+clientIP, req.SizeBytes, set.MaxDailyUploadBytesPerIP)
			if !allowed {
				writeJSON(w, http.StatusTooManyRequests, errorResponse{
					Error:  "Your daily upload size limit reached. Try again tomorrow.",
					Code:   "IP_DAILY_SIZE_LIMIT_REACHED",
					Status: http.StatusTooManyRequests,
				})
				return
			}
		}
	}

	mimeType := req.MIMEType
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	slug, storageKey, uploadURL, err := h.fileService.PresignUploadURL(r.Context(), req.Filename, mimeType, req.SizeBytes)
	if err != nil {
		handleFileServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"slug":        slug,
		"storage_key": storageKey,
		"upload_url":  uploadURL,
	})
}

type registerUploadedFileRequest struct {
	Slug       string `json:"slug"`
	Filename   string `json:"filename"`
	SizeBytes  int64  `json:"size_bytes"`
	MIMEType   string `json:"mime_type"`
	StorageKey string `json:"storage_key"`
	Visibility string `json:"visibility"`
	Password   string `json:"password"`
	ExpiresIn  string `json:"expires_in"`
	MD5Hash    string `json:"md5_hash"`
	SHA256Hash string `json:"sha256_hash"`
}

// HandleRegisterUploadedFile commits the file metadata to database after direct upload completes.
func (h *FileHandler) HandleRegisterUploadedFile(w http.ResponseWriter, r *http.Request) {
	// Enforce temporary disable setting
	if h.settings != nil && h.settings.Get().DisableFileUploads {
		writeJSON(w, http.StatusForbidden, errorResponse{
			Error:  "Unggah file sedang dinonaktifkan sementara oleh administrator.",
			Code:   "UPLOADS_DISABLED",
			Status: http.StatusForbidden,
		})
		return
	}

	var req registerUploadedFileRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Invalid request payload",
			Code:   "BAD_REQUEST",
			Status: http.StatusBadRequest,
		})
		return
	}

	// SECURITY (VULN-05): Validate visibility enum to prevent arbitrary values.
	if !isValidVisibility(req.Visibility) {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Invalid visibility value",
			Code:   "INVALID_VISIBILITY",
			Status: http.StatusBadRequest,
		})
		return
	}

	expiresIn, err := parseExpiryDuration(req.ExpiresIn)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error:  "Invalid expiration duration format",
			Code:   "INVALID_EXPIRY",
			Status: http.StatusBadRequest,
		})
		return
	}

	regReq := paste.RegisterFileRequest{
		Slug:       req.Slug,
		Filename:   req.Filename,
		MIMEType:   req.MIMEType,
		Size:       req.SizeBytes,
		StorageKey: req.StorageKey,
		Visibility: paste.Visibility(req.Visibility),
		Password:   req.Password,
		ExpiresIn:  expiresIn,
		MD5Hash:    req.MD5Hash,
		SHA256Hash: req.SHA256Hash,
	}

	record, err := h.fileService.RegisterUploadedFile(r.Context(), regReq)
	if err != nil {
		handleFileServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"success":  true,
		"slug":     record.Slug,
		"url":      fmt.Sprintf("/f/%s", record.Slug),
		"full_url": getBaseURL(r) + "/f/" + record.Slug,
	})
}

// isValidVisibility returns true if the given visibility string is one of the
// allowed values. Prevents storing arbitrary enum values.
func isValidVisibility(v string) bool {
	switch v {
	case "public", "unlisted", "password_protected":
		return true
	default:
		return false
	}
}

// formatBytes formats a byte count into a human-readable string (e.g. "100 MB").
func formatBytes(b int64) string {
	const mb = 1024 * 1024
	if b >= mb {
		return fmt.Sprintf("%d MB", b/mb)
	}
	const kb = 1024
	if b >= kb {
		return fmt.Sprintf("%d KB", b/kb)
	}
	return fmt.Sprintf("%d bytes", b)
}

// HandleSearchFiles searches for public files containing the query string in their filename.
func (h *FileHandler) HandleSearchFiles(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeJSON(w, http.StatusOK, []*paste.FileSummary{})
		return
	}

	limit := 20
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	results, err := h.fileService.Search(r.Context(), query, limit)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Search failed", "INTERNAL_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, results)
}

