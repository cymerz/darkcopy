'use client';

import { useEffect, useRef, useState } from 'react';

interface CopyButtonProps {
  content: string;
}

type CopyState = 'idle' | 'copied' | 'error';
const FEEDBACK_DURATION_MS = 2000;

export function CopyButton({ content }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const scheduleReset = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => { setState('idle'); timeoutRef.current = null; }, FEEDBACK_DURATION_MS);
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(content); setState('copied'); } catch { setState('error'); }
    scheduleReset();
  };

  const stateStyles = state === 'copied'
    ? 'border-success-green text-success-green bg-success-green/10'
    : state === 'error'
      ? 'border-danger-red text-danger-red bg-danger-red/10'
      : 'border-surface-variant text-on-surface-variant hover:border-secondary hover:text-secondary';

  const label = state === 'copied' ? 'COPIED' : state === 'error' ? 'ERROR' : 'COPY';

  return (
    <button type="button" onClick={handleCopy}
      aria-live="polite" aria-label={label}
      className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 border-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-all active:translate-y-[1px] ${stateStyles}`}>
      {state === 'copied' ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>
      ) : state === 'error' ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
      {label}
    </button>
  );
}

export default CopyButton;
