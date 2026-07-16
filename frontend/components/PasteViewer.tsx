'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { CopyButton } from '@/components/CopyButton';
import { CountdownTimer } from '@/components/CountdownTimer';
import { ReportButton } from '@/components/ReportButton';
import { forkPaste, getPaste } from '@/lib/api';
import { APIError } from '@/lib/types';
import type { PasteViewResponse } from '@/lib/types';
import { formatRelativeTime, getFileExtension } from '@/lib/utils';
import { decryptText } from '@/lib/crypto';

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

  const [revealed, setRevealed] = useState(!paste.burn_after_read || !!paste.content);
  const [revealing, setRevealing] = useState(false);
  const [contentState, setContentState] = useState(paste.content);
  
  const [decryptionKey, setDecryptionKey] = useState('');
  const [customKeyInput, setCustomKeyInput] = useState('');
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);

  const router = useRouter();
  const [isForking, setIsForking] = useState(false);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/#key=([a-zA-Z0-9_-]+)/);
      if (match) {
        setDecryptionKey(match[1]);
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (paste.is_encrypted && decryptionKey && contentState) {
      decryptText(contentState, decryptionKey)
        .then((decrypted) => {
          setDecryptedContent(decrypted);
          setDecryptionError(null);
        })
        .catch((err) => {
          console.error(err);
          setDecryptedContent(null);
          setDecryptionError('Failed to decrypt. The key might be incorrect.');
        });
    }
  }, [paste.is_encrypted, decryptionKey, contentState]);

  const handleManualDecrypt = (e: React.FormEvent) => {
    e.preventDefault();
    if (customKeyInput.trim()) {
      setDecryptionKey(customKeyInput.trim());
    }
  };

  const handleReveal = async () => {
    if (revealing) return;
    setRevealing(true);
    try {
      const fullPaste = await getPaste(paste.slug, false);
      setContentState(fullPaste.content);
      setRevealed(true);
    } catch (err) {
      alert(err instanceof APIError ? err.message : 'Failed to retrieve paste content.');
    } finally {
      setRevealing(false);
    }
  };

  const handleFork = async () => {
    if (isForking) return;
    setIsForking(true);
    try {
      const data = await forkPaste(paste.slug);
      sessionStorage.setItem('fork_data', JSON.stringify(data));
      router.push('/new?fork=1');
    } catch (err) {
      const msg = err instanceof APIError ? err.message : 'Failed to load paste for forking';
      alert(msg);
      setIsForking(false);
    }
  };

  const displayContent = decryptedContent ?? contentState;
  const lineCount = Math.max(1, displayContent.split('\n').length);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  const handleDownload = () => {
    const extension = getFileExtension(paste.language);
    const filename = buildDownloadFilename(paste.title, paste.slug, extension);
    const blob = new Blob([displayContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  // 1. Reveal Landing for Burn-After-Read
  if (!revealed) {
    return (
      <div className="border-2 border-tertiary bg-tertiary/5 p-6 rounded-lg text-center space-y-6 max-w-xl mx-auto my-12">
        <div className="flex justify-center">
          <span className="w-16 h-16 rounded-full bg-tertiary/10 flex items-center justify-center text-tertiary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </span>
        </div>
        <div className="space-y-2">
          <h2 className="font-mono text-lg text-tertiary uppercase tracking-wider">{'>'} WARNING: BURN-AFTER-READ</h2>
          <p className="font-mono text-sm text-on-surface-variant leading-relaxed">
            This paste is set to self-destruct once viewed. 
            Clicking the button below will retrieve the content, which deletes it permanently from the server.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReveal}
          disabled={revealing}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-tertiary text-tertiary px-8 py-3 font-mono font-bold uppercase tracking-wider transition-all duration-200 hover:bg-tertiary hover:text-black active:translate-y-[2px] disabled:opacity-55 disabled:cursor-not-allowed"
        >
          {revealing ? 'REVEALING...' : 'REVEAL PASTE'}
        </button>
      </div>
    );
  }

  // 2. Decryption Prompt for E2EE
  if (paste.is_encrypted && !decryptedContent) {
    return (
      <div className="border-2 border-secondary bg-secondary/5 p-6 rounded-lg text-center space-y-6 max-w-xl mx-auto my-12">
        <div className="flex justify-center">
          <span className="w-16 h-16 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </span>
        </div>
        <div className="space-y-2">
          <h2 className="font-mono text-lg text-secondary uppercase tracking-wider">{'>'} PASTE ENCRYPTED (E2EE)</h2>
          <p className="font-mono text-sm text-on-surface-variant leading-relaxed">
            The encryption key was not found in the URL. Please enter the decryption key below to decrypt this paste.
          </p>
        </div>
        <form onSubmit={handleManualDecrypt} className="space-y-4">
          <input
            type="text"
            placeholder="Enter Decryption Key"
            value={customKeyInput}
            onChange={(e) => setCustomKeyInput(e.target.value)}
            className="w-full max-w-xs min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface placeholder-on-surface-variant font-mono text-sm focus:border-secondary focus:outline-none"
          />
          <div>
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-secondary text-secondary px-8 py-3 font-mono font-bold uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black active:translate-y-[2px]"
            >
              DECRYPT PASTE
            </button>
          </div>
        </form>
        {decryptionError && (
          <div role="alert" className="border-2 border-danger-red bg-error-container/20 px-4 py-3 max-w-xs mx-auto">
            <p className="text-sm font-mono text-error">⚠ {decryptionError}</p>
          </div>
        )}
      </div>
    );
  }

  // 3. Normal Viewer State
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
        <CopyButton content={displayContent} />
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
        <button type="button" onClick={handleFork} disabled={isForking}
          className="inline-flex min-h-[36px] items-center justify-center gap-1.5 border-2 border-surface-variant bg-surface-container-low px-3 py-1.5 text-xs font-mono text-on-surface-variant transition-all hover:border-secondary hover:text-secondary active:translate-y-[1px] disabled:opacity-60">
          {isForking ? 'LOADING...' : 'FORK'}
        </button>
        <div className="mx-1 h-5 w-px bg-surface-variant" aria-hidden="true" />
        {!paste.is_encrypted && (
          <button type="button" onClick={() => setShowHighlighting((v) => !v)}
            aria-pressed={showHighlighting}
            className={`inline-flex min-h-[36px] items-center justify-center px-3 py-1.5 text-xs font-mono uppercase tracking-wider border-2 transition-all ${
              showHighlighting
                ? 'border-secondary text-secondary bg-secondary/10'
                : 'border-surface-variant text-on-surface-variant hover:border-secondary hover:text-secondary'
            }`}>
            {showHighlighting ? 'HIGHLIGHTED' : 'PLAIN TEXT'}
          </button>
        )}
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
            {showHighlighting && !paste.is_encrypted ? (
              <div className="darkcopy-code" dangerouslySetInnerHTML={{ __html: themeHighlight(DOMPurify.sanitize(paste.highlighted_html)) }} />
            ) : (
              <pre className="whitespace-pre">{displayContent}</pre>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default PasteViewer;
