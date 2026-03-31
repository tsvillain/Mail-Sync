/**
 * REST JSON API endpoints consumed by the Next.js frontend:
 *   GET  /api/accounts         — list all accounts with auth status + sync stats
 *   GET  /api/accounts/:email  — single account details
 *   GET  /api/health           — liveness probe
 */

const { AccountCredentials, SyncState, GmailEmail, AppConfig } = require("../config/db");
const { syncAccount } = require("../services/emailMonitor");
const env = require("../config/env");
const log = require("../utils/logger");
const { sendJson } = require("../utils/http");

// Per-account in-flight guard so rapid double-clicks don't queue duplicates
const syncInFlight = new Set();

// ── GET /api/accounts ─────────────────────────────────────────────────────────
async function handleGetAccounts(req, res) {
  try {
    log.debug("API", "GET /api/accounts — fetching all accounts");

    const [dbAccounts, syncStates] = await Promise.all([
      AccountCredentials.find().sort({ email: 1 }).lean(),
      SyncState.find().lean(),
    ]);

    const syncMap = new Map(syncStates.map((s) => [s.account, s]));

    // Merge env-seeded list with DB accounts for backwards compatibility
    const allEmails = [
      ...new Set([
        ...env.GMAIL_ACCOUNTS,
        ...dbAccounts.map((a) => a.email),
      ]),
    ].sort();

    const accounts = allEmails.map((email) => {
      const acc = dbAccounts.find((a) => a.email === email);
      const sync = syncMap.get(email);

      let authStatus = "pending";
      if (acc?.authorized && acc.consecutiveErrors >= 5) authStatus = "error";
      else if (acc?.authorized) authStatus = "authorized";

      return {
        email,
        inEnvList: env.GMAIL_ACCOUNTS.includes(email),
        authorized: acc?.authorized ?? false,
        authStatus, // "pending" | "authorized" | "error"
        authorizedAt: acc?.authorizedAt ?? null,
        lastSyncAt: acc?.lastSyncAt ?? null,
        lastSyncError: acc?.lastSyncError ?? null,
        consecutiveErrors: acc?.consecutiveErrors ?? 0,
        syncLocked: acc?.syncLocked ?? false,
        totalEmailsSynced: sync?.totalEmailsSynced ?? 0,
        lastFullSyncAt: sync?.lastFullSyncAt ?? null,
      };
    });

    log.debug("API", `GET /api/accounts — returning ${accounts.length} account(s)`);
    sendJson(res, 200, { accounts });
  } catch (err) {
    log.error("API", "GET /api/accounts failed", err);
    sendJson(res, 500, { error: "Internal server error", message: err.message });
  }
}

// ── GET /api/accounts/:email ──────────────────────────────────────────────────
async function handleGetAccount(req, res, email) {
  const decodedEmail = decodeURIComponent(email).toLowerCase().trim();

  if (!decodedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decodedEmail)) {
    return sendJson(res, 400, { error: "Invalid email address" });
  }

  try {
    log.debug("API", `GET /api/accounts/${decodedEmail}`);

    const [acc, sync, totalEmails, unreadCount] = await Promise.all([
      AccountCredentials.findOne({ email: decodedEmail }).lean(),
      SyncState.findOne({ account: decodedEmail }).lean(),
      GmailEmail.countDocuments({ syncedFromAccount: decodedEmail }),
      GmailEmail.countDocuments({ syncedFromAccount: decodedEmail, isUnread: true }),
    ]);

    if (!acc) {
      return sendJson(res, 404, { error: "Account not found" });
    }

    let authStatus = "pending";
    if (acc.authorized && acc.consecutiveErrors >= 5) authStatus = "error";
    else if (acc.authorized) authStatus = "authorized";

    sendJson(res, 200, {
      email: decodedEmail,
      authorized: acc.authorized,
      authStatus,
      authorizedAt: acc.authorizedAt,
      lastSyncAt: acc.lastSyncAt,
      lastSyncError: acc.lastSyncError,
      consecutiveErrors: acc.consecutiveErrors,
      syncLocked: acc.syncLocked,
      totalEmailsSynced: sync?.totalEmailsSynced ?? 0,
      lastFullSyncAt: sync?.lastFullSyncAt ?? null,
      totalEmails,
      unreadCount,
    });
  } catch (err) {
    log.error("API", `GET /api/accounts/${decodedEmail} failed`, err);
    sendJson(res, 500, { error: "Internal server error", message: err.message });
  }
}

// ── POST /api/accounts/:email/sync ───────────────────────────────────────────
// Triggers an immediate sync for a single authorized account.
// Returns 202 immediately; the sync runs in the background.
async function handleSyncNow(req, res, email) {
  const decodedEmail = decodeURIComponent(email).toLowerCase().trim();

  if (!decodedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decodedEmail)) {
    return sendJson(res, 400, { error: "Invalid email address" });
  }

  const acc = await AccountCredentials.findOne({ email: decodedEmail });

  if (!acc) {
    return sendJson(res, 404, { error: "Account not found" });
  }

  if (!acc.authorized) {
    return sendJson(res, 409, { error: "Account is not authorized. Please authorize it first." });
  }

  if (syncInFlight.has(decodedEmail)) {
    return sendJson(res, 409, { error: "A sync is already in progress for this account." });
  }

  // Respond immediately — sync runs in background
  sendJson(res, 202, { message: "Sync started", email: decodedEmail });

  syncInFlight.add(decodedEmail);
  log.info("API", `Manual sync triggered for ${decodedEmail}`);

  syncAccount(decodedEmail, 1, 1)
    .then((result) => log.info("API", `Manual sync finished for ${decodedEmail}: ${result.status}`))
    .catch((err) => log.error("API", `Manual sync error for ${decodedEmail}: ${err.message}`, err))
    .finally(() => syncInFlight.delete(decodedEmail));
}

// ── POST /api/accounts ────────────────────────────────────────────────────────
// Pre-register an account so it shows as "pending" in the dashboard before OAuth.
// The OAuth callback does an upsert, so this is optional but improves UX.
async function handleAddAccount(req, res, body) {
  const raw = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return sendJson(res, 400, { error: "Invalid email address" });
  }

  try {
    const existing = await AccountCredentials.findOne({ email: raw });

    if (existing) {
      log.info("API", `POST /api/accounts — ${raw} already exists (authorized=${existing.authorized})`);
      return sendJson(res, 200, {
        email: raw,
        alreadyExists: true,
        authorized: existing.authorized,
      });
    }

    await AccountCredentials.create({ email: raw, authorized: false });
    log.info("API", `POST /api/accounts — created pending account: ${raw}`);
    sendJson(res, 201, { email: raw, alreadyExists: false, authorized: false });
  } catch (err) {
    log.error("API", `POST /api/accounts failed for ${raw}`, err);
    sendJson(res, 500, { error: "Internal server error", message: err.message });
  }
}

// ── GET /api/settings ─────────────────────────────────────────────────────────
// Returns current app config. The AWS secret is never returned in full —
// only a boolean indicating whether it has been set.
async function handleGetSettings(req, res) {
  try {
    const cfg = await AppConfig.getOrCreate();
    sendJson(res, 200, {
      saveAttachments: cfg.saveAttachments,
      attachmentStorage: cfg.attachmentStorage,
      maxAttachmentSizeBytes: cfg.maxAttachmentSizeBytes ?? 20 * 1024 * 1024 * 1024,
      aws: {
        region: cfg.aws?.region ?? "",
        bucket: cfg.aws?.bucket ?? "",
        accessKeyId: cfg.aws?.accessKeyId ?? "",
        // Never expose the raw secret — send a masked flag instead
        accessSecretSet: !!(cfg.aws?.accessSecret),
      },
    });
  } catch (err) {
    log.error("API", "GET /api/settings failed", err);
    sendJson(res, 500, { error: "Internal server error", message: err.message });
  }
}

// ── PUT /api/settings ─────────────────────────────────────────────────────────
// Accepts a partial update. If `aws.accessSecret` is omitted or empty, the
// existing secret is preserved (so the UI doesn't need to re-enter it on save).
const AWS_REGIONS = new Set([
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "ca-central-1", "ca-west-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2",
  "eu-north-1", "eu-south-1", "eu-south-2",
  "ap-south-1", "ap-south-2", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
  "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-southeast-4",
  "ap-east-1", "me-south-1", "me-central-1", "af-south-1", "il-central-1",
  "sa-east-1",
]);

async function handlePutSettings(req, res, body) {
  try {
    const { saveAttachments, attachmentStorage, aws } = body ?? {};

    const update = {};

    if (typeof saveAttachments === "boolean") {
      update.saveAttachments = saveAttachments;
    }

    const { maxAttachmentSizeBytes } = body ?? {};
    if (maxAttachmentSizeBytes !== undefined) {
      const sizeNum = Number(maxAttachmentSizeBytes);
      if (!Number.isFinite(sizeNum) || sizeNum < 1024) {
        return sendJson(res, 400, {
          error: "maxAttachmentSizeBytes must be a number ≥ 1024 (1 KB).",
        });
      }
      // Cap at 1 TB as a sanity guard
      if (sizeNum > 1024 * 1024 * 1024 * 1024) {
        return sendJson(res, 400, { error: "maxAttachmentSizeBytes cannot exceed 1 TB." });
      }
      update.maxAttachmentSizeBytes = Math.round(sizeNum);
    }

    if (attachmentStorage !== undefined) {
      if (!["disk", "aws"].includes(attachmentStorage)) {
        return sendJson(res, 400, { error: "attachmentStorage must be 'disk' or 'aws'" });
      }
      update.attachmentStorage = attachmentStorage;
    }

    // Validate AWS fields only when AWS storage is being enabled
    const effectiveStorage = attachmentStorage ?? (await AppConfig.getOrCreate()).attachmentStorage;
    const effectiveSave = typeof saveAttachments === "boolean" ? saveAttachments
      : (await AppConfig.getOrCreate()).saveAttachments;

    if (effectiveSave && effectiveStorage === "aws") {
      const region = aws?.region?.trim();
      const bucket = aws?.bucket?.trim();
      const accessKeyId = aws?.accessKeyId?.trim();
      const accessSecret = aws?.accessSecret?.trim();

      if (!region) {
        return sendJson(res, 400, { error: "AWS Region is required when using S3 storage." });
      }
      if (!AWS_REGIONS.has(region)) {
        return sendJson(res, 400, { error: `Unknown AWS region: "${region}". Check for typos.` });
      }
      if (!bucket) {
        return sendJson(res, 400, { error: "S3 Bucket name is required when using S3 storage." });
      }
      if (!accessKeyId) {
        return sendJson(res, 400, { error: "AWS Access Key ID is required when using S3 storage." });
      }

      // Check if we already have a secret stored
      const existing = await AppConfig.getOrCreate();
      if (!accessSecret && !existing.aws?.accessSecret) {
        return sendJson(res, 400, { error: "AWS Secret Access Key is required when using S3 storage." });
      }
    }

    // Build the AWS sub-document update (preserve existing secret if not provided)
    if (aws !== undefined) {
      if (aws.region !== undefined) update["aws.region"] = aws.region.trim();
      if (aws.bucket !== undefined) update["aws.bucket"] = aws.bucket.trim();
      if (aws.accessKeyId !== undefined) update["aws.accessKeyId"] = aws.accessKeyId.trim();
      if (aws.accessSecret && aws.accessSecret.trim()) {
        update["aws.accessSecret"] = aws.accessSecret.trim();
      }
      // If aws.accessSecret is explicitly empty string, we do NOT overwrite the stored value
    }

    await AppConfig.findOneAndUpdate(
      { _id: "singleton" },
      { $set: update },
      { upsert: true },
    );

    log.info("API", `Settings updated: ${JSON.stringify({ saveAttachments, attachmentStorage, awsRegion: aws?.region, awsBucket: aws?.bucket })}`);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    log.error("API", "PUT /api/settings failed", err);
    sendJson(res, 500, { error: "Internal server error", message: err.message });
  }
}

// ── GET /api/health ───────────────────────────────────────────────────────────
function handleHealth(req, res) {
  sendJson(res, 200, {
    status: "ok",
    ts: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
}

module.exports = {
  handleGetAccounts, handleGetAccount, handleAddAccount, handleSyncNow,
  handleGetSettings, handlePutSettings,
  handleHealth,
};
