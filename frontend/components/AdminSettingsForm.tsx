'use client';

// components/AdminSettingsForm.tsx
//
// Settings editor used by the hidden admin dashboard. Lets an admin change the
// max paste/file size, the expiry options offered on the create/upload forms,
// and per-IP daily limits for pastes and uploads. All values are validated
// again server-side; this form does light client-side validation for UX.

import { useEffect, useState } from 'react';
import { getAdminSettings, updateAdminSettings } from '@/lib/api';
import { APIError } from '@/lib/types';
import type { AdminSettings, AdminExpiryOption } from '@/lib/types';

const MB = 1024 * 1024;

const INPUT_CLASS =
  'w-full min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 ' +
  'text-on-surface placeholder-on-surface-variant font-mono text-sm transition-colors ' +
  'focus:border-secondary focus:outline-none focus:shadow-[0_0_10px_rgba(76,215,246,0.2)] disabled:cursor-not-allowed disabled:opacity-60';

function bytesToMB(bytes: number): string {
  return (bytes / MB).toFixed(bytes % MB === 0 ? 0 : 2);
}

interface ExpiryListEditorProps {
  title: string;
  hint: string;
  options: AdminExpiryOption[];
  onChange: (next: AdminExpiryOption[]) => void;
  disabled: boolean;
}

function ExpiryListEditor({
  title,
  hint,
  options,
  onChange,
  disabled,
}: ExpiryListEditorProps) {
  const update = (i: number, patch: Partial<AdminExpiryOption>) => {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const add = () => onChange([...options, { label: '', minutes: 60 }]);

  return (
    <div
      role="group"
      aria-label={title}
      className="space-y-3 border-2 border-surface-variant bg-surface-container-lowest p-4"
    >
      <div>
        <h3 className="text-sm font-mono text-secondary uppercase tracking-wider">{title}</h3>
        <p className="mt-1 text-xs text-on-surface-variant font-mono">{hint}</p>
      </div>
      <ul className="space-y-2">
        {options.map((o, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={o.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label (e.g. 1 Hour)"
              disabled={disabled}
              className={`${INPUT_CLASS} max-w-[12rem] flex-1`}
            />
            <input
              type="number"
              min={0}
              value={o.minutes}
              onChange={(e) => update(i, { minutes: Number(e.target.value) })}
              placeholder="Minutes"
              disabled={disabled}
              className={`${INPUT_CLASS} max-w-[8rem]`}
            />
            <span className="text-xs text-on-surface-variant font-mono">minutes (0 = forever)</span>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              className="ml-auto inline-flex min-h-[40px] items-center border-2 border-danger-red/40 px-3 py-1.5 text-sm font-mono text-danger-red transition-colors hover:bg-danger-red/20 disabled:opacity-60"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="inline-flex min-h-[40px] items-center border-2 border-surface-variant bg-surface-container-lowest px-4 py-2 text-sm font-mono text-on-surface transition-colors hover:border-secondary hover:text-secondary disabled:opacity-60"
      >
        + Add Option
      </button>
    </div>
  );
}

export function AdminSettingsForm({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load current settings on mount. State is only set after the awaited fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getAdminSettings(token);
        if (!cancelled) setSettings(s);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof APIError && (err.status === 401 || err.status === 404)) {
          onUnauthorized();
          return;
        }
        setError('Failed to load settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, onUnauthorized]);

  const patch = (p: Partial<AdminSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...p } : prev));

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateAdminSettings(token, settings);
      setSettings(saved);
      setNotice('Settings saved successfully.');
    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 401 || err.status === 404) {
          onUnauthorized();
          return;
        }
        setError(err.message || 'Failed to save settings.');
      } else {
        setError('Failed to save settings.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="py-8 text-center text-on-surface-variant font-mono">Loading settings...</p>;
  }

  if (!settings) {
    return (
      <div
        role="alert"
        className="border-2 border-danger-red bg-error-container/20 px-4 py-3 text-sm font-mono text-error"
      >
        {error ?? 'Settings unavailable.'}
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {notice && (
        <div
          role="status"
          className="border-2 border-success-green bg-success-green/20 px-4 py-3 text-sm font-mono text-success-green"
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="border-2 border-danger-red bg-error-container/20 px-4 py-3 text-sm font-mono text-error"
        >
          {error}
        </div>
      )}

      {/* Size limits */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
            Max Paste Size (MB)
          </span>
          <input
            type="number"
            min={0}
            step="0.5"
            value={bytesToMB(settings.max_paste_size_bytes)}
            onChange={(e) =>
              patch({ max_paste_size_bytes: Math.round(Number(e.target.value) * MB) })
            }
            disabled={saving}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-2">
          <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
            Max File Size (MB)
          </span>
          <input
            type="number"
            min={0}
            step="1"
            value={bytesToMB(settings.max_file_size_bytes)}
            onChange={(e) =>
              patch({ max_file_size_bytes: Math.round(Number(e.target.value) * MB) })
            }
            disabled={saving}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      {/* Daily limits */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
            Maks. Pastes / IP / Day
          </span>
          <input
            type="number"
            min={0}
            value={settings.max_pastes_per_day_per_ip}
            onChange={(e) =>
              patch({ max_pastes_per_day_per_ip: Number(e.target.value) })
            }
            disabled={saving}
            className={INPUT_CLASS}
          />
          <span className="block text-xs text-gray-500 dark:text-gray-500">0 = unlimited</span>
        </label>
        <label className="space-y-2">
          <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
            Maks. File Uploads / IP / Day
          </span>
          <input
            type="number"
            min={0}
            value={settings.max_file_uploads_per_day_per_ip}
            onChange={(e) =>
              patch({ max_file_uploads_per_day_per_ip: Number(e.target.value) })
            }
            disabled={saving}
            className={INPUT_CLASS}
          />
          <span className="block text-xs text-gray-500 dark:text-gray-500">0 = unlimited</span>
        </label>
      </div>

      {/* Daily size limits */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
            Global Daily Upload Size Limit (MB)
          </span>
          <input
            type="number"
            min={0}
            value={settings.max_daily_upload_bytes ? bytesToMB(settings.max_daily_upload_bytes) : 0}
            onChange={(e) =>
              patch({ max_daily_upload_bytes: Math.round(Number(e.target.value) * MB) })
            }
            disabled={saving}
            className={INPUT_CLASS}
          />
          <span className="block text-xs text-gray-500 dark:text-gray-500">0 = unlimited global</span>
        </label>
        <label className="space-y-2">
          <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
            Daily Upload Size Limit Per IP (MB)
          </span>
          <input
            type="number"
            min={0}
            value={settings.max_daily_upload_bytes_per_ip ? bytesToMB(settings.max_daily_upload_bytes_per_ip) : 0}
            onChange={(e) =>
              patch({ max_daily_upload_bytes_per_ip: Math.round(Number(e.target.value) * MB) })
            }
            disabled={saving}
            className={INPUT_CLASS}
          />
          <span className="block text-xs text-gray-500 dark:text-gray-500">0 = unlimited per IP</span>
        </label>
      </div>

      {/* Temporary Toggles */}
      <div className="grid gap-4 sm:grid-cols-3 border-2 border-surface-variant bg-surface-container-lowest p-4">
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.disable_new_pastes ?? false}
            onChange={(e) => patch({ disable_new_pastes: e.target.checked })}
            disabled={saving}
            className="h-4 w-4 border-2 border-surface-variant text-secondary focus:ring-secondary bg-transparent"
          />
          <div>
            <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
              Temporarily Disable New Pastes
            </span>
            <span className="block text-xs text-on-surface-variant font-mono">
              Prevents users from creating new pastes.
            </span>
          </div>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.disable_file_uploads ?? false}
            onChange={(e) => patch({ disable_file_uploads: e.target.checked })}
            disabled={saving}
            className="h-4 w-4 border-2 border-surface-variant text-secondary focus:ring-secondary bg-transparent"
          />
          <div>
            <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
              Temporarily Disable File Uploads
            </span>
            <span className="block text-xs text-on-surface-variant font-mono">
              Prevents users from uploading new files.
            </span>
          </div>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.use_direct_upload ?? false}
            onChange={(e) => patch({ use_direct_upload: e.target.checked })}
            disabled={saving}
            className="h-4 w-4 border-2 border-surface-variant text-secondary focus:ring-secondary bg-transparent"
          />
          <div>
            <span className="block text-sm font-mono text-secondary uppercase tracking-wider">
              Use Direct-to-S3 Upload
            </span>
            <span className="block text-xs text-on-surface-variant font-mono">
              Upload files directly to S3 storage via presigned URLs.
            </span>
          </div>
        </label>
      </div>

      <ExpiryListEditor
        title="Paste Expiry Options"
        hint="Shown on the create paste form."
        options={settings.paste_expiry_options}
        onChange={(next) => patch({ paste_expiry_options: next })}
        disabled={saving}
      />

      <ExpiryListEditor
        title="File Expiry Options"
        hint="Shown on the file upload form."
        options={settings.file_expiry_options}
        onChange={(next) => patch({ file_expiry_options: next })}
        disabled={saving}
      />

      <button
        type="submit"
        disabled={saving}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-secondary bg-secondary px-6 py-2.5 font-mono font-bold text-black uppercase tracking-wider shadow-[0_0_10px_rgba(76,215,246,0.3)] transition-all hover:shadow-[0_0_20px_rgba(76,215,246,0.5)] active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </form>
  );
}

export default AdminSettingsForm;
