/**
 * Gmail sync engine — handles full and incremental syncing for all
 * authorized accounts stored in MongoDB.
 *
 * Per-account sync flow:
 *   1. Acquire a DB-level sync lock (prevents concurrent cron overlaps).
 *   2. Build a Gmail API client using stored OAuth tokens.
 *   3. Sync label metadata.
 *   4. Run a full sync (first run) or incremental sync (subsequent runs).
 *   5. Release the lock and record the result.
 *
 * Rate limiting: 429 / 403-rateLimitExceeded responses are retried with
 * exponential backoff up to MAX_RETRIES times.
 */

const { google } = require("googleapis");
const {
  GmailEmail,
  SyncState,
  GmailLabel,
  AccountCredentials,
  AppConfig,
} = require("../config/db");
const { parseGmailMessage, downloadAndUploadAttachment } = require("./extractor");
const env = require("../config/env");
const log = require("../utils/logger");

// ── Tuning constants ──────────────────────────────────────────────────────────
const MAX_CONCURRENT = 10;   // messages fetched in parallel per batch
const MAX_RETRIES = 4;       // max retries for rate-limited/transient errors
const BASE_BACKOFF_MS = 1000;
const LOCK_TTL_MS = 30 * 60 * 1000;  // stale lock threshold (30 min)
const MAX_CONSECUTIVE_ERRORS = 5;     // skip account after this many errors

// ── Retry wrapper for Gmail API calls ─────────────────────────────────────────
async function withRetry(fn, context = "") {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = err.code || err.status || err?.response?.status;
      const reason =
        err?.errors?.[0]?.reason ||
        err?.response?.data?.error?.errors?.[0]?.reason;

      const isRateLimit =
        status === 429 ||
        (status === 403 &&
          (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded"));
      const isTransient =
        status === 500 || status === 502 || status === 503 || status === 504;

      if ((isRateLimit || isTransient) && attempt < MAX_RETRIES) {
        attempt++;
        // Exponential backoff with ±20% jitter
        const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        const jitter = base * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.round(base + jitter);
        log.warn(
          "RETRY",
          `${context} — ${isRateLimit ? "rate limited" : "transient error"} ` +
          `(attempt ${attempt}/${MAX_RETRIES}). Retrying in ${delay}ms...`,
        );
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Gmail client factory ──────────────────────────────────────────────────────
async function createGmailClient(email) {
  const creds = await AccountCredentials.findOne({ email, authorized: true });

  if (!creds) {
    throw new Error(
      `No authorized credentials found for ${email}. ` +
      "Visit the dashboard to complete the OAuth flow.",
    );
  }
  if (!creds.refreshToken) {
    throw new Error(
      `Refresh token missing for ${email}. ` +
      "Re-authorize the account from the dashboard.",
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    refresh_token: creds.refreshToken,
    access_token: creds.accessToken || undefined,
    expiry_date: creds.tokenExpiry ? creds.tokenExpiry.getTime() : undefined,
  });

  // Persist refreshed access tokens back to DB automatically
  oauth2Client.on("tokens", async (tokens) => {
    log.oauthTokenRefresh(email);
    const update = {
      accessToken: tokens.access_token,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    };
    if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;

    try {
      await AccountCredentials.updateOne({ email }, { $set: update });
      log.debug("AUTH", `Token refresh persisted to DB for ${email}`);
    } catch (dbErr) {
      log.warn("AUTH", `Failed to persist refreshed token for ${email}: ${dbErr.message}`);
    }
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

// ── Sync lock helpers ─────────────────────────────────────────────────────────
async function acquireLock(email) {
  const staleThreshold = new Date(Date.now() - LOCK_TTL_MS);

  const result = await AccountCredentials.findOneAndUpdate(
    {
      email,
      authorized: true,
      $or: [
        { syncLocked: false },
        { syncLocked: true, syncLockedAt: { $lt: staleThreshold } },
      ],
    },
    { $set: { syncLocked: true, syncLockedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!result) {
    const current = await AccountCredentials.findOne({ email });
    if (current?.syncLocked && current.syncLockedAt) {
      const ageMs = Date.now() - current.syncLockedAt.getTime();
      log.warn(
        "LOCK",
        `[${email}] Sync lock held (${Math.round(ageMs / 1000)}s ago). Skipping this tick.`,
      );
    }
    return false;
  }

  log.debug("LOCK", `[${email}] Sync lock acquired`);
  return true;
}

async function releaseLock(email) {
  await AccountCredentials.updateOne(
    { email },
    { $set: { syncLocked: false, syncLockedAt: null } },
  );
  log.debug("LOCK", `[${email}] Sync lock released`);
}

// ── Label sync ────────────────────────────────────────────────────────────────
async function syncLabels(gmail, email) {
  try {
    log.info("LABELS", `[${email}] Fetching labels from Gmail API...`);
    const listRes = await withRetry(
      () => gmail.users.labels.list({ userId: "me" }),
      `[${email}] labels.list`,
    );
    const labels = listRes.data.labels || [];

    let synced = 0;
    for (const label of labels) {
      try {
        const detail = await withRetry(
          () => gmail.users.labels.get({ userId: "me", id: label.id }),
          `[${email}] labels.get(${label.id})`,
        );
        const d = detail.data;
        await GmailLabel.findOneAndUpdate(
          { account: email, labelId: d.id },
          {
            account: email,
            labelId: d.id,
            name: d.name,
            type: d.type,
            messagesTotal: d.messagesTotal,
            messagesUnread: d.messagesUnread,
            threadsTotal: d.threadsTotal,
            threadsUnread: d.threadsUnread,
            color: d.color || {},
          },
          { upsert: true },
        );
        synced++;
      } catch (labelErr) {
        log.warn(
          "LABELS",
          `[${email}] Failed to sync label "${label.name}" (${label.id}): ${labelErr.message}`,
        );
      }
    }

    log.info("LABELS", `[${email}] Synced ${synced}/${labels.length} label(s)`);
  } catch (err) {
    log.warn("LABELS", `[${email}] Label sync failed — will retry next tick: ${err.message}`);
  }
}

// ── Message helpers ───────────────────────────────────────────────────────────
async function fetchAllMessageIds(gmail, email) {
  const ids = [];
  let pageToken;

  log.info("FETCH", `[${email}] Fetching all message IDs (paginated)...`);

  do {
    const res = await withRetry(
      () =>
        gmail.users.messages.list({
          userId: "me",
          maxResults: 500,
          pageToken,
        }),
      `[${email}] messages.list`,
    );

    const msgs = res.data.messages || [];
    ids.push(...msgs.map((m) => m.id));
    pageToken = res.data.nextPageToken;

    if (ids.length % 2000 === 0 || !pageToken) {
      log.info("FETCH", `[${email}] Discovered ${ids.length} message IDs...`);
    }
  } while (pageToken);

  return ids;
}

async function processMessage(gmail, email, messageId, config) {
  try {
    const exists = await GmailEmail.exists({ gmailId: messageId });
    if (exists) return "skipped";

    const res = await withRetry(
      () =>
        gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        }),
      `[${email}] messages.get(${messageId})`,
    );

    const parsed = parseGmailMessage(res.data);

    const finalAttachments = [];
    if (config?.saveAttachments && parsed.attachments.length > 0) {
      log.debug("ATTACH", `[${email}] Processing ${parsed.attachments.length} attachment(s) for message ${messageId}`);
      for (const att of parsed.attachments) {
        const saved = await downloadAndUploadAttachment(gmail, email, messageId, att, config);
        finalAttachments.push(saved);
      }
    }

    await GmailEmail.create({
      ...parsed,
      attachments: config?.saveAttachments ? finalAttachments : [],
      syncedFromAccount: email,
    });

    return "saved";
  } catch (err) {
    if (err.code === 11000) return "skipped"; // duplicate key — safe race condition
    log.error(
      "PROCESS",
      `[${email}] Failed to process message ${messageId}: ${err.message}`,
      err,
    );
    return "error";
  }
}

async function processBatch(gmail, email, ids, config) {
  let saved = 0, skipped = 0, errors = 0;

  for (let i = 0; i < ids.length; i += MAX_CONCURRENT) {
    const batch = ids.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map((id) => processMessage(gmail, email, id, config)),
    );

    for (const r of results) {
      if (r === "saved") saved++;
      else if (r === "skipped") skipped++;
      else errors++;
    }

    const done = Math.min(i + MAX_CONCURRENT, ids.length);
    if (done % 500 === 0 || done === ids.length) {
      log.info(
        "SYNC",
        `[${email}] Progress ${done}/${ids.length} — saved: ${saved}, skipped: ${skipped}, errors: ${errors}`,
      );
    }
  }

  return { saved, skipped, errors };
}

// ── Full sync ─────────────────────────────────────────────────────────────────
async function performFullSync(gmail, email, config) {
  log.info("SYNC", `[${email}] Starting FULL sync — this may take a while for large mailboxes`);
  const start = Date.now();

  const ids = await fetchAllMessageIds(gmail, email);
  log.info("SYNC", `[${email}] Total messages in mailbox: ${ids.length}`);

  const stats = await processBatch(gmail, email, ids, config);

  // Fetch current historyId to use as start point for next incremental sync
  const profileRes = await withRetry(
    () => gmail.users.getProfile({ userId: "me" }),
    `[${email}] getProfile`,
  );
  const historyId = profileRes.data.historyId;

  await SyncState.findOneAndUpdate(
    { account: email },
    {
      account: email,
      historyId,
      lastFullSyncAt: new Date(),
      $inc: { totalEmailsSynced: stats.saved },
    },
    { upsert: true },
  );

  log.debug("SYNC", `[${email}] Stored historyId ${historyId} for next incremental sync`);

  const durationMs = Date.now() - start;
  log.accountSyncSummary(email, "FULL", stats, durationMs);

  return { ...stats, type: "full", durationMs };
}

// ── Incremental sync ──────────────────────────────────────────────────────────
async function performIncrementalSync(gmail, email, startHistoryId, config) {
  log.info("SYNC", `[${email}] Starting INCREMENTAL sync from historyId ${startHistoryId}`);
  const start = Date.now();

  let newMsgs = 0, deleted = 0, labelUpdates = 0, errors = 0;
  let latestHistoryId = startHistoryId;
  let pageToken;

  do {
    let res;
    try {
      res = await withRetry(
        () =>
          gmail.users.history.list({
            userId: "me",
            startHistoryId,
            pageToken,
            historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
          }),
        `[${email}] history.list`,
      );
    } catch (err) {
      const reason = err?.errors?.[0]?.reason;
      if (
        err.code === 404 ||
        reason === "invalidArgument" ||
        err?.response?.data?.error?.code === 404
      ) {
        log.warn(
          "SYNC",
          `[${email}] HistoryId ${startHistoryId} has expired — falling back to full sync`,
        );
        return { fullSyncNeeded: true };
      }
      throw err;
    }

    latestHistoryId = res.data.historyId || latestHistoryId;
    const history = res.data.history || [];

    log.debug("SYNC", `[${email}] Processing ${history.length} history record(s)...`);

    for (const record of history) {
      // New messages
      for (const added of record.messagesAdded || []) {
        const result = await processMessage(gmail, email, added.message.id, config);
        if (result === "saved") newMsgs++;
        else if (result === "error") errors++;
      }

      // Deleted messages — remove from DB
      for (const msg of record.messagesDeleted || []) {
        const del = await GmailEmail.deleteOne({ gmailId: msg.message.id });
        if (del.deletedCount > 0) {
          deleted++;
          log.debug("SYNC", `[${email}] Deleted message ${msg.message.id} from DB`);
        }
      }

      // Label changes (read/unread, starred, moved, etc.)
      const labelChanges = [
        ...(record.labelsAdded || []),
        ...(record.labelsRemoved || []),
      ];

      for (const change of labelChanges) {
        try {
          const msgRes = await withRetry(
            () =>
              gmail.users.messages.get({
                userId: "me",
                id: change.message.id,
                format: "minimal",
              }),
            `[${email}] messages.get(minimal)`,
          );
          const currentLabels = msgRes.data.labelIds || [];
          const updated = await GmailEmail.updateOne(
            { gmailId: change.message.id },
            {
              $set: {
                labelIds: currentLabels,
                isUnread: currentLabels.includes("UNREAD"),
                isStarred: currentLabels.includes("STARRED"),
                isInbox: currentLabels.includes("INBOX"),
                isSent: currentLabels.includes("SENT"),
                isTrash: currentLabels.includes("TRASH"),
                isSpam: currentLabels.includes("SPAM"),
                isDraft: currentLabels.includes("DRAFT"),
              },
            },
          );
          if (updated.modifiedCount > 0) labelUpdates++;
        } catch (labelErr) {
          // Message may have been deleted concurrently — safe to skip
          log.debug(
            "SYNC",
            `[${email}] Label update skipped for ${change.message.id}: ${labelErr.message}`,
          );
        }
      }
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  // Persist updated historyId for next incremental sync
  await SyncState.findOneAndUpdate(
    { account: email },
    {
      $set: { historyId: latestHistoryId },
      $inc: { totalEmailsSynced: newMsgs },
    },
    { upsert: true },
  );

  log.debug("SYNC", `[${email}] Updated historyId to ${latestHistoryId}`);

  const stats = { newMsgs, deleted, labelUpdates, errors };
  const durationMs = Date.now() - start;
  log.accountSyncSummary(email, "INCREMENTAL", stats, durationMs);

  return { ...stats, fullSyncNeeded: false, type: "incremental", durationMs };
}

// ── Per-account sync orchestrator ─────────────────────────────────────────────
async function syncAccount(email, index, total) {
  log.accountSection(email, index, total);

  const locked = await acquireLock(email);
  if (!locked) return { email, status: "skipped_locked" };

  const start = Date.now();

  try {
    const creds = await AccountCredentials.findOne({ email });
    if (creds.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      log.warn(
        "SYNC",
        `[${email}] Skipping — ${creds.consecutiveErrors} consecutive errors. ` +
        "Re-authorize from the dashboard to resume.",
      );
      return { email, status: "skipped_errors" };
    }

    // Fetch attachment/storage config fresh from DB each run so UI changes
    // take effect without a server restart.
    const config = await AppConfig.getOrCreate();
    log.info(
      "SYNC",
      `[${email}] Attachments: ${config.saveAttachments ? `enabled (${config.attachmentStorage})` : "disabled"}`,
    );

    log.info("SYNC", `[${email}] Building Gmail API client...`);
    const gmail = await createGmailClient(email);

    await syncLabels(gmail, email);

    const syncState = await SyncState.findOne({ account: email });
    let result;

    if (!syncState?.historyId) {
      log.info("SYNC", `[${email}] No prior sync state — running initial full sync`);
      result = await performFullSync(gmail, email, config);
    } else {
      result = await performIncrementalSync(gmail, email, syncState.historyId, config);
      if (result.fullSyncNeeded) {
        log.info("SYNC", `[${email}] HistoryId expired — running full sync fallback`);
        result = await performFullSync(gmail, email, config);
      }
    }

    await AccountCredentials.updateOne(
      { email },
      {
        $set: {
          lastSyncAt: new Date(),
          lastSyncError: null,
          consecutiveErrors: 0,
        },
      },
    );

    log.info("SYNC", `[${email}] Sync completed successfully in ${Date.now() - start}ms`);
    return { email, status: "ok", durationMs: Date.now() - start, result };
  } catch (err) {
    const durationMs = Date.now() - start;
    log.error("SYNC", `[${email}] Sync failed after ${durationMs}ms: ${err.message}`, err);

    await AccountCredentials.updateOne(
      { email },
      {
        $set: { lastSyncError: err.message },
        $inc: { consecutiveErrors: 1 },
      },
    );

    return { email, status: "error", error: err.message, durationMs };
  } finally {
    await releaseLock(email).catch((lockErr) =>
      log.warn("LOCK", `[${email}] Failed to release sync lock: ${lockErr.message}`),
    );
  }
}

// ── Main entry point (called by cron) ─────────────────────────────────────────
async function checkEmails() {
  const accounts = await AccountCredentials.find({ authorized: true }).sort({ email: 1 });

  if (accounts.length === 0) {
    log.warn("SYNC", "No authorized accounts found. Visit the dashboard to authorize accounts.");
    return { processed: 0, skipped: 0, errored: 0 };
  }

  log.info(
    "SYNC",
    `Starting sync for ${accounts.length} authorized account(s): ${accounts.map((a) => a.email).join(", ")}`,
  );

  const results = [];

  // Sequential to avoid Gmail API quota exhaustion
  for (let i = 0; i < accounts.length; i++) {
    const result = await syncAccount(accounts[i].email, i + 1, accounts.length);
    results.push(result);
  }

  const processed = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status.startsWith("skipped")).length;
  const errored = results.filter((r) => r.status === "error").length;

  return { processed, skipped, errored, results };
}

module.exports = { checkEmails, syncAccount };
