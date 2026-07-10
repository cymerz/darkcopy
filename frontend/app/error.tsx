'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Root error boundary caught an error:', error); }, [error]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-5 border-2 border-surface-variant bg-surface-container-lowest p-8">
        <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center border-2 border-danger-red text-danger-red">
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <div className="space-y-2">
          <h1 className="text-lg font-mono text-secondary uppercase tracking-wider">ERROR: LOAD FAILED</h1>
          <p className="text-sm font-mono text-on-surface-variant">An error occurred while loading content. Please try again.</p>
        </div>
        <button type="button" onClick={() => reset()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-secondary text-secondary px-5 py-2.5 text-sm font-mono uppercase tracking-wider transition-all hover:bg-secondary hover:text-black">
          {'>'} RETRY
        </button>
      </div>
    </div>
  );
}
