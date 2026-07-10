'use client';

import { useState } from 'react';
import { submitReport } from '@/lib/api';
import { APIError, REPORT_REASONS } from '@/lib/types';
import type { ReportResourceType } from '@/lib/types';

interface ReportButtonProps {
  resourceType: ReportResourceType;
  slug: string;
  compact?: boolean;
}

type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

export function ReportButton({ resourceType, slug, compact }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0].value);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const close = () => {
    if (state === 'submitting') return;
    setOpen(false);
    setTimeout(() => { setReason(REPORT_REASONS[0].value); setDetails(''); setState('idle'); setMessage(null); }, 150);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === 'submitting') return;
    setState('submitting'); setMessage(null);
    try {
      const res = await submitReport({ resourceType, slug, reason, details });
      setState('done'); setMessage(res.message || 'Report submitted. Thank you.');
    } catch (err) {
      setState('error');
      setMessage(err instanceof APIError ? (err.status === 429 ? 'Too many reports.' : err.message) : 'Failed to send report.');
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Laporkan"
        className={compact
          ? 'inline-flex min-h-[36px] items-center justify-center gap-1.5 border-2 border-surface-variant bg-surface-container-low px-2.5 py-1 text-xs font-mono text-on-surface-variant transition-all hover:border-danger-red hover:text-danger-red active:translate-y-[1px]'
          : 'inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-surface-variant bg-surface-container-lowest px-3.5 py-2 text-xs font-mono text-on-surface-variant uppercase tracking-wider transition-all hover:border-danger-red hover:text-danger-red active:translate-y-[1px]'
        }>
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        REPORT
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={close}>
          <div className="w-full sm:max-w-md border-2 border-surface-variant bg-surface-container-lowest p-5 sm:p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border-b-2 border-surface-variant -mx-5 -mt-5 mb-4 sm:-mx-6 sm:-mt-6">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="w-2 h-2 rounded-full bg-danger-red" />
                <span className="w-2 h-2 rounded-full bg-tertiary" />
                <span className="w-2 h-2 rounded-full bg-success-green" />
              </div>
              <h2 id="report-title" className="text-xs font-mono text-on-surface-variant uppercase tracking-wider ml-2">REPORT_CONTENT</h2>
              <button type="button" onClick={close} aria-label="Tutup" className="ml-auto text-on-surface-variant hover:text-secondary transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {state === 'done' ? (
              <div className="space-y-4">
                <div className="border-2 border-success-green bg-success-green/10 px-4 py-3"><p className="text-sm font-mono text-success-green">✓ {message}</p></div>
                <button type="button" onClick={close}
                  className="inline-flex min-h-[44px] w-full items-center justify-center border-2 border-secondary text-secondary font-mono text-sm uppercase tracking-wider transition-all hover:bg-secondary hover:text-black">
                  [ CLOSE ]</button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-xs font-mono text-on-surface-variant">HELP US KEEP THE PLATFORM SAFE. REPORTS WILL BE REVIEWED BY THE ADMINISTRATORS.</p>

                <div className="space-y-2">
                  <label htmlFor="report-reason" className="text-label-caps text-secondary">REASON</label>
                  <select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={state === 'submitting'}
                    className="w-full min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface font-mono text-sm focus:border-secondary focus:outline-none focus:shadow-[0_0_10px_rgba(76,215,246,0.2)]">
                    {REPORT_REASONS.map((r) => <option key={r.value} value={r.value} className="bg-background">{r.label}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="report-details" className="text-label-caps text-secondary">DETAILS (OPTIONAL)</label>
                  <textarea id="report-details" value={details} onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                    disabled={state === 'submitting'} rows={4} placeholder="DESCRIBE THE ISSUE..."
                    className="w-full resize-y border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 text-sm font-mono text-on-surface placeholder-on-surface-variant focus:border-secondary focus:outline-none focus:shadow-[0_0_10px_rgba(76,215,246,0.2)]" />
                  <p className="text-right text-xs font-mono text-outline">{details.length}/1000</p>
                </div>

                {state === 'error' && message && <div role="alert" className="border-2 border-danger-red bg-error-container/20 px-4 py-3"><p className="text-sm font-mono text-error">⚠ ERROR: {message}</p></div>}

                <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
                  <button type="button" onClick={close} disabled={state === 'submitting'}
                    className="inline-flex min-h-[44px] w-full sm:flex-1 items-center justify-center border-2 border-surface-variant text-on-surface-variant px-4 py-2.5 font-mono text-sm uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary disabled:opacity-60">
                    [ CANCEL ]</button>
                  <button type="submit" disabled={state === 'submitting'}
                    className="inline-flex min-h-[44px] w-full sm:flex-1 items-center justify-center border-2 border-danger-red text-danger-red px-4 py-2.5 font-mono text-sm uppercase tracking-wider transition-all hover:bg-danger-red hover:text-white disabled:opacity-60">
                    {state === 'submitting' ? 'SENDING...' : '> SUBMIT REPORT'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default ReportButton;
