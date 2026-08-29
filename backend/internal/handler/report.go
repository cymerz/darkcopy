package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
	"github.com/cymerz/darkcopy/internal/report"
)

// TurnstileVerifyURL is the Cloudflare Turnstile siteverify endpoint.
const TurnstileVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// ReportService defines the report operations used by the public handler.
type ReportService interface {
	Create(ctx context.Context, req report.CreateReportRequest) (*report.Report, error)
}

// ReportHandler handles the public report-submission endpoint.
type ReportHandler struct {
	service          ReportService
	quota            DailyQuota
	dailyLimit       int
	turnstileSecret  string
}

// NewReportHandler creates a new ReportHandler.
func NewReportHandler(s ReportService) *ReportHandler {
	return &ReportHandler{service: s}
}

// SetQuota installs a daily quota enforcer with the given per-IP daily limit.
func (h *ReportHandler) SetQuota(q DailyQuota, dailyLimit int) {
	h.quota = q
	h.dailyLimit = dailyLimit
}

// SetTurnstileSecret sets the Cloudflare Turnstile secret key for server-side verification.
func (h *ReportHandler) SetTurnstileSecret(secret string) {
	h.turnstileSecret = secret
}

// RegisterReportRoutes registers the public report route.
func (h *ReportHandler) registerRoutes(r chi.Router) {
	r.Post("/report", h.HandleCreate)
}

// RegisterReportRoutes mounts the public report endpoint on the router.
func RegisterReportRoutes(r chi.Router, h *ReportHandler) {
	h.registerRoutes(r)
}

// verifyTurnstileToken checks the token against Cloudflare's siteverify endpoint.
func verifyTurnstileToken(secret, token string) (bool, error) {
	if secret == "" || token == "" {
		return false, nil
	}
	data := url.Values{"secret": {secret}, "response": {token}}
	resp, err := http.PostForm(TurnstileVerifyURL, data)
	if err != nil {
		return false, fmt.Errorf("turnstile verify request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return false, fmt.Errorf("turnstile verify read failed: %w", err)
	}
	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false, fmt.Errorf("turnstile verify parse failed: %w", err)
	}
	return result.Success, nil
}

// HandleCreate accepts an abuse/content report for a paste or file.
func (h *ReportHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB
	if err := r.ParseForm(); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid form", "BAD_REQUEST")
		return
	}

	clientIP := extractIP(r)

	// Per-IP daily limit to curb report spam.
	if h.quota != nil && h.dailyLimit > 0 {
		if allowed, _ := h.quota.Allow("report:"+clientIP, h.dailyLimit); !allowed {
			writeJSONError(w, http.StatusTooManyRequests, "Daily report limit reached. Try again tomorrow.", "DAILY_LIMIT_REACHED")
			return
		}
	}

	// Cloudflare Turnstile verification.
	turnstileToken := r.FormValue("turnstile_token")
	if h.turnstileSecret != "" {
		ok, err := verifyTurnstileToken(h.turnstileSecret, turnstileToken)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "Failed to verify captcha", "TURNSTILE_ERROR")
			return
		}
		if !ok {
			writeJSONError(w, http.StatusForbidden, "Captcha verification failed", "TURNSTILE_FAILED")
			return
		}
	}

	resourceType := report.ResourceType(r.FormValue("resource_type"))
	req := report.CreateReportRequest{
		ResourceType: resourceType,
		Slug:         r.FormValue("slug"),
		Reason:       r.FormValue("reason"),
		Details:      r.FormValue("details"),
		ReporterIP:   clientIP,
	}

	if _, err := h.service.Create(r.Context(), req); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error(), "VALIDATION_ERROR")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Report submitted. Thank you.",
	})
}
