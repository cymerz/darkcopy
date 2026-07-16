package handler

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/cymerz/darkcopy/internal/paste"
)

// PasteHandler handles HTTP requests for paste operations.
type PasteHandler struct {
	pasteService     PasteService
	fileService      FileService
	highlighter      SyntaxHighlighter
	accessController AccessController
	// settings supplies runtime-configurable expiry options; may be nil, in
	// which case the built-in paste.ExpiryOptions are used.
	settings SettingsProvider
	// quota enforces per-IP daily paste-creation limits; may be nil (no limit).
	quota DailyQuota
}

// NewPasteHandler creates a new PasteHandler with the given dependencies.
func NewPasteHandler(ps PasteService, hl SyntaxHighlighter, ac AccessController, fs FileService) *PasteHandler {
	return &PasteHandler{
		pasteService:     ps,
		fileService:      fs,
		highlighter:      hl,
		accessController: ac,
	}
}

// SetSettings installs a settings provider used for dynamic expiry options.
func (h *PasteHandler) SetSettings(sp SettingsProvider) { h.settings = sp }

// SetQuota installs a daily quota enforcer for paste creation.
func (h *PasteHandler) SetQuota(q DailyQuota) { h.quota = q }

// RegisterPasteRoutes registers all paste-related routes on the given chi router.
func RegisterPasteRoutes(r chi.Router, h *PasteHandler) {
	r.Get("/", h.HandleIndex)
	r.Post("/", h.HandleCreate)
	r.Get("/new", h.HandleNewForm)
	r.Post("/new", h.HandleCreate)
	r.Post("/pastes", h.HandleCreate)
	r.Get("/search", h.HandleSearch)
	r.Get("/{slug}", h.HandleView)
	r.Get("/raw/{slug}", h.HandleRaw)
	r.Post("/{slug}/unlock", h.HandleUnlock)
	r.Get("/{slug}/fork", h.HandleFork)
}

// HandleIndex renders the home page with the list of recent public pastes.
func (h *PasteHandler) HandleIndex(w http.ResponseWriter, r *http.Request) {
	pastes, err := h.pasteService.ListPublicRecent(r.Context(), 20)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to load paste list", "INTERNAL_ERROR")
		return
	}

	var files []*paste.FileSummary
	if h.fileService != nil {
		files, err = h.fileService.ListPublicRecent(r.Context(), 20)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "Failed to load file list", "INTERNAL_ERROR")
			return
		}
	}

	if files == nil {
		files = []*paste.FileSummary{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"pastes": pastes,
		"files":  files,
	})
}

// HandleNewForm renders the paste creation form.
func (h *PasteHandler) HandleNewForm(w http.ResponseWriter, r *http.Request) {
	languages := h.highlighter.SupportedLanguages()
	disableNewPastes := false
	if h.settings != nil {
		disableNewPastes = h.settings.Get().DisableNewPastes
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"languages":          languages,
		"expiryOptions":      h.pasteExpiryOptions(),
		"disable_new_pastes": disableNewPastes,
	})
}

// pasteExpiryOptions returns the expiry options for the new-paste form in the
// {label, duration(min)} wire shape the frontend expects. It uses the dynamic
// settings when available, falling back to the built-in paste.ExpiryOptions.
func (h *PasteHandler) pasteExpiryOptions() []map[string]interface{} {
	if h.settings != nil {
		opts := h.settings.Get().PasteExpiryOptions
		if len(opts) > 0 {
			out := make([]map[string]interface{}, 0, len(opts))
			for _, o := range opts {
				out = append(out, map[string]interface{}{"label": o.Label, "duration": o.Minutes})
			}
			return out
		}
	}
	out := make([]map[string]interface{}, 0, len(paste.ExpiryOptions))
	for _, o := range paste.ExpiryOptions {
		out = append(out, map[string]interface{}{"label": o.Label, "duration": int64(o.Duration.Minutes())})
	}
	return out
}

// HandleCreate processes the paste creation form submission.
func (h *PasteHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	// Enforce temporary disable setting
	if h.settings != nil && h.settings.Get().DisableNewPastes {
		if wantsPlain(r) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("Error: New paste creation is disabled\n"))
			return
		}
		writeJSONError(w, http.StatusForbidden, "New paste creation has been temporarily disabled by the administrator.", "PASTES_DISABLED")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB

	var content string
	var language string
	var title string
	var visibility string
	var password string
	var expiresInStr string
	var customSlug string
	var burnAfterRead bool
	var isEncrypted bool

	contentType := r.Header.Get("Content-Type")
	isForm := strings.Contains(contentType, "application/x-www-form-urlencoded")
	isMultipart := strings.Contains(contentType, "multipart/form-data")

	if isForm {
		// Use Go's built-in form parsing which respects MaxBytesReader limit
		if err := r.ParseForm(); err != nil {
			if wantsPlain(r) {
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte("Error: Invalid form payload\n"))
				return
			}
			writeJSONError(w, http.StatusBadRequest, "Invalid form", "BAD_REQUEST")
			return
		}
		content = r.FormValue("content")
		language = r.FormValue("language")
		title = r.FormValue("title")
		visibility = r.FormValue("visibility")
		password = r.FormValue("password")
		expiresInStr = r.FormValue("expires_in")
		customSlug = strings.TrimSpace(r.FormValue("custom_slug"))
		burnAfterRead = r.FormValue("burn_after_read") == "true" || r.FormValue("burn_after_read") == "on"
		isEncrypted = r.FormValue("is_encrypted") == "true" || r.FormValue("is_encrypted") == "on"
	} else if isMultipart {
		// Parse multipart form up to a strict 1MB limit to prevent DoS
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			if wantsPlain(r) {
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte("Error: Invalid multipart form submission\n"))
				return
			}
			writeJSONError(w, http.StatusBadRequest, "Invalid multipart form", "BAD_REQUEST")
			return
		}
		content = r.FormValue("content")
		language = r.FormValue("language")
		title = r.FormValue("title")
		visibility = r.FormValue("visibility")
		password = r.FormValue("password")
		expiresInStr = r.FormValue("expires_in")
		customSlug = strings.TrimSpace(r.FormValue("custom_slug"))
		burnAfterRead = r.FormValue("burn_after_read") == "true" || r.FormValue("burn_after_read") == "on"
		isEncrypted = r.FormValue("is_encrypted") == "true" || r.FormValue("is_encrypted") == "on"
	} else {
		// Raw plain text or arbitrary payload (e.g. curl command piping raw content)
		// We read the body safely up to the 1MB limit.
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			if wantsPlain(r) {
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte("Error: Failed to read body\n"))
				return
			}
			writeJSONError(w, http.StatusBadRequest, "Failed to read request body", "BAD_REQUEST")
			return
		}
		content = string(bodyBytes)
		language = r.URL.Query().Get("language")
		title = r.URL.Query().Get("title")
		visibility = r.URL.Query().Get("visibility")
		password = r.URL.Query().Get("password")
		expiresInStr = r.URL.Query().Get("expires_in")
		customSlug = strings.TrimSpace(r.URL.Query().Get("custom_slug"))
		burnAfterRead = r.URL.Query().Get("burn_after_read") == "true" || r.URL.Query().Get("burn_after_read") == "on"
		isEncrypted = r.URL.Query().Get("is_encrypted") == "true" || r.URL.Query().Get("is_encrypted") == "on"
	}

	// Enforce per-IP daily paste-creation limit when configured.
	if h.quota != nil && h.settings != nil {
		limit := h.settings.Get().MaxPastesPerDayPerIP
		if limit > 0 {
			key := "paste:" + extractIP(r)
			if allowed, _ := h.quota.Allow(key, limit); !allowed {
				if wantsPlain(r) {
					w.Header().Set("Content-Type", "text/plain; charset=utf-8")
					w.WriteHeader(http.StatusTooManyRequests)
					_, _ = w.Write([]byte("Error: Daily paste creation limit reached\n"))
					return
				}
				writeJSONError(w, http.StatusTooManyRequests, "Daily paste creation limit reached. Try again tomorrow.", "DAILY_LIMIT_REACHED")
				return
			}
		}
	}

	// Parse expiry duration (in minutes).
	var expiresIn time.Duration
	if expiresInStr != "" {
		minutes, err := strconv.ParseInt(expiresInStr, 10, 64)
		if err == nil {
			if minutes == 0 || minutes < 0 {
				expiresIn = paste.NeverExpires
			} else {
				expiresIn = time.Duration(minutes) * time.Minute
			}
		}
	}

	// Map visibility string to type.
	vis := paste.VisibilityPublic
	switch visibility {
	case "unlisted":
		vis = paste.VisibilityUnlisted
	case "password_protected":
		vis = paste.VisibilityPasswordProtected
	}

	req := paste.CreatePasteRequest{
		Content:       content,
		Language:      language,
		Title:         title,
		Visibility:    vis,
		Password:      password,
		ExpiresIn:     expiresIn,
		CustomSlug:    customSlug,
		BurnAfterRead: burnAfterRead,
		IsEncrypted:   isEncrypted,
	}

	created, err := h.pasteService.Create(r.Context(), req)
	if err != nil {
		if wantsPlain(r) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Error: " + err.Error() + "\n"))
			return
		}
		writeJSONError(w, http.StatusBadRequest, err.Error(), "VALIDATION_ERROR")
		return
	}

	// If it is CLI or text/plain request, return absolute URL as plain text.
	if wantsPlain(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(getBaseURL(r) + "/" + created.Slug + "\n"))
		return
	}

	// If the client wants JSON (e.g. fetch API), return 201 with slug and URL.
	if wantsJSON(r) {
		writeJSON(w, http.StatusCreated, map[string]string{
			"slug": created.Slug,
			"url":  "/" + created.Slug,
		})
		return
	}

	// Otherwise redirect to the newly created paste.
	http.Redirect(w, r, "/"+created.Slug, http.StatusSeeOther)
}

func isCLIClient(r *http.Request) bool {
	ua := strings.ToLower(r.Header.Get("User-Agent"))
	return strings.HasPrefix(ua, "curl") ||
		strings.HasPrefix(ua, "wget") ||
		strings.HasPrefix(ua, "httpie")
}

func wantsPlain(r *http.Request) bool {
	return isCLIClient(r) ||
		r.URL.Query().Get("cli") == "true" ||
		strings.Contains(r.Header.Get("Accept"), "text/plain")
}

func getBaseURL(r *http.Request) string {
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}

	// SECURITY: Only use r.Host to prevent Host Header Injection/SSRF.
	// We ignore X-Forwarded-Host to ensure the generated links match the host
	// that Go's HTTP server is bound to or sees.
	host := r.Host
	if host == "" {
		host = "localhost:8080"
	}

	// Strip CRLF and tabs to prevent response splitting/header injection.
	host = strings.NewReplacer("\n", "", "\r", "", "\t", "").Replace(host)

	return scheme + "://" + host
}

// HandleRaw serves the raw paste content as plain text.
func (h *PasteHandler) HandleRaw(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	p, err := h.pasteService.GetBySlug(r.Context(), slug)
	if err != nil {
		if errors.Is(err, paste.ErrNotFound) {
			http.Error(w, "Paste not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, paste.ErrExpired) {
			http.Error(w, "This paste has expired", http.StatusGone)
			return
		}
		http.Error(w, "Failed to load paste", http.StatusInternalServerError)
		return
	}

	if p.Visibility == paste.VisibilityPasswordProtected {
		http.Error(w, "Password required", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(p.Content))
}

// HandleView displays a paste by its slug.
func (h *PasteHandler) HandleView(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	peek := r.URL.Query().Get("peek") == "true"

	ctx := r.Context()
	if peek {
		ctx = context.WithValue(ctx, "skip_burn", true)
	}

	p, err := h.pasteService.GetBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, paste.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "Paste not found", "NOT_FOUND")
			return
		}
		if errors.Is(err, paste.ErrExpired) {
			writeJSONError(w, http.StatusGone, "This paste has expired", "RESOURCE_EXPIRED")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to load paste", "INTERNAL_ERROR")
		return
	}

	// If paste is password protected, return 401 indicating password is required.
	if p.Visibility == paste.VisibilityPasswordProtected {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"error":             "Password required",
			"code":              "PASSWORD_REQUIRED",
			"status":            http.StatusUnauthorized,
			"password_required": true,
			"slug":              p.Slug,
			"is_encrypted":      p.IsEncrypted,
			"burn_after_read":   p.BurnAfterRead,
		})
		return
	}

	content := p.Content
	highlighted := ""

	// If it's a peek request and the paste is burn-after-read, hide the content.
	if peek && p.BurnAfterRead {
		content = ""
	} else {
		// Highlight the content unless it is client-side encrypted
		if p.IsEncrypted {
			highlighted = p.Content
		} else {
			hl, err := h.highlighter.Highlight(p.Content, p.Language)
			if err != nil {
				highlighted = p.Content
			} else {
				highlighted = hl
			}
		}
	}

	if !peek {
		// Increment views!
		_ = h.pasteService.IncrementViews(r.Context(), slug)
		p.Views++
	}

	// Calculate remaining time until expiry.
	var remainingSeconds *int64
	if p.ExpiresAt != nil {
		remaining := time.Until(*p.ExpiresAt)
		secs := int64(remaining.Seconds())
		remainingSeconds = &secs
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"slug":              p.Slug,
		"title":             p.Title,
		"content":           content,
		"highlighted_html":  highlighted,
		"language":          p.Language,
		"visibility":        p.Visibility,
		"created_at":        p.CreatedAt,
		"expires_at":        p.ExpiresAt,
		"remaining_seconds": remainingSeconds,
		"views":             p.Views,
		"is_encrypted":      p.IsEncrypted,
		"burn_after_read":   p.BurnAfterRead,
	})
}

// HandleUnlock processes the password submission for a protected paste.
func (h *PasteHandler) HandleUnlock(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB
	if err := r.ParseForm(); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid form", "BAD_REQUEST")
		return
	}

	password := r.FormValue("password")
	clientIP := extractIP(r)

	// Check rate limiting first.
	limited, err := h.accessController.IsRateLimited(r.Context(), clientIP, slug)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to check rate limit", "INTERNAL_ERROR")
		return
	}
	if limited {
		writeJSONError(w, http.StatusTooManyRequests, "Too many attempts. Please try again later.", "RATE_LIMITED")
		return
	}

	// Validate password.
	valid, err := h.pasteService.ValidatePassword(r.Context(), slug, password)
	if err != nil {
		if errors.Is(err, paste.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "Paste not found", "NOT_FOUND")
			return
		}
		if errors.Is(err, paste.ErrExpired) {
			writeJSONError(w, http.StatusGone, "This paste has expired", "RESOURCE_EXPIRED")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to validate password", "INTERNAL_ERROR")
		return
	}

	if !valid {
		// Record failed attempt.
		_ = h.accessController.RecordFailedAttempt(r.Context(), clientIP, slug)
		writeJSONError(w, http.StatusUnauthorized, "Incorrect password", "INVALID_PASSWORD")
		return
	}

	// Password correct — reset rate limit and return paste content.
	h.accessController.ResetRateLimit(r.Context(), clientIP, slug)

	// Increment views!
	_ = h.pasteService.IncrementViews(r.Context(), slug)

	// Fetch the paste to return its content (if it's burn-after-read, do not skip burn so it deletes).
	ctx := r.Context()
	p, err := h.pasteService.GetBySlug(ctx, slug)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to load paste", "INTERNAL_ERROR")
		return
	}

	// Highlight the content unless E2EE.
	highlighted := ""
	if p.IsEncrypted {
		highlighted = p.Content
	} else {
		hl, err := h.highlighter.Highlight(p.Content, p.Language)
		if err != nil {
			highlighted = p.Content
		} else {
			highlighted = hl
		}
	}

	var remainingSeconds *int64
	if p.ExpiresAt != nil {
		remaining := time.Until(*p.ExpiresAt)
		secs := int64(remaining.Seconds())
		remainingSeconds = &secs
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"slug":              p.Slug,
		"title":             p.Title,
		"content":           p.Content,
		"highlighted_html":  highlighted,
		"language":          p.Language,
		"visibility":        p.Visibility,
		"created_at":        p.CreatedAt,
		"expires_at":        p.ExpiresAt,
		"remaining_seconds": remainingSeconds,
		"views":             p.Views,
		"is_encrypted":      p.IsEncrypted,
		"burn_after_read":   p.BurnAfterRead,
	})
}

// extractIP extracts the client IP address from the request, stripping the port.
// SECURITY (VULN-04): This function now relies solely on r.RemoteAddr, which is
// set by the trusted-proxy-aware RealIPMiddleware. It no longer reads forwarded
// headers directly, preventing IP spoofing when the server is exposed without a proxy.
func extractIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// HandleSearch searches for public pastes containing the query string.
func (h *PasteHandler) HandleSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeJSON(w, http.StatusOK, []*paste.PasteSummary{})
		return
	}

	limit := 20
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	results, err := h.pasteService.Search(r.Context(), query, limit)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Search failed", "INTERNAL_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, results)
}

// HandleFork returns the original paste data so the caller can pre-fill a form.
func (h *PasteHandler) HandleFork(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	p, err := h.pasteService.Fork(r.Context(), slug)
	if err != nil {
		if errors.Is(err, paste.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "Paste not found", "NOT_FOUND")
			return
		}
		if errors.Is(err, paste.ErrExpired) {
			writeJSONError(w, http.StatusGone, "This paste has expired", "RESOURCE_EXPIRED")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "Failed to fork paste", "INTERNAL_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"title":    p.Title,
		"content":  p.Content,
		"language": p.Language,
	})
}
