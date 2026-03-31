# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Gmail Sync — Server  (Node.js)                                             ║
# ║  Multi-stage build: 2 stages                                                ║
# ║    1. deps   — install production dependencies only                         ║
# ║    2. runner — minimal Alpine image with source + deps                      ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# ── Stage 1: Production dependencies ─────────────────────────────────────────
#
# Installs only the packages listed under "dependencies" (not devDependencies).
# Using a dedicated stage means the final image never sees npm, build tools, or
# package manager caches — keeping it as small as possible.
#
FROM node:24-alpine AS deps

WORKDIR /build

# Copy manifests first so Docker can cache this layer. The install layer is
# only re-run when package.json or the lockfile actually changes.
COPY package.json package-lock.json* ./

# --omit=dev  : skip devDependencies (no build tools in production)
# --ignore-scripts : skip postinstall scripts for speed + security
# --prefer-offline : use the npm cache if available (faster in CI)
RUN npm ci --omit=dev --ignore-scripts --prefer-offline


# ── Stage 2: Production runner ────────────────────────────────────────────────
#
# Starts from a fresh Alpine image — no npm, no build cache, no source maps.
# Only the compiled source and production node_modules are copied in.
#
FROM node:24-alpine AS runner

# ── Runtime metadata ──────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="gmail-sync-server"
LABEL org.opencontainers.image.description="Gmail multi-account sync — OAuth server + email sync engine"

# ── Security: run as a non-root user ─────────────────────────────────────────
# Creating a dedicated user reduces the blast radius of any container escape.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# ── Working directory ─────────────────────────────────────────────────────────
# Using /app/server so that the three "../../../" hops in extractor.js and
# env.js resolve to /app — matching the Docker volume mount point.
#   /app/server/src/services/../../../  →  /app
WORKDIR /app/server

ENV NODE_ENV=production

# ── Copy dependencies from deps stage ────────────────────────────────────────
COPY --from=deps --chown=appuser:appgroup /build/node_modules ./node_modules

# ── Copy application source ───────────────────────────────────────────────────
COPY --chown=appuser:appgroup src ./src
COPY --chown=appuser:appgroup package.json ./

# ── Attachments directory ─────────────────────────────────────────────────────
# extractor.js resolves attachments to /app/attachments (three levels up from
# /app/server/src/services). Pre-creating it with correct ownership means the
# bind-mount works even if the host directory doesn't exist yet.
RUN mkdir -p /app/attachments && chown appuser:appgroup /app/attachments

USER appuser

EXPOSE 3000

# ── Health check ──────────────────────────────────────────────────────────────
# wget is included in Alpine. Polls the /health endpoint every 30 s.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
