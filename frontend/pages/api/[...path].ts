import { IncomingMessage, ServerResponse } from 'http';
import http from 'http';

export const config = {
  api: {
    // Disable Next.js body parser so that files up to 100 MB+ can stream
    // directly to the backend without being loaded into Next.js memory or hitting a 4MB limit.
    bodyParser: false,
    externalResolver: true, // Prevents Next.js warning about unresolved promises
    responseLimit: false, // Disable Next.js 4MB API response size limit warnings for file downloads
  },
};

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

  // Extract path and query parameters from the incoming request URL
  const url = new URL(req.url || '', 'http://localhost');
  const path = url.pathname.replace(/^\/api/, '');
  const search = url.search;

  const targetUrl = new URL(`${backendUrl}${path}${search}`);

  // Allowlist headers to forward (prevents smuggling via transfer-encoding, etc.)
  const allowedHeaders = new Set([
    'content-type',
    'content-length',
    'authorization',
    'user-agent',
    'accept',
    'accept-language',
    'accept-encoding',
    'referer',
    'origin',
    'cookie',
    'x-requested-with',
    'x-admin-token',
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
  ]);
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (allowedHeaders.has(key.toLowerCase())) {
      headers[key] = value as string | string[];
    }
  }

  // Forward client IP to backend for rate limiting & quotas
  const clientIp = req.socket.remoteAddress;
  if (clientIp) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      headers['x-forwarded-for'] = `${xff}, ${clientIp}`;
    } else {
      headers['x-forwarded-for'] = clientIp;
    }
  }

  // Inject host and proto proxy headers. The backend uses these to construct
  // absolute URLs (e.g. paste creation responses). Derive proto from the app
  // URL env var to avoid trusting client-spoofable headers like X-Forwarded-Proto.
  if (req.headers['host']) {
    headers['x-forwarded-host'] = req.headers['host'];
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const proto = appUrl.startsWith('https') ? 'https' : 'http';
  headers['x-forwarded-proto'] = proto;

  const proxyReq = http.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      // Forward the backend status code and response headers
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      
      // Standard high-reliability, maximum-performance native streaming pipe.
      // Automatically handles backpressure with 0MB RAM bloat at maximum C++ network speeds!
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error(`[Proxy Error] Failed to connect to backend at ${targetUrl}:`, err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Failed to connect to backend server',
        code: 'BACKEND_ERROR',
      })
    );
  });

  // Pipe the raw request stream directly into the backend request
  req.pipe(proxyReq);
}
