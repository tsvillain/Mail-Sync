/**
 * Loads and validates all environment variables at startup.
 * Throws on first missing required variable so the process fails fast
 * with a human-readable error instead of crashing later.
 *
 * dotenv is configured to look at the workspace root (.env two levels up),
 * so a single .env file at the repo root covers both server and client.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../../.env") });

// ── Helpers ───────────────────────────────────────────────────────────────────

function required(name) {
  const val = process.env[name];
  if (!val || !val.trim()) {
    throw new Error(
      `[ENV] Missing required environment variable: ${name}\n` +
      `      Please set it in your .env file at the workspace root.`,
    );
  }
  return val.trim();
}

function optional(name, defaultValue = undefined) {
  const val = process.env[name];
  return val && val.trim() ? val.trim() : defaultValue;
}

// ── Accounts ──────────────────────────────────────────────────────────────────
// GMAIL_ACCOUNTS is optional — accounts are now managed via the frontend UI.
// You may still seed initial accounts here for backwards compatibility.

const GMAIL_ACCOUNTS_RAW = optional("GMAIL_ACCOUNTS", "");
const GMAIL_ACCOUNTS = GMAIL_ACCOUNTS_RAW
  ? GMAIL_ACCOUNTS_RAW.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  : [];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
for (const email of GMAIL_ACCOUNTS) {
  if (!EMAIL_RE.test(email)) {
    throw new Error(
      `[ENV] Invalid email address in GMAIL_ACCOUNTS: "${email}"`,
    );
  }
}

// ── Port ──────────────────────────────────────────────────────────────────────
const AUTH_PORT = parseInt(optional("AUTH_PORT", "3000"), 10);
if (isNaN(AUTH_PORT) || AUTH_PORT < 1 || AUTH_PORT > 65535) {
  throw new Error("[ENV] AUTH_PORT must be a valid port number (1-65535)");
}

// ── Cron schedule ─────────────────────────────────────────────────────────────
const CRON_SCHEDULE = optional("CRON_SCHEDULE", "*/5 * * * *");

// ── Export ────────────────────────────────────────────────────────────────────
const env = {
  // Database
  MONGODB_URI: required("MONGODB_URI"),

  // Google OAuth2 app credentials (shared across all accounts)
  GMAIL_CLIENT_ID: required("GMAIL_CLIENT_ID"),
  GMAIL_CLIENT_SECRET: required("GMAIL_CLIENT_SECRET"),

  // Accounts to manage (comma-separated Gmail addresses)
  GMAIL_ACCOUNTS,

  // Auth server — public base URL used to build the OAuth redirect URI
  // Must match a URI registered in your Google Cloud OAuth client
  BASE_URL: optional("BASE_URL", `http://localhost:${AUTH_PORT}`),
  AUTH_PORT,

  // Where to redirect the browser after OAuth completes (the Next.js UI)
  FRONTEND_URL: optional("FRONTEND_URL", "http://localhost:3001"),

  // Cron schedule for email syncing (default: every 5 minutes)
  CRON_SCHEDULE,

  // Attachment and AWS settings are now managed via the frontend UI (stored in MongoDB AppConfig).
  // Do NOT set SAVE_ATTACHMENTS or AWS_* here — they will be ignored.

  // Debug logging (set DEBUG=1 to enable verbose logs)
  DEBUG: optional("DEBUG", ""),
};

module.exports = env;
