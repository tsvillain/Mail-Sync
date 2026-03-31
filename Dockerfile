# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Gmail Multi-Account Sync — Single All-in-One Image                         ║
# ║                                                                              ║
# ║  Build:   docker build -t gmail-sync .                                      ║
# ║  Run:     docker run -d -p 3000:3000 -p 3001:3001 \                         ║
# ║             -e MONGODB_URI=... \                                             ║
# ║             -e GMAIL_CLIENT_ID=... \                                         ║
# ║             -e GMAIL_CLIENT_SECRET=... \                                     ║
# ║             -e BASE_URL=http://localhost:3000 \                              ║
# ║             -e FRONTEND_URL=http://localhost:3001 \                          ║
# ║             gmail-sync                                                       ║
# ║                                                                              ║
# ║  Stages                                                                      ║
# ║    1. server-deps    — install server production dependencies                ║
# ║    2. client-deps    — install client dev + prod dependencies                ║
# ║    3. client-builder — compile Next.js into standalone bundle                ║
# ║    4. runner         — minimal Alpine image with both services               ║
# ╚══════════════════════════════════════════════════════════════════════════════╝


# ── Stage 1: Server dependencies ──────────────────────────────────────────────
FROM oven/bun:1-alpine AS server-deps

WORKDIR /build

COPY server/package.json ./

# Production deps only — no build tools in the final image
RUN bun install --production --ignore-scripts


# ── Stage 2: Client dependencies ──────────────────────────────────────────────
FROM oven/bun:1-alpine AS client-deps

WORKDIR /build

COPY client/package.json ./

# Dev deps needed for `next build` (TypeScript, Tailwind, ESLint, etc.)
RUN bun install --ignore-scripts


# ── Stage 3: Build Next.js client ─────────────────────────────────────────────
FROM oven/bun:1-alpine AS client-builder

WORKDIR /app

COPY --from=client-deps /build/node_modules ./node_modules
COPY client/ .

# Both services run inside the same container, so the server is always reachable
# on localhost:3000 — no user override needed.
ENV SERVER_URL=http://localhost:3000
ENV NEXT_TELEMETRY_DISABLED=1

# next build runs static generation which imports lib/db.ts at module-load time.
# That module throws if MONGODB_URI is empty. We pass a placeholder here so the
# validation passes — no actual DB connection is made during build.
# The real MONGODB_URI is injected at runtime via `docker run -e` and overrides this.
ARG MONGODB_URI=mongodb://build-placeholder:27017/build
ENV MONGODB_URI=$MONGODB_URI

RUN bun run build


# ── Stage 4: Production runner ─────────────────────────────────────────────────
FROM node:24-alpine AS runner

LABEL org.opencontainers.image.title="gmail-sync"
LABEL org.opencontainers.image.description="Gmail multi-account sync — all-in-one image (server + client)"

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Remove npm/corepack — only `node` is needed to run pre-compiled apps
RUN npm uninstall -g npm corepack 2>/dev/null; rm -rf /root/.npm /tmp/*

# Next.js standalone server reads these at startup
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# SERVER_URL is always localhost since both run in the same container
ENV SERVER_URL=http://localhost:3000


# ── Server ────────────────────────────────────────────────────────────────────
# Placed at /app/server so that the "../../../" path hops in the source code
# (extractor.js, env.js) resolve correctly to /app.
WORKDIR /app/server

COPY --from=server-deps --chown=appuser:appgroup /build/node_modules ./node_modules
COPY --chown=appuser:appgroup server/src ./src
COPY --chown=appuser:appgroup server/package.json ./

# Pre-create the attachments directory at the path the server expects
RUN mkdir -p /app/attachments && chown appuser:appgroup /app/attachments


# ── Client (Next.js standalone bundle) ────────────────────────────────────────
WORKDIR /app/client

# standalone output produces a self-contained server.js with no node_modules
COPY --from=client-builder --chown=appuser:appgroup /app/.next/standalone/. ./
COPY --from=client-builder --chown=appuser:appgroup /app/.next/static         ./.next/static


# ── Entrypoint ────────────────────────────────────────────────────────────────
COPY --chown=appuser:appgroup docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER appuser
WORKDIR /app

# 3000 — sync server  (OAuth callback, backend API)
# 3001 — Next.js UI
EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/ || exit 1

CMD ["/app/docker-entrypoint.sh"]
