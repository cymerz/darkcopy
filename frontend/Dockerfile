# ---- Stage 1: Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Cache layer: install deps first (only changes when package.json changes)
COPY package.json package-lock.json ./
RUN npm ci

# Source & build
COPY . .
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build

# ---- Stage 2: Production runner (minimal footprint) ----
FROM node:20-alpine AS runner
WORKDIR /app

# tini: proper signal forwarding & zombie reaping in Node containers
# wget: lightweight HTTP check for HEALTHCHECK
RUN apk add --no-cache tini wget

# Non-root user (Next.js standalone docs use uid 1001)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# Copy standalone production server (compiled app + prod-only node_modules)
COPY --from=builder /app/.next/standalone ./

# Static assets & public files (not bundled into standalone)
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Secure ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
