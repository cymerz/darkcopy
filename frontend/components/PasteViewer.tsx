'use client';

import { useState } from 'react';
import Link from 'next/link';
import DOMPurify from 'isomorphic-dompurify';
import { CopyButton } from '@/components/CopyButton';
import { CountdownTimer } from '@/components/CountdownTimer';
import { ReportButton } from '@/components/ReportButton';
import type { PasteViewResponse } from '@/lib/types';
import { formatRelativeTime, getFileExtension } from '@/lib/utils';

interface PasteViewerProps {
  paste: PasteViewResponse;
}

function buildDownloadFilename(title: string, slug: string, extension: string): string {
  const base = title.trim() || `paste-${slug}`;
  const sanitized = base.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/^[._]+|[._]+$/g, '');
  return `${sanitized || `paste-${slug}`}${extension}`;
}

// Map Chroma (dracula-like) hex colors to semantic token classes.
// The result is colored via CSS variables in globals.css so light/dark mode work.
const CHROMA_TOKENS: Record<string, string> = {
  '#ff79c6': 'tok-kw',
  '#f1fa8c': 'tok-str',
  '#6272a4': 'tok-com',
  '#50fa7b': 'tok-fn',
  '#bd93f9': 'tok-lit',
  '#8be9fd': 'tok-type',
  '#ffb86c': 'tok-num',
  '#f8f8f2': 'tok-base',
  '#44475a': 'tok-punct',
};

function themeHighlight(html: string): string {
  return html.replace(/color:\s*(#[0-9a-fA-F]{3,8})/g, (_m, hex) => {
    const cls = CHROMA_TOKENS[hex.toLowerCase()];
    return cls ? `color: rgb(var(--${cls}))` : 'color: inherit';
  });
}

export function PasteViewer({ paste }: PasteViewerProps) {
  const title = paste.title.trim() || 'Untitled';
  const [showHighlighting, setShowHighlighting] = useState(true);

  const lineCount = Math.max(1, paste.content.split('\n').length);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  const handleDownload = () => {
    const extension = getFileExtension(paste.language);
    const filename = buildDownloadFilename(paste.title, paste.slug, extension);
    const blob = new Blob([paste.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <article className="space-y-6">
      {/* Terminal-style header */}
      <div className="border-2 border-secondary bg-secondary/5 px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-success-green animate-terminal-blink" />
            </div>
            <h1 className="font-mono text-sm text-secondary uppercase tracking-wider">
              {'>'} PREVIEW_PASTE.EXE — {title}
            </h1>
          </div>
          <span className="text-label-caps text-outline">STATUS: ACTIVE</span>
        </div>
      </div>

      {/* Metadata bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono text-on-surface-variant border-2 border-surface-variant bg-surface-container-low px-4 py-2">
        <span className="border border-secondary text-secondary px-2 py-0.5">{paste.language}</span>
        <time dateTime={paste.created_at}>CREATED: {formatRelativeTime(paste.created_at)}</time>
        {paste.remaining_seconds != null ? (
          <CountdownTimer remainingSeconds={paste.remaining_seconds} />
        ) : paste.expires_at ? (
          <span>EXPIRES: {formatRelativeTime(paste.expires_at)}</span>
        ) : (
          <span>TTL: NEVER</span>
        )}
        <span className="text-outline">|</span>
        <span>VIEWS: {paste.views ?? 0}</span>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 border-2 border-surface-variant bg-surface-container-lowest p-2">
        <CopyButton content={paste.content} />
        <button type="button" onClick={handleDownload}
          className="inline-flex min-h-[36px] items-center justify-center gap-1.5 border-2 border-surface-variant bg-surface-container-low px-3 py-1.5 text-xs font-mono text-on-surface-variant transition-all hover:border-secondary hover:text-secondary active:translate-y-[1px]">
          DOWNLOAD
        </button>
        <a href={`/api/raw/${paste.slug}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-[36px] items-center justify-center gap-1.5 border-2 border-surface-variant bg-surface-container-low px-3 py-1.5 text-xs font-mono text-on-surface-variant transition-all hover:border-secondary hover:text-secondary">
          RAW
        </a>
        <Link href={`/qr?path=${encodeURIComponent(`/${paste.slug}`)}`}
          className="inline-flex min-h-[36px] items-center justify-center gap-1.5 border-2 border-surface-variant bg-surface-container-low px-3 py-1.5 text-xs font-mono text-on-surface-variant transition-all hover:border-secondary hover:text-secondary">
          QR CODE
        </Link>
        <div className="mx-1 h-5 w-px bg-surface-variant" aria-hidden="true" />
        <button type="button" onClick={() => setShowHighlighting((v) => !v)}
          aria-pressed={showHighlighting}
          className={`inline-flex min-h-[36px] items-center justify-center px-3 py-1.5 text-xs font-mono uppercase tracking-wider border-2 transition-all ${
            showHighlighting
              ? 'border-secondary text-secondary bg-secondary/10'
              : 'border-surface-variant text-on-surface-variant hover:border-secondary hover:text-secondary'
          }`}>
          {showHighlighting ? 'HIGHLIGHTED' : 'PLAIN TEXT'}
        </button>
        <div className="sm:ml-auto">
          <ReportButton resourceType="paste" slug={paste.slug} compact />
        </div>
      </div>

      {/* Terminal window with code */}
      <div className="border-2 border-surface-variant rounded-lg overflow-hidden bg-terminal-bg">
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low border-b-2 border-surface-variant">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-danger-red" />
            <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
            <span className="w-2.5 h-2.5 rounded-full bg-success-green" />
          </div>
          <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider ml-2">{title.replace(/\s+/g, '_').toLowerCase()}.txt</span>
          <span className="ml-auto text-xs text-on-surface-variant font-mono">{paste.language}</span>
        </div>
        <div className="flex">
          <div aria-hidden="true" className="shrink-0 select-none border-r-2 border-surface-variant px-3 py-4 text-right font-mono text-xs leading-6 text-outline bg-terminal-bg">
            {lineNumbers.map((n) => <div key={n}>{n}</div>)}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto px-4 py-4 font-mono text-sm leading-6 text-on-surface">
            {showHighlighting ? (
              <div className="darkcopy-code" dangerouslySetInnerHTML={{ __html: themeHighlight(DOMPurify.sanitize(paste.highlighted_html)) }} />
            ) : (
              <pre className="whitespace-pre">{paste.content}</pre>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default PasteViewer;
