'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  getAdminStats,
  getAdminPastes,
  getAdminFiles,
  deleteAdminPaste,
  deleteAdminFile,
  purgeExpired,
  getAdminReports,
  updateAdminReportStatus,
  deleteAdminReport,
} from '@/lib/api';
import { APIError, REPORT_REASONS } from '@/lib/types';
import type { AdminStats, AdminPasteItem, AdminFileItem, AdminReport, ReportStatus } from '@/lib/types';
import { formatRelativeTime, formatFileSize } from '@/lib/utils';
import { AdminSettingsForm } from '@/components/AdminSettingsForm';

const TOKEN_STORAGE_KEY = 'darkcopy_admin_token';
const tokenListeners = new Set<() => void>();

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}
function subscribeToken(cb: () => void): () => void { tokenListeners.add(cb); const onS = (e: StorageEvent) => { if (e.key === TOKEN_STORAGE_KEY) cb(); }; window.addEventListener('storage', onS); return () => { tokenListeners.delete(cb); window.removeEventListener('storage', onS); }; }
function notifyTokenListeners(): void { tokenListeners.forEach((l) => l()); }
function setStoredToken(token: string): void { sessionStorage.setItem(TOKEN_STORAGE_KEY, token); notifyTokenListeners(); }
function clearStoredToken(): void { sessionStorage.removeItem(TOKEN_STORAGE_KEY); notifyTokenListeners(); }

const VISIBILITY_LABELS: Record<string, string> = { public: 'Public', unlisted: 'Unlisted', password_protected: 'Password Protected' };
const REASON_LABELS: Record<string, string> = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));
function reasonLabel(reason: string): string { return REASON_LABELS[reason] ?? reason; }
function isExpired(expiresAt: string | null): boolean { if (!expiresAt) return false; return new Date(expiresAt).getTime() < Date.now(); }

const REPORT_STATUS_LABELS: Record<string, string> = { pending: 'Pending', reviewed: 'Reviewed', dismissed: 'Dismissed' };

function TabBar({ tabs, current, onChange }: { tabs: { key: string; label: string; count?: number; alert?: boolean }[]; current: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 border-b-2 border-surface-variant overflow-x-auto scrollbar-none whitespace-nowrap -mx-4 px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={`shrink-0 min-h-[44px] px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
            current === t.key
              ? 'border-b-2 border-secondary text-secondary'
              : 'text-on-surface-variant hover:text-secondary'
          }`}>
          {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          {t.alert && t.count && t.count > 0 ? <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-danger-red px-1.5 py-0.5 text-[10px] leading-none text-white">{t.count}</span> : ''}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border-2 border-surface-variant bg-surface-container-lowest p-4">
      <p className="text-label-caps text-outline">{label}</p>
      <p className={`mt-1 text-xl font-mono font-bold ${highlight ? 'text-danger-red' : 'text-secondary'}`}>{value}</p>
    </div>
  );
}

function TokenGate() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed || loading) return;
    setLoading(true); setError(null);
    try {
      await getAdminStats(trimmed);
      setStoredToken(trimmed);
    } catch (err) {
      setError(err instanceof APIError ? (err.status === 404 ? 'Admin API is not active on the server.' : 'Invalid admin token.') : 'An error occurred.');
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-12">
      <div className="w-full border-2 border-surface-variant bg-surface-container-lowest p-6 sm:p-8">
        <div className="mb-5 flex justify-center">
          <span className="text-3xl text-secondary font-mono">{'[!]'}</span>
        </div>
        <h1 className="mb-1 text-center font-mono text-lg text-secondary uppercase tracking-wider">ADMIN ACCESS</h1>
        <p className="mb-6 text-center text-xs font-mono text-on-surface-variant">ENTER ADMIN TOKEN TO CONTINUE.</p>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="admin-token" className="text-label-caps text-secondary">ADMIN_TOKEN</label>
            <input type="password" id="admin-token" value={token} onChange={(e) => setToken(e.target.value)}
              disabled={loading} autoComplete="off" autoFocus placeholder="********"
              className="w-full min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface placeholder-on-surface-variant font-mono text-sm focus:border-secondary focus:outline-none focus:shadow-[0_0_10px_rgba(76,215,246,0.2)] disabled:cursor-not-allowed disabled:opacity-60" />
          </div>
          {error && <div role="alert" className="border-2 border-danger-red bg-error-container/20 px-4 py-3"><p className="text-sm font-mono text-error">⚠ ERROR: {error}</p></div>}
          <button type="submit" disabled={loading}
            className="inline-flex min-h-[44px] w-full items-center justify-center border-2 border-secondary text-secondary px-6 py-2.5 font-mono font-bold text-sm uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black active:translate-y-[2px] disabled:opacity-60">
            {loading ? 'VERIFYING...' : '> LOGIN'}
          </button>
        </form>
      </div>
    </div>
  );
}

type Tab = 'overview' | 'pastes' | 'files' | 'reports' | 'settings';

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [pastes, setPastes] = useState<AdminPasteItem[]>([]);
  const [files, setFiles] = useState<AdminFileItem[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [loadingPastes, setLoadingPastes] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => { setLoading(true); setReloadKey((k) => k + 1); }, []);
  const topPastes = stats?.top_pastes || [];
  const topFiles = stats?.top_files || [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getAdminStats(token); if (cancelled) return; setStats(s); setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof APIError && (err.status === 401 || err.status === 404)) { onLogout(); return; }
        setError('Failed to load admin statistics.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token, onLogout, reloadKey]);

  useEffect(() => {
    if (tab !== 'pastes') return; let cancelled = false;
    (async () => { try { setLoadingPastes(true); const r = await getAdminPastes(token); if (cancelled) return; setPastes(r.pastes ?? []); setError(null); } catch (err) { if (cancelled) return; if (err instanceof APIError && (err.status === 401 || err.status === 404)) { onLogout(); return; } setError('Failed to load paste list.'); } finally { if (!cancelled) setLoadingPastes(false); } })();
    return () => { cancelled = true; };
  }, [token, onLogout, tab, reloadKey]);

  useEffect(() => {
    if (tab !== 'files') return; let cancelled = false;
    (async () => { try { setLoadingFiles(true); const r = await getAdminFiles(token); if (cancelled) return; setFiles(r.files ?? []); setError(null); } catch (err) { if (cancelled) return; if (err instanceof APIError && (err.status === 401 || err.status === 404)) { onLogout(); return; } setError('Failed to load file list.'); } finally { if (!cancelled) setLoadingFiles(false); } })();
    return () => { cancelled = true; };
  }, [token, onLogout, tab, reloadKey]);

  useEffect(() => {
    if (tab !== 'reports') return; let cancelled = false;
    (async () => { try { setLoadingReports(true); const r = await getAdminReports(token); if (cancelled) return; setReports(r.reports ?? []); setError(null); } catch (err) { if (cancelled) return; if (err instanceof APIError && (err.status === 401 || err.status === 404)) { onLogout(); return; } setError('Failed to load report list.'); } finally { if (!cancelled) setLoadingReports(false); } })();
    return () => { cancelled = true; };
  }, [token, onLogout, tab, reloadKey]);

  const handleDeletePaste = async (slug: string) => {
    if (!window.confirm(`Delete paste "${slug}"?`)) return;
    setBusySlug(slug);
    try { await deleteAdminPaste(token, slug); setPastes((p) => p.filter((x) => x.slug !== slug)); setStats((s) => s ? { ...s, total_pastes: Math.max(0, s.total_pastes - 1) } : s); } catch { setError(`Failed to delete paste "${slug}".`); } finally { setBusySlug(null); }
  };

  const handleDeleteFile = async (slug: string) => {
    if (!window.confirm(`Delete file "${slug}"?`)) return;
    setBusySlug(slug);
    try { await deleteAdminFile(token, slug); setFiles((f) => f.filter((x) => x.slug !== slug)); setStats((s) => s ? { ...s, total_files: Math.max(0, s.total_files - 1) } : s); } catch { setError(`Failed to delete file "${slug}".`); } finally { setBusySlug(null); }
  };

  const handleReportStatus = async (id: string, status: ReportStatus) => {
    setBusyReportId(id);
    try { await updateAdminReportStatus(token, id, status); setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r))); } catch { setError('Failed to update report status.'); } finally { setBusyReportId(null); }
  };

  const handleDeleteReportedContent = async (id: string, resourceType: 'paste' | 'file', slug: string) => {
    const label = resourceType === 'file' ? 'file' : 'paste';
    if (!window.confirm(`Delete reported ${label} "${slug}"?`)) return;
    setBusyReportId(id);
    try {
      if (resourceType === 'file') { await deleteAdminFile(token, slug); setFiles((f) => f.filter((x) => x.slug !== slug)); setStats((s) => s ? { ...s, total_files: Math.max(0, s.total_files - 1) } : s); }
      else { await deleteAdminPaste(token, slug); setPastes((p) => p.filter((x) => x.slug !== slug)); setStats((s) => s ? { ...s, total_pastes: Math.max(0, s.total_pastes - 1) } : s); }
      await deleteAdminReport(token, id).catch(() => {});
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      if (err instanceof APIError && err.status === 404) { await deleteAdminReport(token, id).catch(() => {}); setReports((prev) => prev.filter((r) => r.id !== id)); return; }
      setError(`Failed to delete ${label} "${slug}".`);
    } finally { setBusyReportId(null); }
  };

  const handleDeleteReport = async (id: string) => { if (!window.confirm('Delete this report?')) return; setBusyReportId(id); try { await deleteAdminReport(token, id); setReports((prev) => prev.filter((r) => r.id !== id)); } catch { setError('Failed to delete report.'); } finally { setBusyReportId(null); } };

  const handlePurge = async () => {
    if (!window.confirm('Bersihkan semua yang kadaluarsa?')) return;
    setPurging(true); setError(null); setNotice(null);
    try {
      const { deleted } = await purgeExpired(token);
      setNotice(deleted > 0 ? `${deleted} item kadaluarsa telah dibersihkan.` : 'Tidak ada item kadaluarsa.');
      reload();
    } catch (err) { if (err instanceof APIError && (err.status === 401 || err.status === 404)) { onLogout(); return; } setError('Gagal membersihkan.'); } finally { setPurging(false); }
  };

  return (
    <div className="space-y-6">
      <div className="border-2 border-secondary bg-secondary/5 px-4 py-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5" aria-hidden="true"><span className="w-2.5 h-2.5 rounded-full bg-success-green animate-terminal-blink" /></div>
            <h1 className="font-mono text-sm text-secondary uppercase tracking-wider">{'>'} ADMIN PANEL</h1>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={handlePurge} disabled={loading || purging}
              className="inline-flex min-h-[40px] items-center justify-center border-2 border-tertiary text-tertiary px-4 py-1.5 text-xs font-mono uppercase tracking-wider transition-all hover:bg-tertiary hover:text-black active:translate-y-[1px] disabled:opacity-60">
              {purging ? 'PURGING...' : '> PURGE EXPIRED'}
            </button>
            <button type="button" onClick={reload} disabled={loading}
              className="inline-flex min-h-[40px] items-center justify-center border-2 border-surface-variant text-on-surface-variant px-4 py-1.5 text-xs font-mono uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary active:translate-y-[1px] disabled:opacity-60">
              [ RELOAD ]
            </button>
            <button type="button" onClick={onLogout}
              className="inline-flex min-h-[40px] items-center justify-center border-2 border-hot-pink text-hot-pink px-4 py-1.5 text-xs font-mono uppercase tracking-wider transition-all hover:bg-hot-pink hover:text-black active:translate-y-[1px]">
              [ LOGOUT ]
            </button>
          </div>
        </div>
      </div>

      {notice && <div role="status" className="border-2 border-success-green bg-success-green/10 px-4 py-3"><p className="text-sm font-mono text-success-green">✓ {notice}</p></div>}
      {error && <div role="alert" className="border-2 border-danger-red bg-error-container/20 px-4 py-3"><p className="text-sm font-mono text-error">⚠ ERROR: {error}</p></div>}

      <TabBar
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'pastes', label: 'Pastes', count: stats ? stats.total_pastes : undefined },
          { key: 'files', label: 'Files', count: stats ? stats.total_files : undefined },
          { key: 'reports', label: 'Reports', count: stats ? stats.pending_reports : undefined, alert: true },
          { key: 'settings', label: 'Settings' },
        ]}
        current={tab} onChange={(k) => setTab(k as Tab)}
      />

      {tab === 'settings' ? (
        <AdminSettingsForm token={token} onUnauthorized={onLogout} />
      ) : loading ? (
        <p className="py-8 text-center text-sm font-mono text-on-surface-variant">LOADING...</p>
      ) : tab === 'overview' ? (
        <div className="space-y-6">
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="TOTAL PASTES" value={stats ? String(stats.total_pastes) : '—'} />
            <StatCard label="TOTAL FILES" value={stats ? String(stats.total_files) : '—'} />
            <StatCard label="STORAGE" value={stats && stats.total_bytes !== undefined ? formatFileSize(stats.total_bytes) : '—'} />
            <StatCard label="PENDING REPORTS" value={stats ? String(stats.pending_reports) : '—'} highlight={!!(stats && stats.pending_reports > 0)} />
          </div>

          {/* S3 Sharding */}
          {stats && stats.provider_stats && stats.provider_stats.length > 0 && (
            <div className="border-2 border-surface-variant bg-surface-container-lowest">
              <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low border-b-2 border-surface-variant">
                <span className="text-label-caps text-secondary">S3 DISTRIBUTION MONITOR</span>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {stats.provider_stats.map((p) => {
                  const totalBytes = stats.total_bytes || 1;
                  const percentage = Math.min(100, Math.round((p.size_bytes / totalBytes) * 100));
                  return (
                    <div key={p.provider_name} className="border-2 border-surface-variant bg-terminal-bg p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-mono text-sm text-secondary">{'>'} {p.provider_name}</span>
                        <span className="text-label-caps text-secondary">{percentage}%</span>
                      </div>
                      <div className="space-y-1 mb-3">
                        <div className="flex justify-between text-xs font-mono text-on-surface-variant">
                          <span>STORAGE</span><span className="text-on-surface">{formatFileSize(p.size_bytes)}</span>
                        </div>
                        <div className="flex justify-between text-xs font-mono text-on-surface-variant">
                          <span>FILES</span><span className="text-on-surface">{p.files_count}</span>
                        </div>
                      </div>
                      <div className="h-2 border border-surface-variant bg-terminal-bg">
                        <div className="h-full bg-secondary" style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top 5 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="border-2 border-surface-variant bg-surface-container-lowest">
              <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low border-b-2 border-surface-variant">
                <span className="text-label-caps text-secondary">TOP 5 PASTES (VIEWS)</span>
              </div>
              <div className="divide-y-2 divide-surface-variant">
                {topPastes.length === 0 ? (
                  <p className="p-4 text-xs font-mono text-on-surface-variant text-center">No data.</p>
                ) : topPastes.map((p, idx) => (
                  <div key={p.slug} className="flex flex-wrap items-center justify-between px-4 py-3 gap-2">
                    <div className="min-w-0 flex-auto sm:flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-outline w-4 shrink-0">#{idx + 1}</span>
                        <a href={`/${p.slug}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-mono text-on-surface hover:text-secondary">{p.title.trim() || 'Untitled'}</a>
                      </div>
                      <p className="text-xs font-mono text-on-surface-variant pl-6 truncate"><code>{p.slug}</code> • {p.language}</p>
                    </div>
                    <span className="shrink-0 border border-secondary text-secondary px-2 py-0.5 text-[10px] font-mono">{p.views || 0}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-2 border-surface-variant bg-surface-container-lowest">
              <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low border-b-2 border-surface-variant">
                <span className="text-label-caps text-secondary">TOP 5 FILES (DOWNLOADS)</span>
              </div>
              <div className="divide-y-2 divide-surface-variant">
                {topFiles.length === 0 ? (
                  <p className="p-4 text-xs font-mono text-on-surface-variant text-center">No data.</p>
                ) : topFiles.map((f, idx) => (
                  <div key={f.slug} className="flex items-center justify-between px-4 py-3 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-outline w-4 shrink-0">#{idx + 1}</span>
                        <a href={`/f/${f.slug}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-mono text-on-surface hover:text-secondary">{f.filename}</a>
                      </div>
                      <p className="text-xs font-mono text-on-surface-variant pl-6"><code>{f.slug}</code> • {formatFileSize(f.size_bytes)}</p>
                    </div>
                    <span className="shrink-0 border border-secondary text-secondary px-2 py-0.5 text-[10px] font-mono">{f.downloads || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : tab === 'pastes' ? loadingPastes ? <p className="py-8 text-center text-xs font-mono text-on-surface-variant">LOADING PASTES...</p> : (
        <ListSection items={pastes} busySlug={busySlug} onDelete={handleDeletePaste} type="paste" />
      ) : tab === 'files' ? loadingFiles ? <p className="py-8 text-center text-xs font-mono text-on-surface-variant">LOADING FILES...</p> : (
        <ListSection items={files} busySlug={busySlug} onDelete={handleDeleteFile} type="file" />
      ) : loadingReports ? <p className="py-8 text-center text-xs font-mono text-on-surface-variant">LOADING REPORTS...</p> : (
        <ReportsTableSection reports={reports} busyId={busyReportId} onStatus={handleReportStatus} onDeleteContent={handleDeleteReportedContent} onDelete={handleDeleteReport} />
      )}
    </div>
  );
}

function ListSection({ items, busySlug, onDelete, type }: { items: (AdminPasteItem | AdminFileItem)[]; busySlug: string | null; onDelete: (slug: string) => void; type: 'paste' | 'file' }) {
  if (items.length === 0) return <div className="border-2 border-dashed border-surface-variant bg-surface-container-low px-6 py-12 text-center"><p className="text-xs font-mono text-on-surface-variant">No {type === 'paste' ? 'pastes' : 'files'}.</p></div>;
  return (
    <div className="border-2 border-surface-variant divide-y-2 divide-surface-variant">
      {items.map((item: any) => {
        const expired = isExpired(item.expires_at);
        return (
          <div key={item.slug} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-surface-container-lowest hover:bg-surface-container-low transition-colors">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <a href={type === 'paste' ? `/${item.slug}` : `/f/${item.slug}`} target="_blank" rel="noopener noreferrer" className="truncate font-mono text-sm text-on-surface hover:text-secondary">{type === 'paste' ? (item.title?.trim() || 'Untitled') : item.filename}</a>
                {expired && <span className="border border-danger-red text-danger-red px-1.5 py-0.5 text-[10px] font-mono">EXPIRED</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs font-mono text-on-surface-variant">
                <code>{item.slug}</code>
                <span>•</span>
                {type === 'paste' && <><span className="border border-secondary text-secondary px-1.5 py-0.5 text-[10px]">{item.language}</span><span>•</span></>}
                {type === 'file' && <><span>{formatFileSize(item.size_bytes)}</span><span>•</span></>}
                <span>{VISIBILITY_LABELS[item.visibility] ?? item.visibility}</span>
                <span>•</span>
                <span>{formatRelativeTime(item.created_at)}</span>
              </div>
            </div>
            <button type="button" onClick={() => onDelete(item.slug)} disabled={busySlug === item.slug}
              className="inline-flex min-h-[36px] shrink-0 items-center justify-center border-2 border-danger-red text-danger-red px-3 py-1 text-xs font-mono uppercase tracking-wider transition-all hover:bg-danger-red hover:text-white active:translate-y-[1px] disabled:opacity-60">
              {busySlug === item.slug ? '...' : '[ DELETE ]'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ReportsTableSection({ reports, busyId, onStatus, onDeleteContent, onDelete }: {
  reports: AdminReport[]; busyId: string | null;
  onStatus: (id: string, status: ReportStatus) => void;
  onDeleteContent: (id: string, type: 'paste' | 'file', slug: string) => void;
  onDelete: (id: string) => void;
}) {
  if (reports.length === 0) return <div className="border-2 border-dashed border-surface-variant bg-surface-container-low px-6 py-12 text-center"><p className="text-xs font-mono text-on-surface-variant">No reports yet.</p></div>;
  return (
    <div className="space-y-2">
      {reports.map((r) => {
        const href = r.resource_type === 'file' ? `/f/${r.slug}` : `/${r.slug}`;
        const busy = busyId === r.id;
        return (
          <div key={r.id} className="border-2 border-surface-variant bg-surface-container-lowest p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="border border-secondary text-secondary px-2 py-0.5 text-[10px] font-mono">{r.resource_type === 'file' ? 'FILE' : 'PASTE'}</span>
              <span className="border border-hot-pink text-hot-pink px-2 py-0.5 text-[10px] font-mono">{reasonLabel(r.reason)}</span>
              <span className={`border px-2 py-0.5 text-[10px] font-mono ${r.status === 'pending' ? 'border-danger-red text-danger-red' : r.status === 'reviewed' ? 'border-success-green text-success-green' : 'border-outline text-outline'}`}>{REPORT_STATUS_LABELS[r.status] ?? r.status}</span>
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-secondary hover:underline">{r.slug}</a>
              <span className="ml-auto text-xs font-mono text-on-surface-variant">{formatRelativeTime(r.created_at)}</span>
            </div>
            {r.details && <p className="whitespace-pre-wrap break-words bg-terminal-bg border border-surface-variant px-3 py-2 text-xs font-mono text-on-surface mb-3">{r.details}</p>}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {r.status !== 'reviewed' && <button type="button" onClick={() => onStatus(r.id, 'reviewed')} disabled={busy} className="inline-flex min-h-[36px] items-center justify-center border-2 border-success-green text-success-green px-3 py-1 text-xs font-mono uppercase tracking-wider transition-all hover:bg-success-green hover:text-black disabled:opacity-60">MARK REVIEWED</button>}
              {r.status !== 'dismissed' && <button type="button" onClick={() => onStatus(r.id, 'dismissed')} disabled={busy} className="inline-flex min-h-[36px] items-center justify-center border-2 border-surface-variant text-on-surface-variant px-3 py-1 text-xs font-mono uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary disabled:opacity-60">DISMISS</button>}
              {r.status !== 'pending' && <button type="button" onClick={() => onStatus(r.id, 'pending')} disabled={busy} className="inline-flex min-h-[36px] items-center justify-center border-2 border-surface-variant text-on-surface-variant px-3 py-1 text-xs font-mono uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary disabled:opacity-60">RESTORE</button>}
              <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center justify-center border-2 border-surface-variant text-on-surface-variant px-3 py-1 text-xs font-mono uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary">VIEW</a>
              <button type="button" onClick={() => onDeleteContent(r.id, r.resource_type, r.slug)} disabled={busy} className="inline-flex min-h-[36px] items-center justify-center border-2 border-danger-red bg-danger-red/20 text-danger-red px-3 py-1 text-xs font-mono uppercase tracking-wider transition-all hover:bg-danger-red hover:text-white disabled:opacity-60">{busy ? '...' : 'DELETE CONTENT'}</button>
              <button type="button" onClick={() => onDelete(r.id)} disabled={busy} className="sm:ml-auto inline-flex min-h-[36px] items-center justify-center border-2 border-danger-red text-danger-red px-3 py-1 text-xs font-mono uppercase tracking-wider transition-all hover:bg-danger-red hover:text-white disabled:opacity-60">{busy ? '...' : 'DELETE REPORT'}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AdminDashboard() {
  const token = useSyncExternalStore(subscribeToken, readStoredToken, () => null);
  const handleLogout = useCallback(() => { clearStoredToken(); }, []);
  if (!token) return <TokenGate />;
  return <Dashboard token={token} onLogout={handleLogout} />;
}

export default AdminDashboard;
