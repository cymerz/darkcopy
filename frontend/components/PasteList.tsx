import Link from 'next/link';
import type { PasteSummary } from '@/lib/types';
import { formatRelativeTime } from '@/lib/utils';

interface PasteListProps {
  pastes: PasteSummary[];
}

export function PasteList({ pastes }: PasteListProps) {
  if (!pastes || pastes.length === 0) {
    return (
      <div className="border-2 border-dashed border-surface-variant bg-surface-container-low px-6 py-12 text-center" role="status">
        <p className="text-on-surface font-mono text-sm uppercase tracking-wider">Belum ada paste publik</p>
        <p className="mt-1 text-xs text-on-surface-variant font-mono">Paste publik terbaru akan muncul di sini.</p>
      </div>
    );
  }

  return (
    <div className="border-2 border-surface-variant bg-surface-container rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low border-b-2 border-surface-variant">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-danger-red" />
          <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
          <span className="w-2.5 h-2.5 rounded-full bg-success-green" />
        </div>
        <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider ml-2">RECENT_PASTES.LOG</span>
      </div>
      <ul className="divide-y-2 divide-surface-variant">
        {pastes.map((paste) => {
          const title = paste.title.trim() || 'Untitled';
          return (
            <li key={paste.slug}>
              <Link
                href={`/${paste.slug}`}
                className="group flex items-center justify-between gap-4 px-4 py-3 min-h-[44px] transition-colors hover:bg-surface-container-low hover:shadow-[inset_0_0_15px_rgba(76,215,246,0.05)]"
              >
                <h2 className="min-w-0 flex-1 truncate font-mono text-sm text-on-surface group-hover:text-secondary transition-colors">
                  {'>'} {title}
                </h2>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="border border-secondary text-secondary px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
                    {paste.language}
                  </span>
                  <time dateTime={paste.created_at} className="text-xs text-on-surface-variant font-mono">
                    {formatRelativeTime(paste.created_at)}
                  </time>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PasteList;
