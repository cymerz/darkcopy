import Link from 'next/link';
import type { FileSummary } from '@/lib/types';
import { formatRelativeTime, formatFileSize } from '@/lib/utils';

interface FileListProps {
  files: FileSummary[];
}

const getFileCategory = (mime: string): string => {
  if (!mime) return 'FILE';
  const parts = mime.split('/');
  if (parts.length < 2) return 'FILE';
  const sub = parts[1].toUpperCase();
  if (sub.includes('PDF')) return 'PDF';
  if (sub.includes('PNG') || sub.includes('JPEG') || sub.includes('JPG') || sub.includes('GIF') || sub.includes('WEBP')) return 'IMAGE';
  if (sub.includes('ZIP') || sub.includes('RAR') || sub.includes('TAR') || sub.includes('GZ') || sub.includes('7Z')) return 'ARCHIVE';
  if (sub.includes('JSON') || sub.includes('XML') || sub.includes('YAML') || sub.includes('JAVASCRIPT') || sub.includes('TYPESCRIPT')) return 'CODE';
  if (parts[0] === 'text') return 'TEXT';
  return sub.length > 5 ? sub.substring(0, 5) : sub;
};

export function FileList({ files }: FileListProps) {
  if (!files || files.length === 0) {
    return (
      <div className="border-2 border-dashed border-surface-variant bg-surface-container-low px-6 py-12 text-center" role="status">
        <p className="text-on-surface font-mono text-sm uppercase tracking-wider">Belum ada file publik</p>
        <p className="mt-1 text-xs text-on-surface-variant font-mono">File publik terbaru akan muncul di sini.</p>
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
        <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider ml-2">RECENT_FILES.LOG</span>
      </div>
      <ul className="divide-y-2 divide-surface-variant">
        {files.map((file) => {
          const displayName = file.filename.trim() || 'Unnamed File';
          const fileCategory = getFileCategory(file.mime_type);
          return (
            <li key={file.slug}>
              <Link
                href={`/f/${file.slug}`}
                className="group flex items-center justify-between gap-4 px-4 py-3 min-h-[44px] transition-colors hover:bg-surface-container-low hover:shadow-[inset_0_0_15px_rgba(76,215,246,0.05)]"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-surface-variant text-on-surface-variant group-hover:border-secondary group-hover:text-secondary transition-colors text-xs font-mono">
                    FILE
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-mono text-sm text-on-surface group-hover:text-secondary transition-colors">
                      {'>'} {displayName}
                    </h2>
                    <p className="text-xs text-on-surface-variant font-mono mt-0.5">
                      {formatFileSize(file.size_bytes)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="border border-secondary text-secondary px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
                    {fileCategory}
                  </span>
                  <time dateTime={file.created_at} className="text-xs text-on-surface-variant font-mono">
                    {formatRelativeTime(file.created_at)}
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

export default FileList;
