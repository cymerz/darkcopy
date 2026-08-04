import type {
  PasteListResponse,
  NewPasteOptions,
  PasteViewResponse,
  UploadOptions,
  UploadResponse,
  APIErrorResponse,
  AdminStats,
  AdminPasteListResponse,
  AdminFileListResponse,
  AdminSettings,
  AdminReportListResponse,
  ReportResourceType,
  ReportStatus,
  PasteSummary,
  FileSummary,
  AdminBackupItem,
  AdminBackupListResponse,
  AdminRestoreResult,
} from './types';
import { APIError } from './types';

/**
 * Build an absolute URL for a backend API path.
 *
 * Server Components run in Node.js where `fetch` requires an absolute URL —
 * the Next.js `/api/*` rewrite only applies to browser requests. So on the
 * server we call the backend directly; on the client we go through the proxy.
 *
 * Resolution order:
 *   Server: BACKEND_URL env var  →  http://localhost:8080
 *   Client: NEXT_PUBLIC_API_URL env var  →  '' (relative, uses /api proxy)
 */
function buildUrl(path: string): string {
  const isServer = typeof window === 'undefined';
  if (isServer) {
    const base = process.env.BACKEND_URL ?? 'http://localhost:8080';
    return `${base}${path}`;
  }
  const base = process.env.NEXT_PUBLIC_API_URL ?? '';
  return `${base}/api${path}`;
}

/**
 * Internal helper for JSON-based API calls.
 *
 * Always sets `Accept: application/json` (merging with caller-provided headers).
 * Throws an {@link APIError} on non-2xx responses, gracefully falling back to
 * `{ error: 'Unknown error', code: 'UNKNOWN', status: res.status }` when the
 * response body cannot be parsed as JSON.
 */
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = buildUrl(path);

  const headers = new Headers(options?.headers);
  headers.set('Accept', 'application/json');

  // Strip Next.js-extended fetch options (cache, next) when calling the
  // backend directly from the server — they only apply to Next.js's fetch
  // cache layer which wraps the /api proxy, not direct backend calls.
  // On the client these options are harmless (browser fetch ignores them).
  const { cache: _cache, next: _next, ...fetchOptions } = (options ?? {}) as RequestInit & { next?: unknown };
  const isServer = typeof window === 'undefined';

  const res = await fetch(url, {
    ...(isServer ? fetchOptions : options),
    headers,
  });

  if (!res.ok) {
    const fallback: APIErrorResponse = {
      error: 'Unknown error',
      code: 'UNKNOWN',
      status: res.status,
    };
    const errorBody: APIErrorResponse = await res
      .json()
      .then((body: Partial<APIErrorResponse>) => ({
        error: body?.error ?? fallback.error,
        code: body?.code ?? fallback.code,
        status: body?.status ?? fallback.status,
      }))
      .catch(() => fallback);

    throw new APIError(errorBody.error, errorBody.code, errorBody.status);
  }

  return (await res.json()) as T;
}

/**
 * GET / — Fetch the list of recent public pastes.
 *
 * Uses `cache: 'no-store'` so Next.js Server Components always re-fetch.
 */
export async function getRecentPastes(): Promise<PasteListResponse> {
  return apiFetch<PasteListResponse>('/', { cache: 'no-store' });
}

/**
 * GET /new — Fetch language list and expiry options for the new-paste form.
 *
 * Uses `cache: 'no-store'` so Next.js Server Components always re-fetch.
 */
export async function getNewPasteOptions(): Promise<NewPasteOptions> {
  return apiFetch<NewPasteOptions>('/new', { cache: 'no-store' });
}

/**
 * POST /new — Create a new paste from a URL-encoded form payload.
 *
 * Uses URLSearchParams (application/x-www-form-urlencoded) so the Go backend's
 * r.ParseForm() can read the fields directly without multipart parsing.
 * Expects the backend to return JSON `{ slug, url }` when the request is sent
 * with `Accept: application/json`.
 */
export async function createPaste(
  data: URLSearchParams,
): Promise<{ slug: string; url: string }> {
  return apiFetch<{ slug: string; url: string }>('/new', {
    method: 'POST',
    body: data,
  });
}

/**
 * GET /{slug} — Fetch a paste by slug.
 *
 * Uses `cache: 'no-store'` so Next.js Server Components always re-fetch.
 */
export async function getPaste(slug: string, peek?: boolean): Promise<PasteViewResponse> {
  const query = peek ? '?peek=true' : '';
  return apiFetch<PasteViewResponse>(`/${slug}${query}`, { cache: 'no-store' });
}

/**
 * POST /{slug}/unlock — Submit a password to unlock a protected paste.
 *
 * Uses URLSearchParams so the Go backend's r.ParseForm() can read the field.
 */
export async function unlockPaste(
  slug: string,
  password: string,
): Promise<PasteViewResponse> {
  const body = new URLSearchParams();
  body.append('password', password);
  return apiFetch<PasteViewResponse>(`/${slug}/unlock`, {
    method: 'POST',
    body,
  });
}

/**
 * GET /upload — Fetch expiry options and visibility choices for the file
 * upload form.
 *
 * Uses `cache: 'no-store'` so Next.js Server Components always re-fetch.
 */
export async function getUploadOptions(): Promise<UploadOptions> {
  return apiFetch<UploadOptions>('/upload', { cache: 'no-store' });
}

/**
 * POST /upload — Upload a file via multipart form data.
 */
export async function uploadFile(data: FormData): Promise<UploadResponse> {
  return apiFetch<UploadResponse>('/upload', {
    method: 'POST',
    body: data,
  });
}

export interface PresignUploadPayload {
  filename: string;
  size_bytes: number;
  mime_type: string;
  visibility: string;
  password?: string;
  expires_in?: string;
}

export interface PresignUploadResponse {
  slug: string;
  storage_key: string;
  upload_url: string;
}

export interface RegisterUploadedFilePayload {
  slug: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  storage_key: string;
  visibility: string;
  password?: string;
  expires_in?: string;
  md5_hash?: string;
}

/**
 * POST /upload/presign — Request a pre-signed URL for direct S3 upload.
 */
export async function presignUpload(data: PresignUploadPayload): Promise<PresignUploadResponse> {
  return apiFetch<PresignUploadResponse>('/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * POST /upload/register — Register the uploaded file metadata in the DB.
 */
export async function registerUploadedFile(data: RegisterUploadedFilePayload): Promise<UploadResponse> {
  return apiFetch<UploadResponse>('/upload/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * GET /f/{slug} — Fetch a file resource.
 *
 * Returns the raw {@link Response} so the caller can decide whether to stream a
 * binary download or parse a JSON `password_required` response.
 */
export async function getFile(slug: string): Promise<Response> {
  const isServer = typeof window === 'undefined';
  return fetch(buildUrl(`/f/${slug}`), {
    method: isServer ? 'HEAD' : 'GET',
    headers: { Accept: 'application/json' },
    ...(isServer ? {} : { cache: 'no-store' as RequestCache }),
  });
}

/**
 * POST /f/{slug}/unlock — Submit a password to unlock a protected file.
 *
 * Returns the raw {@link Response} so the caller can stream the binary
 * download on success.
 */
export async function unlockFile(
  slug: string,
  password: string,
): Promise<Response> {
  const body = new URLSearchParams();
  body.append('password', password);
  return fetch(buildUrl(`/f/${slug}/unlock`), {
    method: 'POST',
    body,
    headers: { Accept: 'application/json' },
  });
}

/**
 * GET /search — Search public pastes containing the query.
 */
export async function searchPastes(
  query: string,
  limit?: number,
): Promise<PasteSummary[]> {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) {
    params.append('limit', limit.toString());
  }
  return apiFetch<PasteSummary[]>(`/search?${params.toString()}`, { cache: 'no-store' });
}

/**
 * GET /f/search — Search public files by filename.
 */
export async function searchFiles(
  query: string,
  limit?: number,
): Promise<FileSummary[]> {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) {
    params.append('limit', limit.toString());
  }
  return apiFetch<FileSummary[]>(`/f/search?${params.toString()}`, { cache: 'no-store' });
}

/**
 * GET /{slug}/fork — Get paste data for forking (pre-filling a new paste form).
 */
export async function forkPaste(
  slug: string,
): Promise<{ title: string; content: string; language: string }> {
  return apiFetch<{ title: string; content: string; language: string }>(`/${slug}/fork`, {
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Admin (hidden) API
//
// The admin dashboard is a Client Component, so these helpers always run in the
// browser and go through the Next.js `/api` proxy. Every call carries the admin
// token via the `X-Admin-Token` header. The token is supplied by the caller
// (the admin page keeps it in sessionStorage) — it is never embedded in the
// bundle. A wrong/empty token yields an {@link APIError} (401, or 404 when the
// admin API is disabled server-side).
// ---------------------------------------------------------------------------

/** GET /admin/stats — aggregate counts of pastes and files. */
export async function getAdminStats(token: string): Promise<AdminStats> {
  return apiFetch<AdminStats>('/admin/stats', {
    cache: 'no-store',
    headers: { 'X-Admin-Token': token },
  });
}

/** GET /admin/pastes — list every paste (any visibility, including expired). Supports pagination and search. */
export async function getAdminPastes(
  token: string,
  limit?: number,
  offset?: number,
  q?: string,
): Promise<AdminPasteListResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  if (q) params.set('q', q);
  const query = params.toString();
  return apiFetch<AdminPasteListResponse>(`/admin/pastes${query ? `?${query}` : ''}`, {
    cache: 'no-store',
    headers: { 'X-Admin-Token': token },
  });
}

/** DELETE /admin/pastes/{slug} — permanently delete a paste. */
export async function deleteAdminPaste(
  token: string,
  slug: string,
): Promise<{ success: boolean; slug: string }> {
  return apiFetch<{ success: boolean; slug: string }>(
    `/admin/pastes/${encodeURIComponent(slug)}`,
    {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token },
    },
  );
}

/** GET /admin/files — list every uploaded file. Supports pagination and search. */
export async function getAdminFiles(
  token: string,
  limit?: number,
  offset?: number,
  q?: string,
): Promise<AdminFileListResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  if (q) params.set('q', q);
  const query = params.toString();
  return apiFetch<AdminFileListResponse>(`/admin/files${query ? `?${query}` : ''}`, {
    cache: 'no-store',
    headers: { 'X-Admin-Token': token },
  });
}

/** DELETE /admin/files/{slug} — permanently delete a file (record and blob). */
export async function deleteAdminFile(
  token: string,
  slug: string,
): Promise<{ success: boolean; slug: string }> {
  return apiFetch<{ success: boolean; slug: string }>(
    `/admin/files/${encodeURIComponent(slug)}`,
    {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token },
    },
  );
}

/** POST /admin/purge-expired — immediately delete all expired pastes and files. */
export async function purgeExpired(
  token: string,
): Promise<{ success: boolean; deleted: number }> {
  return apiFetch<{ success: boolean; deleted: number }>('/admin/purge-expired', {
    method: 'POST',
    headers: { 'X-Admin-Token': token },
  });
}

/** GET /admin/settings — fetch the current runtime settings. */
export async function getAdminSettings(token: string): Promise<AdminSettings> {
  return apiFetch<AdminSettings>('/admin/settings', {
    cache: 'no-store',
    headers: { 'X-Admin-Token': token },
  });
}

/** PUT /admin/settings — replace the runtime settings (validated server-side). */
export async function updateAdminSettings(
  token: string,
  settings: AdminSettings,
): Promise<AdminSettings> {
  return apiFetch<AdminSettings>('/admin/settings', {
    method: 'PUT',
    headers: {
      'X-Admin-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * POST /report — submit an abuse/content report for a paste or file (public).
 *
 * Uses URLSearchParams so the Go backend's r.ParseForm() reads the fields.
 */
export async function submitReport(data: {
  resourceType: ReportResourceType;
  slug: string;
  reason: string;
  details: string;
  turnstileToken: string;
}): Promise<{ success: boolean; message: string }> {
  const body = new URLSearchParams();
  body.append('resource_type', data.resourceType);
  body.append('slug', data.slug);
  body.append('reason', data.reason);
  body.append('details', data.details);
  body.append('turnstile_token', data.turnstileToken);
  return apiFetch<{ success: boolean; message: string }>('/report', {
    method: 'POST',
    body,
  });
}

/** GET /admin/reports — list reports, optionally filtered by status. */
export async function getAdminReports(
  token: string,
  status?: ReportStatus | 'all',
): Promise<AdminReportListResponse> {
  const query = status && status !== 'all' ? `?status=${status}` : '';
  return apiFetch<AdminReportListResponse>(`/admin/reports${query}`, {
    cache: 'no-store',
    headers: { 'X-Admin-Token': token },
  });
}

/** PATCH /admin/reports/{id} — change a report's review status. */
export async function updateAdminReportStatus(
  token: string,
  id: string,
  status: ReportStatus,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/admin/reports/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        'X-Admin-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    },
  );
}

/** DELETE /admin/reports/{id} — permanently delete a report. */
export async function deleteAdminReport(
  token: string,
  id: string,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/admin/reports/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token },
    },
  );
}

// ---------------------------------------------------------------------------
// Admin Backup API
// ---------------------------------------------------------------------------

/** GET /admin/backups — list available snapshot files. */
export async function getAdminBackups(
  token: string,
): Promise<AdminBackupListResponse> {
  return apiFetch<AdminBackupListResponse>('/admin/backups', {
    cache: 'no-store',
    headers: { 'X-Admin-Token': token },
  });
}

/** POST /admin/backups/create — trigger creation of an instant backup snapshot. */
export async function createAdminBackup(
  token: string,
): Promise<{ success: boolean; backup: AdminBackupItem }> {
  return apiFetch<{ success: boolean; backup: AdminBackupItem }>('/admin/backups/create', {
    method: 'POST',
    headers: { 'X-Admin-Token': token },
  });
}

/** POST /admin/backups/restore — restore system state from a server snapshot. */
export async function restoreRecentAdminBackup(
  token: string,
  filename: string,
  wipeFirst = false,
): Promise<AdminRestoreResult> {
  return apiFetch<AdminRestoreResult>('/admin/backups/restore', {
    method: 'POST',
    headers: {
      'X-Admin-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, wipe_first: wipeFirst }),
  });
}

/** POST /admin/backups/restore-json — upload & restore a JSON backup file. */
export async function restoreUploadedAdminBackup(
  token: string,
  file: File,
  wipeFirst = false,
): Promise<AdminRestoreResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (wipeFirst) {
    formData.append('wipe_first', 'true');
  }

  const query = wipeFirst ? '?wipe_first=true' : '';
  const url = buildUrl(`/admin/backups/restore-json${query}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Admin-Token': token,
      Accept: 'application/json',
    },
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: 'Upload failed', code: 'UNKNOWN' }));
    throw new APIError(errorBody.error || 'Upload failed', errorBody.code || 'UNKNOWN', res.status);
  }

  return (await res.json()) as AdminRestoreResult;
}

/** Helper to trigger browser download for a snapshot file. */
export function getAdminBackupDownloadUrl(token: string, filename: string): string {
  const base = buildUrl(`/admin/backups/download/${encodeURIComponent(filename)}`);
  return `${base}?token=${encodeURIComponent(token)}`;
}

