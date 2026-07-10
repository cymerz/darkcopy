import Link from 'next/link';
import type { ReactNode } from 'react';

export interface ErrorDisplayAction {
  label: string;
  href: string;
}

export interface ErrorDisplayProps {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: ErrorDisplayAction;
}

function DefaultAlertIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-7 w-7">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function ErrorDisplay({ title, message, icon, action }: ErrorDisplayProps) {
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-5 border-2 border-surface-variant bg-surface-container-lowest p-8">
        <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center border-2 border-danger-red text-danger-red">
          {icon ?? <DefaultAlertIcon />}
        </span>
        <div className="space-y-2">
          <h1 className="text-lg font-mono text-secondary uppercase tracking-wider">{title}</h1>
          {message && <p className="text-sm font-mono text-on-surface-variant">{message}</p>}
        </div>
        {action && (
          <Link href={action.href}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-secondary text-secondary px-5 py-2.5 text-sm font-mono uppercase tracking-wider transition-all hover:bg-secondary hover:text-black">
            {'>'} {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

export default ErrorDisplay;
