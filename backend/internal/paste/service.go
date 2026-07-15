package paste

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gthbn/pastebin/internal/access"
	"github.com/gthbn/pastebin/internal/urlgen"
	"github.com/redis/go-redis/v9"
)

// slugPattern allows lowercase letters, digits, and hyphens (3–64 chars).
var slugPattern = regexp.MustCompile(`^[a-z0-9-]{3,64}$`)

// MaxContentSize is the maximum allowed paste content size (10 MB).
const MaxContentSize = 10 * 1024 * 1024

// NeverExpires is a sentinel value for ExpiresIn indicating the paste should never expire.
const NeverExpires = time.Duration(-1)

// Errors returned by the paste service.
var (
	ErrEmptyContent     = errors.New("Paste content must not be empty")
	ErrContentTooLarge  = errors.New("Content size exceeds maximum limit of 10 MB")
	ErrPasswordRequired = errors.New("Password is required for this visibility")
	ErrSlugTaken        = errors.New("Slug already in use, choose another")
	ErrSlugInvalid      = errors.New("Slug may only contain letters, digits, and hyphens")
	ErrNotFound         = errors.New("Paste not found")
	ErrExpired          = errors.New("This paste has expired")
)

// PasteRepository defines the interface for paste persistence operations.
type PasteRepository interface {
	InsertPaste(ctx context.Context, paste *Paste) error
	GetBySlug(ctx context.Context, slug string) (*Paste, error)
	ListPublicRecent(ctx context.Context, limit int) ([]*PasteSummary, error)
	IncrementViews(ctx context.Context, slug string) error
	SearchPastes(ctx context.Context, query string, limit int) ([]*PasteSummary, error)
	DeletePasteBySlug(ctx context.Context, slug string) (bool, error)
}


// Service is the concrete implementation of PasteService.
type Service struct {
	repo      PasteRepository
	urlGen    urlgen.URLGenerator
	accessCtl access.AccessController
	rdb       *redis.Client
	now       func() time.Time
	// maxContentSize, when > 0, overrides MaxContentSize for the size check.
	// Set via SetMaxContentSizeFunc to support runtime-configurable limits.
	maxContentSizeFn func() int64
}

// NewService creates a new paste Service with the given dependencies.
func NewService(repo PasteRepository, urlGen urlgen.URLGenerator, accessCtl access.AccessController) *Service {
	return &Service{
		repo:      repo,
		urlGen:    urlGen,
		accessCtl: accessCtl,
		now:       time.Now,
	}
}

// WithRedis sets the Redis client for creator-token verification.
func (s *Service) WithRedis(rdb *redis.Client) *Service {
	s.rdb = rdb
	return s
}

// generateCreatorToken creates a random hex token for burn-after-read verification.
func generateCreatorToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// SetMaxContentSizeFunc installs a function that returns the current maximum
// paste content size in bytes. When unset (or it returns <= 0), the compile-time
// MaxContentSize constant is used. This keeps the constructor backward
// compatible while allowing runtime-configurable limits.
func (s *Service) SetMaxContentSizeFunc(fn func() int64) {
	s.maxContentSizeFn = fn
}

// maxContentSize returns the effective maximum paste size in bytes.
func (s *Service) maxContentSize() int64 {
	if s.maxContentSizeFn != nil {
		if v := s.maxContentSizeFn(); v > 0 {
			return v
		}
	}
	return MaxContentSize
}

// GetBySlug retrieves a paste by its slug. Returns ErrNotFound if the paste
// does not exist, and ErrExpired if the paste has passed its expiry time.
// If the paste has burn_after_read=true and the context does NOT contain
// skip_burn=true, the paste is deleted immediately after retrieval.
func (s *Service) GetBySlug(ctx context.Context, slug string) (*Paste, error) {
	paste, err := s.repo.GetBySlug(ctx, slug)
	if err != nil {
		return nil, ErrNotFound
	}

	if paste.ExpiresAt != nil && paste.ExpiresAt.Before(s.now()) {
		return nil, ErrExpired
	}

	// Burn-after-read: delete the paste after returning it, unless skip_burn is set
	if paste.BurnAfterRead {
		skipBurn := false
		if val := ctx.Value("skip_burn"); val != nil {
			if b, ok := val.(bool); ok && b {
				skipBurn = true
			}
		}
		if !skipBurn {
			// Delete the paste asynchronously to avoid blocking the response
			go s.repo.DeletePasteBySlug(context.Background(), slug)
		}
	}

	return paste, nil
}

// ListPublicRecent returns the most recent public pastes up to the given limit.
func (s *Service) ListPublicRecent(ctx context.Context, limit int) ([]*PasteSummary, error) {
	return s.repo.ListPublicRecent(ctx, limit)
}

// Create validates the request, generates a unique slug, hashes the password
// if needed, computes the expiry time, and persists the paste.
func (s *Service) Create(ctx context.Context, req CreatePasteRequest) (*Paste, error) {
	// Validate content is not empty or whitespace-only.
	if strings.TrimSpace(req.Content) == "" {
		return nil, ErrEmptyContent
	}

	// Validate content size does not exceed the configured maximum.
	if int64(len(req.Content)) > s.maxContentSize() {
		return nil, ErrContentTooLarge
	}

	// Validate password is required for password_protected visibility.
	if req.Visibility == VisibilityPasswordProtected {
		if strings.TrimSpace(req.Password) == "" {
			return nil, ErrPasswordRequired
		}
	}

	// Hash password using bcrypt cost factor 10 if visibility is password_protected.
	var passwordHash string
	if req.Visibility == VisibilityPasswordProtected {
		hash, err := access.HashPassword(req.Password)
		if err != nil {
			return nil, err
		}
		passwordHash = hash
	}

	// Generate or validate slug.
	var slug string
	if req.CustomSlug != "" {
		custom := strings.ToLower(strings.TrimSpace(req.CustomSlug))
		if !slugPattern.MatchString(custom) {
			return nil, ErrSlugInvalid
		}
		// Check availability by attempting a lookup.
		if _, err := s.repo.GetBySlug(ctx, custom); err == nil {
			return nil, ErrSlugTaken
		}
		slug = custom
	} else {
		var err error
		slug, err = s.urlGen.GenerateSlug(ctx)
		if err != nil {
			return nil, err
		}
	}

	now := s.now()

	// Default ExpiresIn to 24 hours if not set (zero value).
	expiresIn := req.ExpiresIn
	if expiresIn == 0 {
		expiresIn = DefaultExpiryDuration
	}

	// Calculate expires_at. NULL (nil) if ExpiresIn is negative (NeverExpires sentinel).
	var expiresAt *time.Time
	if expiresIn > 0 {
		t := now.Add(expiresIn)
		expiresAt = &t
	}

	paste := &Paste{
		ID:            uuid.New(),
		Slug:          slug,
		Title:         req.Title,
		Content:       req.Content,
		Language:      req.Language,
		Visibility:    req.Visibility,
		PasswordHash:  passwordHash,
		ExpiresAt:     expiresAt,
		CreatedAt:     now,
		BurnAfterRead: req.BurnAfterRead,
	}

	if err := s.repo.InsertPaste(ctx, paste); err != nil {
		return nil, err
	}

	// Store creator token in Redis for burn-after-read verification
	if req.BurnAfterRead && s.rdb != nil {
		token := generateCreatorToken()
		s.rdb.Set(ctx, "paste:creator:"+slug, token, 10*time.Minute)
		paste.CreatorToken = token
	}

	return paste, nil
}

// VerifyCreatorToken checks if a creator token is valid for the given slug.
// If valid, the token is consumed (deleted) so it can only be used once.
func (s *Service) VerifyCreatorToken(ctx context.Context, slug, token string) bool {
	if s.rdb == nil || token == "" {
		return false
	}
	key := "paste:creator:" + slug
	stored, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		return false
	}
	if stored == token {
		s.rdb.Del(ctx, key)
		return true
	}
	return false
}

// SetCreatorToken stores a creator token for burn-after-read verification.
func (s *Service) SetCreatorToken(ctx context.Context, slug, token string) {
	if s.rdb == nil {
		return
	}
	s.rdb.Set(ctx, "paste:creator:"+slug, token, 10*time.Minute)
}

// ValidatePassword checks whether the given password grants access to the paste
// identified by slug. Returns true if access is granted, false otherwise.
// Returns ErrNotFound if the paste does not exist, ErrExpired if it has expired.
// For public/unlisted pastes (no password hash), returns true immediately.
func (s *Service) ValidatePassword(ctx context.Context, slug, password string) (bool, error) {
	paste, err := s.repo.GetBySlug(ctx, slug)
	if err != nil {
		return false, ErrNotFound
	}

	if paste.ExpiresAt != nil && paste.ExpiresAt.Before(s.now()) {
		return false, ErrExpired
	}

	// Public/unlisted pastes have no password hash — access is always granted.
	if paste.PasswordHash == "" {
		return true, nil
	}

	result, err := s.accessCtl.CheckAccess(ctx, paste.PasswordHash, password)
	if err != nil {
		return false, err
	}

	return result == access.AccessGranted, nil
}

// IncrementViews increments the view count of a paste by its slug.
func (s *Service) IncrementViews(ctx context.Context, slug string) error {
	return s.repo.IncrementViews(ctx, slug)
}

// Search searches for public pastes containing the query string.
func (s *Service) Search(ctx context.Context, query string, limit int) ([]*PasteSummary, error) {
	if limit <= 0 {
		limit = 20
	}
	return s.repo.SearchPastes(ctx, query, limit)
}

// Fork returns the original paste data so the caller can pre-fill a new paste form.
// This does NOT create a new paste - that's the caller's responsibility.
func (s *Service) Fork(ctx context.Context, originalSlug string) (*Paste, error) {
	paste, err := s.repo.GetBySlug(ctx, originalSlug)
	if err != nil {
		return nil, ErrNotFound
	}

	if paste.ExpiresAt != nil && paste.ExpiresAt.Before(s.now()) {
		return nil, ErrExpired
	}

	return paste, nil
}

