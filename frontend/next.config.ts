import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob: https: http:",
  // connect-src must be permissive for presigned S3-compatible upload URLs
  // (configurable to any provider — AWS, Scaleway, Backblaze, MinIO, etc.).
  // NEXT_PUBLIC_CSP_CONNECT_SRC env var overrides default 'self' https: http:.
  "connect-src 'self' https: http:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",

  // Raise the body size limit for the /api/upload rewrite proxy to match
  // the backend's 100 MB file size limit (Requirement 5.9).
  experimental: {
    proxyClientMaxBodySize: 110 * 1024 * 1024, // 110 MB (headroom above 100 MB limit)
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
