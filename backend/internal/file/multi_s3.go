package file

import (
	"context"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"time"
)

// MultiS3Storage balances uploads and downloads across multiple S3 providers
// using deterministic sharding (hashing the StorageKey).
type MultiS3Storage struct {
	providers []FileStorage
	names     []string
}

// NewMultiS3Storage creates a new MultiS3Storage instance.
func NewMultiS3Storage(providers []FileStorage, names []string) *MultiS3Storage {
	return &MultiS3Storage{
		providers: providers,
		names:     names,
	}
}

// GetProviderName returns the name of the sharded provider that should hold the given key.
func (m *MultiS3Storage) GetProviderName(storageKey string) string {
	idx := m.GetProviderIndex(storageKey)
	if idx >= 0 && idx < len(m.names) {
		return m.names[idx]
	}
	return ""
}

// GetProviderNames returns the registered provider names.
func (m *MultiS3Storage) GetProviderNames() []string {
	return m.names
}

// GetProviderIndex returns the index of the S3 provider based on the hashed StorageKey.
func (m *MultiS3Storage) GetProviderIndex(storageKey string) int {
	if len(m.providers) == 0 {
		return -1
	}
	h := fnv.New32a()
	h.Write([]byte(storageKey))
	return int(h.Sum32() % uint32(len(m.providers)))
}

// Save writes the content to the selected sharded S3 provider with seamless automatic failover support.
func (m *MultiS3Storage) Save(ctx context.Context, storageKey string, reader io.Reader) error {
	idx := m.GetProviderIndex(storageKey)
	if idx < 0 {
		return fmt.Errorf("multi-s3 storage: no S3 providers configured")
	}

	// 1. Attempt upload to the primary sharded S3 provider
	err := m.providers[idx].Save(ctx, storageKey, reader)
	if err == nil {
		return nil
	}

	log.Printf("WARNING: Primary S3 provider %s upload failed for %s: %v. Attempting seamless failover...", m.names[idx], storageKey, err)

	// 2. Attempt seamless failover to other configured S3 providers
	// (Only possible if the reader supports seeking so we can reset the stream back to 0 bytes)
	if seeker, ok := reader.(io.Seeker); ok {
		for i, provider := range m.providers {
			if i == idx {
				continue
			}
			
			// Reset the file reader stream back to 0 bytes
			if _, seekErr := seeker.Seek(0, io.SeekStart); seekErr != nil {
				log.Printf("WARNING: Failed to seek upload stream for failover to %s: %v", m.names[i], seekErr)
				continue
			}

			log.Printf("INFO: Retrying upload to fallback S3 provider %s...", m.names[i])
			fallbackErr := provider.Save(ctx, storageKey, reader)
			if fallbackErr == nil {
				log.Printf("SUCCESS: File %s successfully uploaded to fallback S3 provider %s!", storageKey, m.names[i])
				return nil // Success on fallback!
			}
			log.Printf("WARNING: Fallback S3 provider %s upload failed: %v", m.names[i], fallbackErr)
		}
	} else {
		log.Printf("WARNING: Upload stream does not support seeking; failover skipped.")
	}

	// If both primary and all fallbacks failed, return the primary error
	return fmt.Errorf("multi-s3 storage: failed to upload file to primary and all fallback S3 providers: %w", err)
}

// Open retrieves the file stream from the correct S3 provider, falling back to other providers if not found.
func (m *MultiS3Storage) Open(ctx context.Context, storageKey string) (io.ReadCloser, error) {
	idx := m.GetProviderIndex(storageKey)
	if idx < 0 {
		return nil, fmt.Errorf("multi-s3 storage: no S3 providers configured")
	}

	// Try the primary hashed provider first
	reader, err := m.providers[idx].Open(ctx, storageKey)
	if err == nil {
		return reader, nil
	}

	// If not found (uploaded before sharding or in another bucket), fall back to other providers!
	for i, provider := range m.providers {
		if i == idx {
			continue
		}
		reader, err := provider.Open(ctx, storageKey)
		if err == nil {
			return reader, nil
		}
	}

	return nil, fmt.Errorf("multi-s3 storage: file %s not found on any configured S3 providers", storageKey)
}

// Delete removes the file from the correct S3 provider, ensuring cleanup across other providers too.
func (m *MultiS3Storage) Delete(ctx context.Context, storageKey string) error {
	idx := m.GetProviderIndex(storageKey)
	if idx < 0 {
		return fmt.Errorf("multi-s3 storage: no S3 providers configured")
	}

	// Delete from primary first
	err := m.providers[idx].Delete(ctx, storageKey)

	// Clean up across other providers as well just in case
	for i, provider := range m.providers {
		if i == idx {
			continue
		}
		_ = provider.Delete(ctx, storageKey)
	}

	return err
}

// presignerWithHead is the interface a provider must satisfy to support
// existence-checked presigning. S3Storage implements both Head and PresignURL.
type presignerWithHead interface {
	Head(ctx context.Context, storageKey string) (int64, error)
	PresignURL(ctx context.Context, storageKey string, expires time.Duration, inline bool) (string, error)
}

// PresignURLWithProvider generates a secure, temporary pre-signed URL using the explicitly named provider.
func (m *MultiS3Storage) PresignURLWithProvider(ctx context.Context, storageKey string, provider string, expires time.Duration, inline bool) (string, error) {
	if provider == "" {
		// Fallback to sharding determination or probing if database doesn't record provider.
		return m.PresignURL(ctx, storageKey, expires, inline)
	}

	for i, name := range m.names {
		if name == provider {
			p, ok := m.providers[i].(presignerWithHead)
			if ok {
				return p.PresignURL(ctx, storageKey, expires, inline)
			}
		}
	}

	// If provider name doesn't match current config names (e.g. decommissioned bucket), fall back.
	return m.PresignURL(ctx, storageKey, expires, inline)
}

// PresignURL generates a secure, temporary pre-signed URL for the given storage key.
// It prioritizes the primary deterministic provider directly.
// It only falls back to probing other providers if the primary provider fails.
func (m *MultiS3Storage) PresignURL(ctx context.Context, storageKey string, expires time.Duration, inline bool) (string, error) {
	idx := m.GetProviderIndex(storageKey)
	if idx < 0 {
		return "", fmt.Errorf("multi-s3 storage: no S3 providers configured")
	}

	// 1. Try generating the presigned URL directly from the primary provider first.
	if idx < len(m.providers) {
		p, ok := m.providers[idx].(presignerWithHead)
		if ok {
			url, err := p.PresignURL(ctx, storageKey, expires, inline)
			if err == nil {
				return url, nil
			}
			log.Printf("WARNING: direct presign failed on primary provider %s for %s: %v. Probing other providers...", m.names[idx], storageKey, err)
		}
	}

	// 2. Fallback: Build the probe order to check where the file actually resides.
	// This ensures backward compatibility for legacy files uploaded before sharding.
	order := make([]int, 0, len(m.providers))
	for i := range m.providers {
		if i != idx {
			order = append(order, i)
		}
	}

	for _, i := range order {
		p, ok := m.providers[i].(presignerWithHead)
		if !ok {
			continue
		}

		// Probing via Head is necessary as a fallback for legacy items.
		if _, err := p.Head(ctx, storageKey); err != nil {
			continue
		}

		url, err := p.PresignURL(ctx, storageKey, expires, inline)
		if err != nil {
			log.Printf("WARNING: fallback presign failed on provider %s for %s: %v", m.names[i], storageKey, err)
			continue
		}
		return url, nil
	}

	return "", fmt.Errorf("multi-s3 storage: file %s not found on any configured S3 providers for presigning", storageKey)
}

// Head checks if the file exists on any S3 provider (primary first, then fallback).
// Returns the file size from the first provider that has it.
func (m *MultiS3Storage) Head(ctx context.Context, storageKey string) (int64, error) {
	idx := m.GetProviderIndex(storageKey)
	if idx < 0 {
		return 0, fmt.Errorf("multi-s3 storage: no S3 providers configured")
	}

	// Try the primary hashed provider first
	if size, err := m.providers[idx].Head(ctx, storageKey); err == nil {
		return size, nil
	}

	// If not found, check fallback providers
	for i, provider := range m.providers {
		if i == idx {
			continue
		}
		if size, err := provider.Head(ctx, storageKey); err == nil {
			return size, nil
		}
	}

	return 0, fmt.Errorf("multi-s3 storage: file %s not found on any configured S3 providers", storageKey)
}

// PresignUploadURL generates a secure, temporary pre-signed PUT URL using the primary S3 provider.
func (m *MultiS3Storage) PresignUploadURL(ctx context.Context, storageKey string, expires time.Duration, contentType string, size int64) (string, error) {
	idx := m.GetProviderIndex(storageKey)
	if idx < 0 {
		return "", fmt.Errorf("multi-s3 storage: no S3 providers configured")
	}

	p, ok := m.providers[idx].(UploadPresigner)
	if !ok {
		return "", fmt.Errorf("multi-s3 storage: primary provider does not support presigned uploads")
	}

	return p.PresignUploadURL(ctx, storageKey, expires, contentType, size)
}
