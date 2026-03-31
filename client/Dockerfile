# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Gmail Sync — Client  (Next.js)                                             ║
# ║  Multi-stage build: 3 stages                                                ║
# ║    1. deps    — install all dependencies (dev + prod)                       ║
# ║    2. builder — compile TypeScript, run next build, emit standalone output  ║
# ║    3. runner  — minimal Alpine image with standalone bundle only            ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# ── Stage 1: All dependencies ─────────────────────────────────────────────────
#
# Installs both production and dev dependencies (TypeScript compiler, Tailwind,
# ESLint, etc.) that are required for `next build` to succeed.
#
FROM node:24-alpine AS deps

WORKDIR /build

# Layer-cache the install step — only reruns when manifests change.
COPY package.json package-lock.json* ./

# --ignore-scripts : skip postinstall hooks for speed + security
# --prefer-offline : use local npm cache when available (faster CI)
RUN npm ci --ignore-scripts --prefer-offline


# ── Stage 2: Build ────────────────────────────────────────────────────────────
#
# Runs `next build` which compiles TypeScript, runs the Tailwind purge pass,
# and emits a minimal standalone server bundle into .next/standalone/.
#
# SERVER_URL is read by next.config.ts at build time to hard-code the rewrite
# destination for /api/server/* → backend. Inside Docker the target is the
# "server" service on the internal app-network.
#
FROM node:24-alpine AS builder

WORKDIR /app

# Bring in the full node_modules from the deps stage
COPY --from=deps /build/node_modules ./node_modules

# Copy all source files
COPY . .

# Build-time configuration ────────────────────────────────────────────────────
# SERVER_URL: URL of the backend server as seen from inside the Docker network.
# Override with --build-arg SERVER_URL=https://api.example.com for production.
ARG SERVER_URL=http://server:3000
ENV SERVER_URL=$SERVER_URL

# Suppress the Next.js anonymous telemetry ping during build
ENV NEXT_TELEMETRY_DISABLED=1

# Produce the standalone output and static assets
RUN npm run build


# ── Stage 3: Minimal production runner ───────────────────────────────────────
#
# Copies only the three artefacts produced by `output: "standalone"`:
#   .next/standalone/ — self-contained Node server (no node_modules needed)
#   .next/static/     — hashed JS/CSS chunks served by Next.js
#   public/           — static files served as-is
#
# The final image has NO node_modules, NO source files, NO build tools.
#
FROM node:24-alpine AS runner

LABEL org.opencontainers.image.title="gmail-sync-client"
LABEL org.opencontainers.image.description="Gmail multi-account sync — Next.js dashboard"

# ── Security: non-root user ───────────────────────────────────────────────────
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Runtime environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# next/server.js reads PORT and HOSTNAME at start
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# ── Copy standalone bundle ────────────────────────────────────────────────────
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static     ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public           ./public

USER appuser

EXPOSE 3001

# ── Health check ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/ || exit 1

# The standalone build emits server.js at the root of the standalone directory
CMD ["node", "server.js"]
