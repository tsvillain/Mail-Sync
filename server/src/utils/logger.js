/**
 * Structured, timestamped console logger.
 * Set DEBUG=1 in .env to enable verbose debug output.
 */

// ── Timestamp ─────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString();
}

// ── Core formatter ────────────────────────────────────────────────────────────
function fmt(level, tag, message) {
  const paddedLevel = level.padEnd(5);
  const paddedTag = tag.padEnd(10);
  return `[${ts()}] [${paddedLevel}] [${paddedTag}] ${message}`;
}

// ── Core logger ───────────────────────────────────────────────────────────────
const log = {
  info: (tag, message) => console.log(fmt("INFO", tag, message)),
  warn: (tag, message) => console.warn(fmt("WARN", tag, message)),
  debug: (tag, message) => {
    if (process.env.DEBUG) console.log(fmt("DEBUG", tag, message));
  },
  error: (tag, message, err) => {
    console.error(fmt("ERROR", tag, message));
    if (err?.stack) console.error(err.stack);
  },

  // ── Section dividers ────────────────────────────────────────────────────────
  divider: () => console.log("─".repeat(72)),
  section: (title) => {
    console.log("\n" + "═".repeat(72));
    console.log(`  ${title}`);
    console.log("═".repeat(72));
  },

  // ── Startup banner ──────────────────────────────────────────────────────────
  banner: (lines) => {
    console.log("\n" + "█".repeat(72));
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log("█".repeat(72) + "\n");
  },

  // ── Per-account section header ───────────────────────────────────────────────
  accountSection: (email, index, total) => {
    console.log("\n" + "┌" + "─".repeat(70) + "┐");
    const label = `  ACCOUNT [${index}/${total}]: ${email}`;
    console.log(`│${label.padEnd(70)}│`);
    console.log("└" + "─".repeat(70) + "┘");
  },

  // ── Sync lifecycle ──────────────────────────────────────────────────────────
  syncStart: (syncId) => {
    console.log("\n" + "=".repeat(72));
    log.info("SYNC", `Global sync #${syncId} started`);
    console.log("=".repeat(72));
  },

  syncEnd: (syncId, durationMs, accountStats) => {
    console.log("\n" + "─".repeat(72));
    log.info("SYNC", `Global sync #${syncId} complete — ${durationMs}ms`);
    log.info("SYNC", `  Accounts processed : ${accountStats.processed}`);
    log.info("SYNC", `  Accounts skipped   : ${accountStats.skipped}`);
    log.info("SYNC", `  Accounts errored   : ${accountStats.errored}`);
    console.log("=".repeat(72) + "\n");
  },

  // ── Per-account sync summary ─────────────────────────────────────────────────
  accountSyncSummary: (email, type, stats, durationMs) => {
    console.log("  " + "·".repeat(68));
    log.info("SYNC", `  [${email}] ${type} sync done — ${durationMs}ms`);
    log.info("SYNC", `    New saved    : ${stats.saved ?? stats.newMsgs ?? 0}`);
    log.info("SYNC", `    Skipped      : ${stats.skipped ?? 0}`);
    log.info("SYNC", `    Deleted      : ${stats.deleted ?? 0}`);
    log.info("SYNC", `    Label updates: ${stats.labelUpdates ?? 0}`);
    log.info("SYNC", `    Errors       : ${stats.errors ?? 0}`);
    console.log("  " + "·".repeat(68));
  },

  // ── OAuth events ─────────────────────────────────────────────────────────────
  oauthStart: (email) =>
    log.info("AUTH", `OAuth flow initiated for ${email}`),
  oauthSuccess: (email) =>
    log.info("AUTH", `OAuth tokens saved for ${email} — sync will begin on next cron tick`),
  oauthRevoked: (email) =>
    log.info("AUTH", `Tokens revoked for ${email}`),
  oauthTokenRefresh: (email) =>
    log.debug("AUTH", `Access token auto-refreshed for ${email}`),

  // ── HTTP request logger ───────────────────────────────────────────────────────
  request: (method, path, ip, statusCode, durationMs) =>
    log.info("HTTP", `${method} ${path} ${statusCode} — ${durationMs}ms [${ip}]`),
};

module.exports = log;
