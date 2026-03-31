import fs from "fs";
import path from "path";
import type { NextConfig } from "next";

// ── Load root .env for local development ──────────────────────────────────────
// Next.js normally loads env files from the project directory (client/).
// We keep a single .env at the repo root, so we load it here manually using
// only Node built-ins — no extra dependencies required.
//
// Precedence rules (highest → lowest):
//   1. OS / shell environment variables  (Docker `environment:`, CI secrets)
//   2. Root .env values loaded below
//   3. Fallback defaults in code (e.g. SERVER_URL fallback)
//
// Edge cases handled:
//   • File missing  — silently skipped (Docker builder stage, CI, fresh clone)
//   • Commented / blank lines — skipped
//   • Already-set vars — never overwritten (OS env always wins)
//   • `next start` standalone runner — vars must come from the OS environment;
//     for local production-like testing run:
//       bun --env-file=../.env run start   OR   source ../.env && bun run start
//
const rootEnvPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(rootEnvPath)) {
  for (const line of fs.readFileSync(rootEnvPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// SERVER_URL is now populated from the root .env (loaded above) for local dev.
// In Docker, it comes from the build ARG / runtime `environment:` block.
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

const nextConfig: NextConfig = {
  // Produce a self-contained output in .next/standalone — used by the Docker
  // runner stage to create a minimal image without the full node_modules tree.
  output: "standalone",

  // Allow large backup files to be uploaded via /api/import (up to 500 MB)
  experimental: {
    proxyClientMaxBodySize: 500 * 1024 * 1024, // 500 MB in bytes
  },

  // Proxy /api/server/* → backend HTTP server
  // This keeps OAuth redirects working without exposing the backend URL to the browser.
  async rewrites() {
    return [
      {
        source: "/api/server/:path*",
        destination: `${SERVER_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
