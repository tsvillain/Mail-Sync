/**
 * Startup sequence:
 *   1. Validate environment variables (throws on missing required vars)
 *   2. Connect to MongoDB
 *   3. Seed AccountCredentials for every email in GMAIL_ACCOUNTS
 *   4. Start the HTTP server (OAuth dashboard + REST API)
 *   5. Run an immediate sync for all currently authorized accounts
 *   6. Schedule recurring syncs via cron
 *   7. Register graceful shutdown handlers (SIGTERM / SIGINT)
 */

const env = require("./config/env");
const cron = require("node-cron");
const { connectDB, AccountCredentials } = require("./config/db");
const { checkEmails } = require("./services/emailMonitor");
const { startServer } = require("./server");
const log = require("./utils/logger");

let syncCount = 0;
let isSyncRunning = false; // guard against overlapping global runs

// ── Sync runner ───────────────────────────────────────────────────────────────
async function runSync(triggeredBy = "cron") {
  if (isSyncRunning) {
    log.warn(
      "APP",
      `Sync triggered by [${triggeredBy}] but a sync is already in progress. Skipping.`,
    );
    return;
  }

  syncCount++;
  const id = syncCount;
  const start = Date.now();

  isSyncRunning = true;
  log.syncStart(id);

  let accountStats = { processed: 0, skipped: 0, errored: 0 };

  try {
    accountStats = await checkEmails();
  } catch (err) {
    log.error("APP", `Sync #${id} threw an unhandled top-level error`, err);
  } finally {
    isSyncRunning = false;
  }

  log.syncEnd(id, Date.now() - start, accountStats);
}

// ── Account seeding ───────────────────────────────────────────────────────────
//
// For every email in GMAIL_ACCOUNTS:
//   - If not in DB → insert with authorized=false
//   - If in DB and authorized → leave it alone
//   - Warn about DB accounts not in GMAIL_ACCOUNTS (orphans)
async function seedAccounts() {
  if (env.GMAIL_ACCOUNTS.length === 0) {
    log.info("APP", "No GMAIL_ACCOUNTS in env — accounts managed via frontend UI.");
    // Still return authorized accounts already in DB for initial sync
    const authorized = await AccountCredentials.find({ authorized: true }, "email").lean();
    return { existing: [], newPending: [], authorized: authorized.map((a) => a.email) };
  }

  log.info("APP", `Seeding ${env.GMAIL_ACCOUNTS.length} account(s) from GMAIL_ACCOUNTS...`);

  const results = { existing: [], newPending: [], authorized: [] };

  for (const email of env.GMAIL_ACCOUNTS) {
    const existing = await AccountCredentials.findOne({ email });

    if (!existing) {
      await AccountCredentials.create({ email, authorized: false });
      results.newPending.push(email);
      log.info("APP", `  [NEW]        ${email} — added, needs OAuth authorization`);
    } else if (existing.authorized) {
      results.authorized.push(email);
      log.info("APP", `  [AUTHORIZED] ${email} — tokens present, will be included in sync`);
    } else {
      results.existing.push(email);
      log.info("APP", `  [PENDING]    ${email} — exists but not yet authorized`);
    }
  }

  // Warn about orphaned accounts (in DB but not in GMAIL_ACCOUNTS)
  const allInDb = await AccountCredentials.find({}, "email authorized");
  for (const acc of allInDb) {
    if (!env.GMAIL_ACCOUNTS.includes(acc.email)) {
      log.warn(
        "APP",
        `  [ORPHAN]     ${acc.email} — in DB but not in GMAIL_ACCOUNTS. ` +
        "Add it to GMAIL_ACCOUNTS to enable auto-sync.",
      );
    }
  }

  return results;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function registerShutdownHandlers(server) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info("APP", `Received ${signal} — shutting down gracefully...`);

    server.close(() => log.info("APP", "HTTP server closed"));

    if (isSyncRunning) {
      log.info("APP", "Waiting for in-progress sync to complete (max 60s)...");
      const deadline = Date.now() + 60_000;
      while (isSyncRunning && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (isSyncRunning) {
        log.warn("APP", "Sync did not finish in time — forcing exit");
      } else {
        log.info("APP", "Sync finished cleanly");
      }
    }

    log.info("APP", "Shutdown complete.");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    log.error("APP", "Uncaught exception — process will exit", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    log.error("APP", `Unhandled promise rejection: ${reason}`);
    // Don't exit — log only. Unhandled rejections in sync workers should not
    // bring down the whole server.
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log.banner([
    "Gmail Multi-Account Sync — Server",
    `Accounts   : ${env.GMAIL_ACCOUNTS.length > 0 ? env.GMAIL_ACCOUNTS.join(", ") : "(managed via frontend UI)"}`,
    `MongoDB    : ${env.MONGODB_URI.replace(/:\/\/[^@]+@/, "://<credentials>@")}`,
    `Cron       : ${env.CRON_SCHEDULE}`,
    `API        : ${env.BASE_URL}/api`,
    `Frontend   : ${env.FRONTEND_URL}`,
    `Attachments: configurable via dashboard settings`,
  ]);

  // Step 1 — Connect to MongoDB
  log.info("APP", "Connecting to MongoDB...");
  try {
    await connectDB();
    log.info("APP", "MongoDB connected successfully");
  } catch (err) {
    log.error("APP", "Failed to connect to MongoDB — cannot start", err);
    process.exit(1);
  }

  // Step 2 — Seed account records
  const seedResults = await seedAccounts();

  // Step 3 — Start HTTP server
  let server;
  try {
    server = await startServer();
  } catch (err) {
    log.error("APP", "Failed to start HTTP server — cannot start", err);
    process.exit(1);
  }

  registerShutdownHandlers(server);

  // Step 4 — Prompt for pending authorizations
  const pendingCount = seedResults.newPending.length + seedResults.existing.length;
  if (pendingCount > 0) {
    log.divider();
    log.warn("APP", `${pendingCount} account(s) need OAuth authorization.`);
    log.warn("APP", `Open the dashboard at: ${env.FRONTEND_URL}`);
    log.divider();
  }

  // Step 5 — Run initial sync for authorized accounts
  if (seedResults.authorized.length === 0) {
    log.warn(
      "APP",
      "No authorized accounts — skipping initial sync. " +
      `Authorize at ${env.FRONTEND_URL} and the next cron tick will pick them up.`,
    );
  } else {
    log.info("APP", `Running initial sync for ${seedResults.authorized.length} authorized account(s)...`);
    await runSync("startup");
  }

  // Step 6 — Schedule recurring syncs
  const schedule = cron.validate(env.CRON_SCHEDULE)
    ? env.CRON_SCHEDULE
    : "*/5 * * * *";

  if (!cron.validate(env.CRON_SCHEDULE)) {
    log.warn("APP", `Invalid CRON_SCHEDULE "${env.CRON_SCHEDULE}" — falling back to "*/5 * * * *"`);
  }

  cron.schedule(schedule, async () => {
    log.info("CRON", `Scheduled sync triggered (schedule: "${schedule}")`);
    await runSync("cron");
  });

  log.info("APP", `Ready — cron: "${schedule}" | API: ${env.BASE_URL}/api | Press Ctrl+C to stop.`);
}

main().catch((err) => {
  log.error("APP", "Fatal startup error", err);
  process.exit(1);
});
