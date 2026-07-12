'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { unlockPaste, unlockFile } from '@/lib/api';
import { APIError } from '@/lib/types';
import type { PasteViewResponse } from '@/lib/types';

export type GateStatus = 'idle' | 'loading' | 'error' | 'rate_limited';
export interface GateState { status: GateStatus; errorMessage: string | null; contentUnlocked: boolean; }
export type GateEvent =
  | { type: 'SUBMIT' } | { type: 'SUCCESS' } | { type: 'UNAUTHORIZED' }
  | { type: 'RATE_LIMITED' } | { type: 'NOT_FOUND' } | { type: 'GONE' }
  | { type: 'ERROR'; message?: string } | { type: 'COOLDOWN_ELAPSED' };

export const MSG_WRONG_PASSWORD = 'Incorrect password';
export const MSG_RATE_LIMITED = 'Too many attempts. Please try again later.';
export const MSG_NOT_FOUND = 'Not found';
export const MSG_GONE = 'Expired';
export const MSG_GENERIC = 'An error occurred. Please try again.';
export const RATE_LIMIT_COOLDOWN_MS = 30000;
export const initialGateState: GateState = { status: 'idle', errorMessage: null, contentUnlocked: false };
export function isFormEnabled(status: GateStatus): boolean { return status === 'idle' || status === 'error'; }

export function nextState(current: GateState, event: GateEvent): GateState {
  switch (event.type) {
    case 'SUBMIT': if (!isFormEnabled(current.status)) return current; return { status: 'loading', errorMessage: null, contentUnlocked: false };
    case 'SUCCESS': if (current.status !== 'loading') return current; return { status: 'idle', errorMessage: null, contentUnlocked: true };
    case 'UNAUTHORIZED': if (current.status !== 'loading') return current; return { status: 'error', errorMessage: MSG_WRONG_PASSWORD, contentUnlocked: false };
    case 'RATE_LIMITED': if (current.status !== 'loading') return current; return { status: 'rate_limited', errorMessage: MSG_RATE_LIMITED, contentUnlocked: false };
    case 'NOT_FOUND': if (current.status !== 'loading') return current; return { status: 'error', errorMessage: MSG_NOT_FOUND, contentUnlocked: false };
    case 'GONE': if (current.status !== 'loading') return current; return { status: 'error', errorMessage: MSG_GONE, contentUnlocked: false };
    case 'ERROR': if (current.status !== 'loading') return current; return { status: 'error', errorMessage: event.message ?? MSG_GENERIC, contentUnlocked: false };
    case 'COOLDOWN_ELAPSED': if (current.status !== 'rate_limited') return current; return { status: 'idle', errorMessage: null, contentUnlocked: false };
    default: return current;
  }
}

export function eventForStatus(status: number): GateEvent {
  switch (status) { case 401: return { type: 'UNAUTHORIZED' }; case 429: return { type: 'RATE_LIMITED' }; case 404: return { type: 'NOT_FOUND' }; case 410: return { type: 'GONE' }; default: return { type: 'ERROR' }; }
}

export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const ext = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (ext?.[1]) { try { return decodeURIComponent(ext[1].trim().replace(/^"|"$/g, '')); } catch {} }
  const plain = header.match(/filename="?([^"\n;]+)"?/i);
  if (plain?.[1]) return plain[1].trim();
  return null;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface PasswordGateProps { slug: string; resourceType: 'paste' | 'file'; onUnlock?: (data: PasteViewResponse) => void; }

export function PasswordGate({ slug, resourceType, onUnlock }: PasswordGateProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(nextState, initialGateState);
  const [password, setPassword] = useState('');
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cooldownTimer.current) clearTimeout(cooldownTimer.current); }, []);

  const formEnabled = isFormEnabled(state.status);
  const isLoading = state.status === 'loading';
  const submitDisabled = !formEnabled;
  const submitLabel = resourceType === 'file' ? 'Download File' : 'Unlock';

  const handleRateLimited = () => {
    dispatch({ type: 'RATE_LIMITED' });
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    cooldownTimer.current = setTimeout(() => { dispatch({ type: 'COOLDOWN_ELAPSED' }); cooldownTimer.current = null; }, RATE_LIMIT_COOLDOWN_MS);
  };

  const handlePasteUnlock = async () => {
    try {
      const data = await unlockPaste(slug, password);
      dispatch({ type: 'SUCCESS' });
      if (onUnlock) onUnlock(data); else router.push(`/${slug}`);
    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 401) setPassword('');
        if (err.status === 429) handleRateLimited(); else dispatch(eventForStatus(err.status));
      } else dispatch({ type: 'ERROR' });
    }
  };

  const handleFileUnlock = async () => {
    try {
      const response = await unlockFile(slug, password);
      if (response.ok) {
        const blob = await response.blob();
        const filename = filenameFromContentDisposition(response.headers.get('Content-Disposition')) ?? slug;
        triggerBlobDownload(blob, filename);
        dispatch({ type: 'SUCCESS' }); return;
      }
      if (response.status === 401) setPassword('');
      if (response.status === 429) handleRateLimited(); else dispatch(eventForStatus(response.status));
    } catch { dispatch({ type: 'ERROR' }); }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formEnabled) return;
    dispatch({ type: 'SUBMIT' });
    if (resourceType === 'file') await handleFileUnlock(); else await handlePasteUnlock();
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-12">
      <div className="w-full border-2 border-surface-variant bg-surface-container-lowest p-6 sm:p-8">
        <div className="mb-5 flex justify-center">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-danger-red" />
            <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
            <span className="w-2.5 h-2.5 rounded-full bg-success-green" />
          </div>
        </div>
        <h1 className="mb-1 text-center font-mono text-lg text-secondary uppercase tracking-wider">{'>'} ACCESS_RESTRICTED.SYS</h1>
        <p className="mb-6 text-center text-xs font-mono text-on-surface-variant">
          ENTER PASSWORD TO {resourceType === 'file' ? 'DOWNLOAD THIS FILE' : 'VIEW THIS PASTE'}.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="password" className="text-label-caps text-secondary">PASSWORD</label>
            <input type="password" id="password" value={password}
              onChange={(e) => setPassword(e.target.value)} disabled={!formEnabled}
              autoComplete="off" autoFocus placeholder="********"
              className="w-full min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface placeholder-on-surface-variant font-mono text-sm focus:border-secondary focus:outline-none focus:shadow-[0_0_10px_rgba(76,215,246,0.2)] disabled:cursor-not-allowed disabled:opacity-60" />
          </div>
          {state.errorMessage && <div role="alert" className="border-2 border-danger-red bg-error-container/20 px-4 py-3"><p className="text-sm font-mono text-error">⚠ ERROR: {state.errorMessage}</p></div>}
          <button type="submit" disabled={submitDisabled}
            className="inline-flex min-h-[44px] w-full items-center justify-center border-2 border-secondary text-secondary px-6 py-2.5 font-mono font-bold text-sm uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black active:translate-y-[2px] disabled:opacity-60">
            {isLoading ? 'PROCESSING...' : state.status === 'rate_limited' ? 'COOLDOWN...' : `> ${submitLabel.toUpperCase()}`}
          </button>
        </form>
      </div>
    </div>
  );
}

export default PasswordGate;
