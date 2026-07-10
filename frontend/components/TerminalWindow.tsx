'use client';

interface TerminalWindowProps {
  title: string;
  children: React.ReactNode;
  variant?: 'default' | 'code' | 'form';
  className?: string;
  actions?: React.ReactNode;
}

export function TerminalWindow({
  title,
  children,
  variant = 'default',
  className = '',
  actions,
}: TerminalWindowProps) {
  const bgClass =
    variant === 'code'
      ? 'bg-terminal-bg'
      : variant === 'form'
        ? 'bg-surface-container-lowest'
        : 'bg-surface-container';

  return (
    <div className={`border-2 border-surface-variant rounded-lg overflow-hidden ${bgClass} ${className}`}>
      {/* Terminal header with 3-dot controls */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-container-low border-b-2 border-surface-variant">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="w-3 h-3 rounded-full bg-danger-red" />
          <span className="w-3 h-3 rounded-full bg-tertiary" />
          <span className="w-3 h-3 rounded-full bg-success-green" />
        </div>
        <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider ml-2">
          {title}
        </span>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {/* Content */}
      <div className={variant === 'code' ? '' : 'p-4 md:p-6'}>
        {children}
      </div>
    </div>
  );
}
