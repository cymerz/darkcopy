import type { HTMLAttributes } from 'react';

export function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`animate-pulse bg-surface-variant rounded ${className}`.trim()} {...props} />;
}

export function PasteListSkeleton() {
  const titleWidths = ['w-1/2', 'w-3/5', 'w-2/5', 'w-2/3', 'w-1/3'];
  return (
    <div className="space-y-2" role="status" aria-label="Loading paste list">
      {titleWidths.map((width, idx) => (
        <div key={idx} className="border-2 border-surface-variant bg-surface-container-lowest p-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className={`h-5 ${width}`} />
            <div className="flex items-center gap-3 shrink-0">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function PasteViewSkeleton() {
  const lineWidths = ['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3', 'w-11/12', 'w-1/3', 'w-3/5', 'w-4/5', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/4', 'w-3/4', 'w-2/5'];
  return (
    <div className="space-y-4" role="status" aria-label="Loading paste">
      <div className="border-2 border-surface-variant bg-surface-container-lowest p-4">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-7 w-24" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="border-2 border-surface-variant bg-surface-container-lowest p-4">
        <div className="space-y-2 font-mono">
          {lineWidths.map((width, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <Skeleton className="h-4 w-6 shrink-0" />
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="border-2 border-surface-variant bg-surface-container-lowest p-6 space-y-5" role="status" aria-label="Loading form">
      <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-10 w-full" /></div>
      <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-10 w-full" /></div>
        <div className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-10 w-full" /></div>
      </div>
      <Skeleton className="h-10 w-32" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}
