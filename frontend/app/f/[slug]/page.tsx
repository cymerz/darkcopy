import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getFile } from '@/lib/api';
import { APIError } from '@/lib/types';
import { formatFileSize } from '@/lib/utils';
import { ReportButton } from '@/components/ReportButton';
import { GenerateLinkButton } from '@/components/GenerateLinkButton';
import { CountdownTimer } from '@/components/CountdownTimer';

export const dynamic = 'force-dynamic';

interface FileMetadata {
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  downloads: number;
  md5: string | null;
  sha256: string | null;
  remainingSeconds: number | null;
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const extended = header.match(/filename\*\s*=\s*[^']*''([^;]+)/i);
  if (extended?.[1]) { try { return decodeURIComponent(extended[1].trim()); } catch {} }
  const quoted = header.match(/filename\s*=\s*"([^"]*)"/i);
  if (quoted?.[1]) return quoted[1];
  const bare = header.match(/filename\s*=\s*([^;]+)/i);
  if (bare?.[1]) return bare[1].trim();
  return null;
}

function readFileMetadata(response: Response, slug: string): FileMetadata {
  const filename = parseContentDispositionFilename(response.headers.get('content-disposition')) ?? slug;
  const mimeType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');
  const parsedSize = contentLength ? Number.parseInt(contentLength, 10) : NaN;
  const sizeBytes = Number.isFinite(parsedSize) ? parsedSize : null;
  const downloadsHeader = response.headers.get('x-downloads-count');
  const downloads = downloadsHeader ? Number.parseInt(downloadsHeader, 10) : 0;
  const md5 = response.headers.get('x-file-md5');
  const sha256 = response.headers.get('x-file-sha256');
  const expiresAtHeader = response.headers.get('x-file-expires-at');
  let remainingSeconds: number | null = null;
  if (expiresAtHeader) {
    const expiresAt = new Date(expiresAtHeader);
    const secs = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    remainingSeconds = Number.isFinite(secs) ? secs : null;
  }
  return { filename, mimeType, sizeBytes, downloads, md5, sha256, remainingSeconds };
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

function ExpiredFile() {
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-5 border-2 border-surface-variant bg-surface-container-lowest p-8">
        <span aria-hidden="true" className="text-4xl text-tertiary font-mono">[!]</span>
        <div className="space-y-2">
          <h1 className="text-xl font-mono text-secondary uppercase tracking-wider">FILE EXPIRED</h1>
          <p className="text-sm font-mono text-on-surface-variant">File ini telah kadaluarsa dan dihapus otomatis oleh sistem, so it is no longer available untuk diunduh.</p>
        </div>
        <Link href="/" className="inline-flex min-h-[44px] items-center justify-center border-2 border-secondary text-secondary px-5 py-2.5 text-sm font-mono uppercase tracking-wider transition-all hover:bg-secondary hover:text-black">
          {'>'} BACK TO HOME
        </Link>
      </div>
    </div>
  );
}

function getFileTypeCategory(filename: string, mimeType: string | null): 'image' | 'video' | 'audio' | null {
  const mime = mimeType?.toLowerCase() || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'wmv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'];
  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  return null;
}

function FileInfo({ slug, metadata }: { slug: string; metadata: FileMetadata }) {
  const { filename, mimeType, sizeBytes, downloads } = metadata;
  const downloadHref = `/api/f/${slug}/direct`;
  const previewHref = `/api/f/${slug}/direct?preview=true`;
  const category = getFileTypeCategory(filename, mimeType);

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
              {'>'} FILE_INSPECTOR.SYS — {filename}
            </h1>
          </div>
          <span className="text-label-caps text-outline">STATUS: READY</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Main preview area — 8 cols */}
        <div className="lg:col-span-8 space-y-4">
          {category === 'image' && (
            <div className="border-2 border-surface-variant bg-surface-container-lowest p-2 flex justify-center items-center group">
              <img src={previewHref} alt={filename}
                className="relative max-h-[400px] w-auto max-w-full object-contain transition-all duration-500 grayscale hover:grayscale-0 group-hover:shadow-[0_0_30px_rgba(76,215,246,0.2)]" loading="lazy" />
            </div>
          )}
          {category === 'video' && (
            <div className="border-2 border-surface-variant bg-terminal-bg p-2">
              <video src={previewHref} controls className="relative w-full max-h-[350px] object-contain" preload="metadata">
                Your browser does not support video preview.
              </video>
            </div>
          )}
          {category === 'audio' && (
            <div className="border-2 border-surface-variant bg-surface-container-lowest p-4">
              <audio src={previewHref} controls className="relative w-full">
                Your browser does not support audio preview.
              </audio>
            </div>
          )}

          {/* Info cards inline for small screens */}
          <div className="grid grid-cols-2 gap-3">
            <div className="border-2 border-surface-variant bg-surface-container-lowest p-3">
              <p className="text-label-caps text-outline">SIZE</p>
              <p className="text-sm font-mono text-on-surface mt-1">{sizeBytes != null ? formatFileSize(sizeBytes) : '—'}</p>
            </div>
            <div className="border-2 border-surface-variant bg-surface-container-lowest p-3">
              <p className="text-label-caps text-outline">TYPE</p>
              <p className="text-sm font-mono text-on-surface mt-1">{mimeType ? mimeType.split('/')[1]?.toUpperCase() || mimeType : '—'}</p>
            </div>
            <div className="border-2 border-surface-variant bg-surface-container-lowest p-3">
              <p className="text-label-caps text-outline">DOWNLOADS</p>
              <p className="text-sm font-mono text-on-surface mt-1">{downloads}</p>
            </div>
            <div className="border-2 border-surface-variant bg-surface-container-lowest p-3">
              <p className="text-label-caps text-outline">STATUS</p>
              <p className="text-sm font-mono text-secondary mt-1">RENDER_SUCCESS</p>
            </div>
          </div>

          {/* Integrity hashes */}
          <div className="border-2 border-surface-variant bg-surface-container-lowest p-3">
            <p className="text-label-caps text-outline mb-1">INTEGRITY_CHECK</p>
            <p className="text-xs font-mono text-on-surface-variant break-all">MD5: <span className="text-outline">{metadata.md5 || '—'}</span></p>
            <p className="text-xs font-mono text-on-surface-variant break-all">SHA256: <span className="text-outline">{metadata.sha256 || '—'}</span></p>
          </div>
        </div>

        {/* Operations sidebar — 4 cols */}
        <div className="lg:col-span-4 space-y-4">
          <div className="border-2 border-surface-variant bg-surface-container-lowest">
            <div className="px-4 py-2 bg-surface-container-low border-b-2 border-surface-variant">
              <span className="text-label-caps text-secondary">OPERATIONS</span>
            </div>
            <div className="p-4 space-y-3">
              <a href={downloadHref} download={filename}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 border-2 border-secondary text-secondary font-mono font-bold text-sm uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black hover:shadow-[0_0_20px_rgba(76,215,246,0.4)] active:translate-y-[2px]">
                {'>'} DOWNLOAD FILE
              </a>
              <GenerateLinkButton slug={slug} />
              <button type="button" disabled
                className="flex min-h-[44px] w-full items-center justify-center gap-2 border-2 border-danger-red/40 text-danger-red/40 font-mono text-sm uppercase tracking-wider cursor-not-allowed">
                [ DESTROY DATA ] — ADMIN ONLY
              </button>
            </div>
          </div>

          {/* Time Remaining Badge */}
          <div className="border-2 border-surface-variant bg-surface-container-lowest p-4">
            <p className="text-label-caps text-outline mb-2">TIME_REMAINING</p>
            {metadata.remainingSeconds != null ? (
              <div className="flex">
                <CountdownTimer remainingSeconds={metadata.remainingSeconds} />
              </div>
            ) : (
              <p className="text-xs font-mono text-success-green">TTL: NEVER</p>
            )}
          </div>

          {/* Report */}
          <div className="flex justify-center">
            <ReportButton resourceType="file" slug={slug} />
          </div>
        </div>
      </div>
    </article>
  );
}

export default async function FileViewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let response: Response;
  try {
    response = await getFile(slug);
  } catch (error) {
    console.error(`Failed to load file "${slug}":`, error);
    throw error;
  }

  if (response.status === 404) { discardBody(response); notFound(); }
  if (response.status === 410) { discardBody(response); return <ExpiredFile />; }
  if (response.status === 401) { await response.json().catch(() => null); redirect(`/f/${slug}/unlock`); }
  if (response.status === 200) {
    const metadata = readFileMetadata(response, slug);
    discardBody(response);
    return <FileInfo slug={slug} metadata={metadata} />;
  }

  const errorBody = await response.json().catch(() => null);
  throw new APIError(
    errorBody?.error ?? `Failed to load file (HTTP ${response.status})`,
    errorBody?.code ?? 'UNKNOWN',
    response.status,
  );
}
