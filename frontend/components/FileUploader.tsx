'use client';

import { useEffect, useRef, useState } from 'react';
import { formatFileSize } from '@/lib/utils';
import type { ExpiryOption, UploadResponse } from '@/lib/types';
import { CopyButton } from '@/components/CopyButton';
import { presignUpload, registerUploadedFile } from '@/lib/api';

interface FileUploaderProps {
  expiryOptions: ExpiryOption[];
  visibilities: string[];
  maxFileSize?: number;
  disabled?: boolean;
  useDirectUpload?: boolean;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

const VISIBILITY_LABELS: Record<string, string> = {
  public: 'PUBLIC',
  unlisted: 'UNLISTED',
  password_protected: 'PROTECTED',
};

function visibilityLabel(value: string): string {
  return VISIBILITY_LABELS[value] ?? value.toUpperCase();
}

const FIELD_CLASS =
  'w-full min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 ' +
  'text-on-surface placeholder-on-surface-variant font-mono text-sm transition-colors ' +
  'focus:border-secondary focus:outline-none focus:shadow-[0_0_10px_rgba(76,215,246,0.2)] disabled:cursor-not-allowed disabled:opacity-60';

export function FileUploader({ expiryOptions, visibilities, maxFileSize = 100 * 1024 * 1024, disabled, useDirectUpload }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expiresIn, setExpiresIn] = useState(
    expiryOptions[0] ? String(expiryOptions[0].duration) : '',
  );
  const [visibility, setVisibility] = useState(
    visibilities.includes('public') ? 'public' : (visibilities[0] ?? 'public'),
  );
  const [password, setPassword] = useState('');

  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string>('');
  const [uploadedMd5, setUploadedMd5] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const isUploading = status === 'uploading';
  const isFormDisabled = isUploading || disabled;

  useEffect(() => () => { xhrRef.current?.abort(); }, []);

  const selectFile = (selected: File) => {
    setFile(selected);
    setStatus('idle');
    setProgress(0);
    setUploadUrl('');
    setError(selected.size > maxFileSize ? `Size exceeds max ${formatFileSize(maxFileSize)}` : null);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!isFormDisabled) setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (isFormDisabled) return;
    const dropped = e.dataTransfer.files;
    if (dropped && dropped.length > 0) selectFile(dropped[0]);
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    if (picked && picked.length > 0) selectFile(picked[0]);
  };
  const openFileDialog = () => { if (!isFormDisabled) fileInputRef.current?.click(); };
  const handleTouchEnd = (e: React.TouchEvent) => { e.preventDefault(); if (!isFormDisabled) openFileDialog(); };

  const handleUpload = () => {
    if (!file || isUploading || file.size > maxFileSize) return;
    setStatus('uploading'); setProgress(0); setError(null); setUploadUrl('');

    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    const onSuccess = (url: string) => { setUploadUrl(url); setStatus('success'); };
    const onError = (msg: string) => { setError(msg); setStatus('error'); };

    if (useDirectUpload) {
      presignUpload({
        filename: file.name, size_bytes: file.size, mime_type: file.type || 'application/octet-stream',
        visibility, password: visibility === 'password_protected' ? password : '', expires_in: expiresIn,
      }).then((presignData) => {
        const xhr = new XMLHttpRequest(); xhrRef.current = xhr;
        xhr.upload.onprogress = onProgress;
        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status === 200 || xhr.status === 201 || xhr.status === 204) {
            const etag = xhr.getResponseHeader('ETag');
            const md5Hash = etag ? etag.replace(/['"]/g, '').toLowerCase() : '';
            if (md5Hash) setUploadedMd5(md5Hash);

            registerUploadedFile({
              slug: presignData.slug, filename: file.name, size_bytes: file.size,
              mime_type: file.type || 'application/octet-stream', storage_key: presignData.storage_key,
              visibility, password: visibility === 'password_protected' ? password : '', expires_in: expiresIn,
              md5_hash: md5Hash,
            }).then((result) => {
              const origin = typeof window !== 'undefined' ? window.location.origin : '';
              const rawUrl = result.url ?? '';
              onSuccess(/^https?:\/\//.test(rawUrl) ? rawUrl : `${origin}${rawUrl}`);
            }).catch((err) => onError(err.message || 'Registration failed.'));
          } else onError('Failed to upload file to storage.');
        };
        xhr.onerror = () => { xhrRef.current = null; onError('Network error during upload.'); };
        xhr.open('PUT', presignData.upload_url);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      }).catch((err) => { xhrRef.current = null; onError(err.message || 'Presign failed.'); });
    } else {
      const formData = new FormData();
      formData.append('file', file); formData.append('visibility', visibility);
      formData.append('expires_in', expiresIn);
      if (visibility === 'password_protected') formData.append('password', password);

      const xhr = new XMLHttpRequest(); xhrRef.current = xhr;
      xhr.upload.onprogress = onProgress;
      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status === 201) {
          try {
            const result: UploadResponse = JSON.parse(xhr.responseText);
            if (result.md5_hash) setUploadedMd5(result.md5_hash);
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const rawUrl = result.url ?? '';
            onSuccess(/^https?:\/\//.test(rawUrl) ? rawUrl : `${origin}${rawUrl}`);
          } catch { onError('Invalid server response.'); }
          return;
        }
        if (xhr.status === 413) { onError(`Size exceeds max ${formatFileSize(maxFileSize)}`); return; }
        let msg = 'Upload failed. Try again.';
        try { const p = JSON.parse(xhr.responseText); if (p?.error) msg = p.error; } catch {}
        onError(msg);
      };
      xhr.onerror = () => { xhrRef.current = null; onError('Network error during upload.'); };
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send(formData);
    }
  };

  const resetForAnother = () => {
    setFile(null); setStatus('idle'); setProgress(0); setError(null); setUploadUrl(''); setUploadedMd5('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (status === 'success') {
    return (
      <div className="space-y-6">
        <div className="border-2 border-secondary bg-secondary/10 px-4 py-3">
          <p className="text-sm font-mono text-secondary">✓ FILE UPLOADED SUCCESSFULLY</p>
        </div>
        <div className="border-2 border-surface-variant bg-surface-container-lowest p-4 md:p-6">
          <label htmlFor="upload-url" className="text-label-caps text-secondary block mb-2">FILE_URL</label>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input id="upload-url" type="text" readOnly value={uploadUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-h-[44px] border-2 border-surface-variant bg-terminal-bg px-3 py-2.5 text-sm font-mono text-secondary focus:outline-none" />
            <CopyButton content={uploadUrl} />
          </div>
          <a href={uploadUrl} className="inline-flex min-h-[44px] items-center text-sm font-mono text-secondary underline-offset-2 hover:underline mt-2">
            {'>'} OPEN FILE
          </a>
          {uploadedMd5 && (
            <div className="mt-4 border-t border-surface-variant pt-4">
              <span className="text-label-caps text-secondary block mb-1">FILE_MD5</span>
              <p className="text-xs font-mono text-on-surface break-all">{uploadedMd5}</p>
            </div>
          )}
        </div>
        <button type="button" onClick={resetForAnother}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-secondary text-secondary px-6 py-2.5 font-mono font-bold uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black active:translate-y-[2px]">
          {'>'} UPLOAD ANOTHER
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {disabled && (
        <div className="border-2 border-tertiary bg-surface-container-low px-4 py-3">
          <p className="text-sm font-mono text-tertiary">⚠ FILE UPLOAD SUSPENDED — SYSTEM MAINTENANCE</p>
        </div>
      )}

      {/* Upload zone */}
      <div className="space-y-2">
        <span className="text-label-caps text-secondary">FILE (MAX {formatFileSize(maxFileSize).toUpperCase()})</span>
        <div
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          onClick={openFileDialog} onTouchEnd={handleTouchEnd}
          role="button" tabIndex={0} aria-label="Upload zone: drag file or tap to select"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFileDialog(); } }}
          className={`flex min-h-[200px] cursor-pointer touch-manipulation flex-col items-center justify-center border-2 border-dashed px-6 py-12 text-center transition-all duration-200 ${
            isDragging ? 'border-secondary bg-secondary/10' : 'border-surface-variant bg-surface-container-lowest hover:border-secondary hover:bg-surface-container-low'
          }`}
        >
          {isDragging ? (
            <p className="text-sm font-mono text-secondary uppercase tracking-wider">RELEASE FILE HERE</p>
          ) : file ? (
            <div className="flex items-center gap-3 text-left w-full min-w-0 justify-center px-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-secondary text-secondary font-mono text-xs">FILE</span>
              <div className="min-w-0 max-w-full">
                <p className="truncate font-mono text-sm text-on-surface">{file.name}</p>
                <p className="text-xs text-on-surface-variant font-mono">{formatFileSize(file.size)}{file.type ? ` · ${file.type}` : ''}</p>
              </div>
            </div>
          ) : (
            <>
              <span className="text-3xl text-outline font-mono mb-3">{'[^]'}</span>
              <p className="text-sm font-mono text-on-surface-variant uppercase tracking-wider">DRAG FILE HERE OR TAP TO SELECT</p>
            </>
          )}
        </div>

        <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" aria-hidden="true" />
        <button type="button" onClick={openFileDialog} disabled={isFormDisabled}
          className="inline-flex min-h-[44px] items-center justify-center border-2 border-surface-variant text-on-surface-variant px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-all duration-200 hover:border-secondary hover:text-secondary active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60">
          [ SELECT FILE FROM SYSTEM ]
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Expiry */}
        <div className="space-y-2">
          <label htmlFor="expires_in" className="text-label-caps text-secondary">EXPIRED_IN</label>
          <select id="expires_in" name="expires_in" value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)} disabled={isFormDisabled}
            className={FIELD_CLASS}>
            {expiryOptions.map((option) => (
              <option key={option.label} value={String(option.duration)} className="bg-background">{option.label}</option>
            ))}
          </select>
        </div>

        {/* Visibility */}
        <div className="space-y-2">
          <span className="text-label-caps text-secondary">VISIBILITY</span>
          <div className="flex flex-col gap-2">
            {visibilities.map((value) => (
              <label key={value}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 border-2 border-surface-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm font-mono text-on-surface transition-colors hover:border-secondary has-[:checked]:border-secondary has-[:checked]:bg-secondary/10">
                <input type="radio" name="visibility" value={value}
                  checked={visibility === value} onChange={() => setVisibility(value)}
                  className="appearance-none w-4 h-4 border-2 border-surface-variant rounded-full checked:border-secondary checked:shadow-[inset_0_0_0_4px_#4cd7f6] transition-all" />
                {visibilityLabel(value)}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Password */}
      {visibility === 'password_protected' && (
        <div className="space-y-2">
          <label htmlFor="password" className="text-label-caps text-secondary">PASSWORD</label>
          <input type="password" id="password" name="password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="********"
            autoComplete="new-password" disabled={isFormDisabled} className={FIELD_CLASS} />
        </div>
      )}

      {/* Progress */}
      {isUploading && (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center justify-between text-sm font-mono text-on-surface-variant">
            <span>UPLOADING...</span>
            <span>{progress}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden border-2 border-surface-variant bg-terminal-bg" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-secondary transition-[width] duration-150 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div role="alert" className="border-2 border-danger-red bg-error-container/20 px-4 py-3">
          <p className="text-sm font-mono text-error">⚠ ERROR: {error}</p>
        </div>
      )}

      {/* Upload button */}
      <div>
        <button type="button" onClick={handleUpload}
          disabled={!file || isFormDisabled || file.size > maxFileSize}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-secondary text-secondary px-8 py-3 font-mono font-bold uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black hover:shadow-[0_0_20px_rgba(76,215,246,0.4)] active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60">
          {isUploading && (
            <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isUploading ? 'UPLOADING...' : '> UPLOAD'}
        </button>
      </div>
    </div>
  );
}

export default FileUploader;
