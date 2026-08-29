'use client';

import React, { useState, useCallback } from 'react';


// The domain shown in the API documentation examples.
const API_DOMAIN = 'https://beta.qzz.io';

/* ────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────── */

interface Param {
  name: string;
  type: string;
  required: boolean;
  desc: string;
}

interface Example {
  label: string;
  code: string;
}

interface Endpoint {
  id: string;
  method: 'GET' | 'POST' | 'HEAD';
  path: string;
  title: string;
  desc: string;
  headers?: Param[];
  params?: Param[];
  requestBody?: string;
  responseBody?: string;
  examples: Example[];
}

/* ────────────────────────────────────────────────────────────────────
   Data
   ──────────────────────────────────────────────────────────────────── */

const ENDPOINTS: Endpoint[] = [
  {
    id: 'create-paste',
    method: 'POST',
    path: '/api/new',
    title: 'Create a Paste',
    desc: 'Create a new paste. Standard API clients receive a JSON response, while CLI clients (like curl or wget) receive the absolute URL as plain text by default.',
    headers: [
      { name: 'Content-Type', type: 'string', required: false, desc: 'application/x-www-form-urlencoded, multipart/form-data, or text/plain for raw uploads.' },
      { name: 'Accept', type: 'string', required: false, desc: 'Set to application/json for structured JSON. CLI clients get plain-text URLs by default.' },
    ],
    params: [
      { name: 'content', type: 'string', required: true, desc: 'The text content of the paste.' },
      { name: 'title', type: 'string', required: false, desc: 'Optional title for the paste.' },
      { name: 'language', type: 'string', required: false, desc: 'Syntax highlighting language (go, python, javascript, etc.).' },
      { name: 'expires_in', type: 'integer', required: false, desc: 'Expiry time in minutes. 0 = never expires.' },
      { name: 'visibility', type: 'string', required: false, desc: '"public" (default), "unlisted", or "password_protected".' },
      { name: 'password', type: 'string', required: false, desc: 'Required when visibility = password_protected.' },
      { name: 'burn_after_read', type: 'boolean', required: false, desc: 'Delete paste after first view.' },
      { name: 'is_encrypted', type: 'boolean', required: false, desc: 'Mark payload as client-side encrypted (E2EE).' },
    ],
    responseBody: `// For JSON/API clients (or with Accept: application/json header):
{
  "slug": "abc12345",
  "url": "/abc12345",
  "full_url": "${API_DOMAIN}/abc12345"
}

// For CLI clients (curl/wget) by default:
${API_DOMAIN}/abc12345`,
    examples: [
      {
        label: 'Pipe from terminal',
        code: `cat server.log | curl --data-binary @- ${API_DOMAIN}/api/new`,
      },
      {
        label: 'Form data with options',
        code: `curl -d "content=Hello&title=Demo&language=go&expires_in=60" \\
     -H "Accept: application/json" \\
     ${API_DOMAIN}/api/new`,
      },
      {
        label: 'JavaScript fetch',
        code: `const res = await fetch('${API_DOMAIN}/api/new', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  },
  body: new URLSearchParams({
    content: 'Hello from JS',
    language: 'javascript',
    expires_in: '1440',
  }),
});
const { slug, url } = await res.json();`,
      },
    ],
  },
  {
    id: 'get-paste',
    method: 'GET',
    path: '/api/{slug}',
    title: 'Retrieve a Paste',
    desc: 'Fetch metadata and content for a paste. For E2EE pastes the ciphertext is returned and must be decrypted client-side.',
    params: [
      { name: 'peek', type: 'boolean', required: false, desc: 'Set to true to fetch metadata without triggering burn-after-read deletion.' },
    ],
    responseBody: `{
  "slug": "abc12345",
  "title": "My Paste",
  "content": "Hello World",
  "highlighted_html": "<span>Hello World</span>",
  "language": "plaintext",
  "visibility": "public",
  "views": 4,
  "is_encrypted": false,
  "burn_after_read": false,
  "remaining_seconds": 86400,
  "created_at": "2026-07-16T08:00:00Z",
  "expires_at": "2026-07-17T08:00:00Z"
}`,
    examples: [
      { label: 'cURL', code: `curl -H "Accept: application/json" ${API_DOMAIN}/api/abc12345` },
      { label: 'Safe peek (no burn)', code: `curl "${API_DOMAIN}/api/abc12345?peek=true"` },
    ],
  },
  {
    id: 'raw-paste',
    method: 'GET',
    path: '/api/raw/{slug}',
    title: 'Raw Paste Content',
    desc: 'Returns the paste content as plain text — ideal for piping into other commands or downloading.',
    responseBody: 'Hello World',
    examples: [
      { label: 'Download to file', code: `curl -o output.txt ${API_DOMAIN}/api/raw/abc12345` },
    ],
  },
  {
    id: 'unlock-paste',
    method: 'POST',
    path: '/api/{slug}/unlock',
    title: 'Unlock Protected Paste',
    desc: 'Submit a password to unlock and retrieve the contents of a password-protected paste.',
    params: [
      { name: 'password', type: 'string', required: true, desc: 'The paste password.' },
    ],
    requestBody: 'password=mySecretPassword',
    responseBody: `{
  "slug": "abc12345",
  "title": "My Paste",
  "content": "Secret content revealed!",
  "highlighted_html": "<span>Secret content revealed!</span>",
  "language": "plaintext",
  "visibility": "password_protected",
  "views": 1,
  "is_encrypted": false,
  "burn_after_read": false,
  "remaining_seconds": null,
  "created_at": "2026-07-16T08:00:00Z",
  "expires_at": null
}`,
    examples: [
      { label: 'cURL', code: `curl -d "password=mySecretPassword" ${API_DOMAIN}/api/abc12345/unlock` },
    ],
  },
  {
    id: 'upload-file',
    method: 'POST',
    path: '/api/upload',
    title: 'Upload a File',
    desc: 'Upload a file via multipart form (server proxy). When use_direct_upload is enabled, use the 3-step direct S3 flow: POST /api/upload/presign → PUT to S3 → POST /api/upload/register. CLI clients receive a plain-text URL; API clients receive JSON with slug, URL, and MD5 hash.',
    headers: [
      { name: 'Content-Type', type: 'string', required: true, desc: 'multipart/form-data (server proxy) or application/json (direct S3 presign/register).' },
    ],
    params: [
      { name: 'file', type: 'binary', required: true, desc: 'The file to upload (server proxy only).' },
      { name: 'visibility', type: 'string', required: false, desc: '"public", "unlisted", or "password_protected".' },
      { name: 'password', type: 'string', required: false, desc: 'Required for password_protected visibility.' },
      { name: 'expires_in', type: 'string', required: false, desc: 'Duration in minutes (e.g. "60") or Go duration (e.g. "1h").' },
    ],
    responseBody: `// Server proxy — CLI clients (curl/wget) by default:
${API_DOMAIN}/f/file456

// Server proxy — JSON/API clients (Accept: application/json):
{
  "success": true,
  "slug": "file456",
  "url": "/f/file456",
  "full_url": "${API_DOMAIN}/f/file456",
  "md5_hash": "d41d8cd98f00b204e9800998ecf8427e"
}

// Direct S3 — Step 1: POST /api/upload/presign response:
{
  "slug": "file456",
  "storage_key": "uploads/file456/screenshot.png",
  "upload_url": "https://s3.example.com/uploads/file456/screenshot.png?X-Amz-..."
}

// Direct S3 — Step 3: POST /api/upload/register response:
{
  "success": true,
  "slug": "file456",
  "url": "/f/file456",
  "full_url": "${API_DOMAIN}/f/file456"
}`,
    examples: [
      { label: 'Server proxy (cURL)', code: `curl -F "file=@screenshot.png" -F "expires_in=60" ${API_DOMAIN}/api/upload` },
      { label: 'Direct S3 — Step 1: Presign', code: `curl -s -X POST ${API_DOMAIN}/api/upload/presign \\
  -H "Content-Type: application/json" \\
  -d '{"filename":"screenshot.png","size_bytes":2048,"mime_type":"image/png","visibility":"public","expires_in":"60"}'` },
      { label: 'Direct S3 — Step 2: Upload to S3', code: `curl -X PUT --data-binary @screenshot.png "$UPLOAD_URL"` },
      { label: 'Direct S3 — Step 3: Register', code: `curl -s -X POST ${API_DOMAIN}/api/upload/register \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"file456","filename":"screenshot.png","size_bytes":2048,"mime_type":"image/png","storage_key":"uploads/file456/screenshot.png","visibility":"public","expires_in":"60","md5_hash":"d41d8cd98f00b204e9800998ecf8427e"}'` },
    ],
  },
  {
    id: 'direct-download',
    method: 'GET',
    path: '/api/f/{slug}/direct',
    title: 'Direct File Download',
    desc: 'Redirects to a pre-signed S3 URL for direct download, bypassing the server proxy.',
    params: [
      { name: 'preview', type: 'boolean', required: false, desc: 'Set to true for inline rendering (images, videos) instead of attachment download.' },
    ],
    examples: [
      { label: 'Download', code: `curl -L -o file.png ${API_DOMAIN}/api/f/file456/direct` },
      { label: 'Inline preview', code: `curl -L "${API_DOMAIN}/api/f/file456/direct?preview=true"` },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────
   Reusable Components
   ──────────────────────────────────────────────────────────────────── */

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-secondary/20 text-secondary border-secondary/30',
  POST: 'bg-success-green/20 text-success-green border-success-green/30',
  HEAD: 'bg-tertiary/20 text-tertiary border-tertiary/30',
  INFO: 'bg-secondary/20 text-secondary border-secondary/30',
  E2EE: 'bg-tertiary/20 text-tertiary border-tertiary/30',
};

function MethodBadge({ method, className = '' }: { method: string; className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-12 py-0.5 rounded border text-[10px] font-bold tracking-widest uppercase ${METHOD_COLORS[method] ?? ''} ${className}`}>
      {method}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={copy}
      aria-label="Copy to clipboard"
      className="absolute top-2.5 right-2.5 p-1.5 rounded border border-surface-variant bg-surface-container-low text-on-surface-variant hover:text-secondary hover:border-secondary transition-all text-[10px] font-mono uppercase tracking-wider opacity-0 group-hover:opacity-100 focus:opacity-100"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code, color = 'text-success-green' }: { code: string; color?: string }) {
  return (
    <div className="group relative">
      <div className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-container-high/50 border-b border-surface-variant rounded-t">
        <span className="w-2 h-2 rounded-full bg-danger-red/80" />
        <span className="w-2 h-2 rounded-full bg-tertiary/80" />
        <span className="w-2 h-2 rounded-full bg-success-green/80" />
      </div>
      <pre className={`bg-terminal-bg p-4 rounded-b border border-t-0 border-surface-variant text-xs leading-relaxed overflow-x-auto ${color} font-mono`}>
        {code}
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

function ParamTable({ rows, showType = true }: { rows: Param[]; showType?: boolean }) {
  return (
    <div className="overflow-x-auto rounded border border-surface-variant">
      <table className="min-w-full font-mono text-xs">
        <thead>
          <tr className="bg-surface-container-low">
            <th className="text-left px-4 py-2.5 text-secondary font-bold uppercase tracking-wider text-[10px]">Name</th>
            {showType && <th className="text-left px-4 py-2.5 text-secondary font-bold uppercase tracking-wider text-[10px]">Type</th>}
            <th className="text-center px-4 py-2.5 text-secondary font-bold uppercase tracking-wider text-[10px]">Required</th>
            <th className="text-left px-4 py-2.5 text-secondary font-bold uppercase tracking-wider text-[10px]">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-variant">
          {rows.map((p) => (
            <tr key={p.name} className="bg-surface-container-lowest hover:bg-surface-container-low/50 transition-colors">
              <td className="px-4 py-2.5">
                <code className="text-hot-pink font-bold">{p.name}</code>
              </td>
              {showType && (
                <td className="px-4 py-2.5 text-outline">{p.type}</td>
              )}
              <td className="px-4 py-2.5 text-center">
                {p.required ? (
                  <span className="inline-flex items-center gap-1 text-danger-red font-bold text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger-red" />
                    YES
                  </span>
                ) : (
                  <span className="text-outline text-[10px]">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-on-surface-variant leading-relaxed">{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page Component
   ──────────────────────────────────────────────────────────────────── */

export default function DocsPage() {
  const [activeId, setActiveId] = useState('quick-start');

  const selectedEndpoint = ENDPOINTS.find((ep) => ep.id === activeId);

  const navItems = [
    { id: 'quick-start', label: 'QUICK START', method: 'INFO' },
    { id: 'e2ee', label: 'E2E ENCRYPTION', method: 'E2EE' },
    ...ENDPOINTS.map(ep => ({ id: ep.id, label: ep.title.toUpperCase(), method: ep.method })),
  ];

  return (
    <div className="space-y-10 pb-16">

      {/* ───── Hero ───── */}
      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4">
        <h1 className="font-display text-headline-lg md:text-headline-xl text-secondary drop-shadow-[0_0_30px_rgba(76,215,246,0.5)] break-words">
          API DOCUMENTATION
        </h1>
        <p className="text-sm text-on-surface-variant font-mono leading-relaxed max-w-2xl mx-auto">
          Zero-registration REST API for creating pastes, uploading files, and managing encrypted content.
          All endpoints are rate-limited per IP. No API keys required.
        </p>
      </header>

      {/* ───── Main Content: Sidebar + Active Panel ───── */}
      <div className="flex flex-col lg:flex-row gap-8 max-w-full">
        {/* Sidebar */}
        <aside className="w-full lg:w-64 shrink-0 lg:sticky lg:top-20 h-fit">
          <div className="border-2 border-surface-variant bg-surface-container rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-container-low border-b-2 border-surface-variant">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-danger-red" />
                <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
                <span className="w-2.5 h-2.5 rounded-full bg-success-green" />
              </div>
              <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider ml-2">API_ROUTES.LOG</span>
            </div>

            <nav className="bg-surface-container-lowest">
              {navItems.map((item, index) => {
                const isActive = activeId === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left font-mono text-xs transition-colors border-l-4 border-solid min-h-[44px] focus:outline-none ${index > 0 ? 'border-t-2 border-t-surface-variant' : ''
                      } ${isActive
                        ? 'border-l-secondary bg-surface-container-low text-secondary font-bold'
                        : 'border-l-transparent text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                      }`}
                  >
                    <MethodBadge method={item.method} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Active Content Panel */}
        <main className="flex-1 min-w-0">

          {/* View: Quick Start */}
          {activeId === 'quick-start' && (
            <div className="space-y-8 animate-fade-in">
              {/* Base URL + Auth Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-surface-variant rounded-lg p-5 bg-surface-container-lowest space-y-2">
                  <p className="text-[10px] font-mono text-secondary font-bold uppercase tracking-widest">Base URL</p>
                  <code className="text-sm text-on-surface font-mono font-bold block">{API_DOMAIN}/api</code>
                  <p className="text-[11px] text-outline font-mono">Default path for all integrations</p>
                </div>
                <div className="border border-surface-variant rounded-lg p-5 bg-surface-container-lowest space-y-2">
                  <p className="text-[10px] font-mono text-secondary font-bold uppercase tracking-widest">Authentication</p>
                  <p className="text-sm text-on-surface font-mono font-bold">None required</p>
                  <p className="text-[11px] text-outline font-mono">Rate-limited per IP address</p>
                </div>
              </div>

              {/* Quick Start Terminal */}
              <section className="border-2 border-secondary/30 rounded-lg overflow-hidden shadow-[0_0_30px_rgba(76,215,246,0.08)]">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-container-low border-b-2 border-surface-variant">
                  <div className="flex items-center gap-1.5" aria-hidden="true">
                    <span className="w-2.5 h-2.5 rounded-full bg-danger-red" />
                    <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
                    <span className="w-2.5 h-2.5 rounded-full bg-success-green" />
                  </div>
                  <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider ml-2">QUICK_START.LOG</span>
                </div>
                <div className="bg-terminal-bg p-5 font-mono text-xs space-y-3">
                  <p className="text-on-surface-variant">
                    <span className="text-outline"># Create a paste in one line</span>
                  </p>
                  <p className="text-success-green">
                    <span className="text-secondary select-none">$ </span>
                    <span className="select-all">echo &quot;Hello DarkCopy&quot; | curl --data-binary @- {API_DOMAIN}/api/new</span>
                  </p>
                  <p className="text-tertiary">{API_DOMAIN}/abc12345</p>
                  <div className="border-t border-surface-variant my-2" />
                  <p className="text-on-surface-variant">
                    <span className="text-outline"># Upload a file</span>
                  </p>
                  <p className="text-success-green">
                    <span className="text-secondary select-none">$ </span>
                    <span className="select-all">curl -F &quot;file=@report.pdf&quot; {API_DOMAIN}/api/upload</span>
                  </p>
                  <p className="text-tertiary">{API_DOMAIN}/f/file456</p>
                </div>
              </section>
            </div>
          )}

          {/* View: E2EE */}
          {activeId === 'e2ee' && (
            <section className="border border-tertiary/30 rounded-lg overflow-hidden shadow-[0_0_20px_rgba(250,188,78,0.06)] animate-fade-in">
              <div className="px-6 py-5 border-b border-tertiary/20 bg-tertiary/5">
                <h2 className="font-display text-headline-sm text-tertiary flex items-center gap-2">
                  <span aria-hidden="true">🔐</span>
                  End-to-End Encryption (E2EE)
                </h2>
              </div>
              <div className="p-6 space-y-5 font-mono text-xs text-on-surface-variant leading-relaxed">
                <p>
                  DarkCopy supports zero-knowledge paste encryption. Payloads are encrypted <strong className="text-on-surface">entirely in the browser</strong> before reaching the server.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="border border-surface-variant rounded-lg p-4 bg-surface-container-low/50 space-y-2">
                    <p className="text-tertiary font-bold text-[10px] uppercase tracking-widest">Algorithm</p>
                    <p className="text-on-surface font-bold text-sm">AES-GCM</p>
                    <p className="text-outline text-[11px]">256-bit key, 12-byte random IV</p>
                  </div>
                  <div className="border border-surface-variant rounded-lg p-4 bg-surface-container-low/50 space-y-2">
                    <p className="text-tertiary font-bold text-[10px] uppercase tracking-widest">Key Transport</p>
                    <p className="text-on-surface font-bold text-sm">URL Hash Fragment</p>
                    <p className="text-outline text-[11px]">Never sent to the server</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-tertiary font-bold text-[10px] uppercase tracking-widest">How it works</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-on-surface-variant pl-1">
                    <li>Browser generates a random 256-bit AES key via <code className="text-hot-pink">crypto.subtle.generateKey()</code></li>
                    <li>Content is encrypted with AES-GCM + random IV</li>
                    <li>Ciphertext is submitted with <code className="text-hot-pink">is_encrypted: true</code></li>
                    <li>The raw key is base64url-encoded and appended as a URL hash: <code className="text-success-green">#key=...</code></li>
                    <li>Hash fragments are <strong className="text-on-surface">never sent in HTTP requests</strong> — the server only stores ciphertext</li>
                  </ol>
                </div>
              </div>
            </section>
          )}

          {/* View: Selected Endpoint */}
          {selectedEndpoint && (
            <section className="border border-surface-variant rounded-lg bg-surface-container-lowest overflow-hidden animate-fade-in">
              {/* Endpoint Header */}
              <div className="px-6 py-5 border-b border-surface-variant bg-surface-container-low/50">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <MethodBadge method={selectedEndpoint.method} className="text-xs px-3 py-1" />
                  <code className="text-sm font-mono text-on-surface font-bold">{API_DOMAIN}{selectedEndpoint.path}</code>
                </div>
                <h2 className="font-display text-headline-sm text-on-surface">{selectedEndpoint.title}</h2>
                <p className="text-xs font-mono text-on-surface-variant leading-relaxed mt-2">{selectedEndpoint.desc}</p>
              </div>

              <div className="p-6 space-y-6">
                {/* Headers */}
                {selectedEndpoint.headers && selectedEndpoint.headers.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-mono text-secondary font-bold uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-3 bg-secondary rounded-full" />
                      Request Headers
                    </h3>
                    <ParamTable rows={selectedEndpoint.headers} showType={false} />
                  </div>
                )}

                {/* Parameters */}
                {selectedEndpoint.params && selectedEndpoint.params.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-mono text-secondary font-bold uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-3 bg-secondary rounded-full" />
                      Parameters
                    </h3>
                    <ParamTable rows={selectedEndpoint.params} />
                  </div>
                )}

                {/* Request Body */}
                {selectedEndpoint.requestBody && (
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-mono text-secondary font-bold uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-3 bg-secondary rounded-full" />
                      Request Body
                    </h3>
                    <CodeBlock code={selectedEndpoint.requestBody} color="text-on-surface" />
                  </div>
                )}

                {/* Response Body */}
                {selectedEndpoint.responseBody && (
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-mono text-tertiary font-bold uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-3 bg-tertiary rounded-full" />
                      Response
                    </h3>
                    <CodeBlock code={selectedEndpoint.responseBody} color="text-on-surface" />
                  </div>
                )}

                {/* Examples */}
                <div className="space-y-3">
                  <h3 className="text-[10px] font-mono text-success-green font-bold uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-3 bg-success-green rounded-full" />
                    Examples
                  </h3>
                  <div className="space-y-4">
                    {selectedEndpoint.examples.map((ex, i) => (
                      <div key={i} className="space-y-1.5">
                        <p className="text-[10px] font-mono text-outline uppercase tracking-wider pl-1">{ex.label}</p>
                        <CodeBlock code={ex.code} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

        </main>
      </div>
    </div>
  );
}
