/**
 * Mongoose schemas, models, and database connection.
 *
 * Four collections:
 *   GmailEmail          — one document per synced message
 *   SyncState           — per-account historyId for incremental sync
 *   GmailLabel          — label/folder metadata fetched from Gmail API
 *   AccountCredentials  — OAuth tokens + sync state per Gmail address
 */

const mongoose = require("mongoose");
const env = require("./env");

// ── Sub-schemas ───────────────────────────────────────────────────────────────
const AttachmentSchema = new mongoose.Schema(
  {
    filename: String,
    contentType: String,
    size: Number,
    gmailAttachmentId: String,
    savedPath: String,
  },
  { _id: false },
);

// ── GmailEmail ────────────────────────────────────────────────────────────────
const GmailEmailSchema = new mongoose.Schema(
  {
    gmailId: { type: String, unique: true, required: true },
    threadId: { type: String, index: true },
    historyId: String,
    internalDate: Date,
    sizeEstimate: Number,
    snippet: String,

    syncedFromAccount: { type: String, index: true, required: true },

    from: String,
    fromAddress: String,
    to: [String],
    cc: [String],
    bcc: [String],
    replyTo: String,
    subject: String,
    date: Date,
    messageId: String,
    inReplyTo: String,
    references: [String],

    bodyText: String,
    bodyHtml: String,

    labelIds: [String],
    isUnread: { type: Boolean, default: false, index: true },
    isStarred: { type: Boolean, default: false },
    isInbox: { type: Boolean, default: false, index: true },
    isSent: { type: Boolean, default: false, index: true },
    isTrash: { type: Boolean, default: false },
    isSpam: { type: Boolean, default: false },
    isDraft: { type: Boolean, default: false },

    attachments: [AttachmentSchema],
    hasAttachments: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Compound indexes for common query patterns
GmailEmailSchema.index({ syncedFromAccount: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, threadId: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isInbox: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isSent: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isStarred: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isUnread: 1, date: -1 });

const GmailEmail = mongoose.model("GmailEmail", GmailEmailSchema);

// ── SyncState ─────────────────────────────────────────────────────────────────
const SyncStateSchema = new mongoose.Schema(
  {
    account: { type: String, unique: true, required: true },
    historyId: String,
    lastFullSyncAt: Date,
    totalEmailsSynced: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const SyncState = mongoose.model("SyncState", SyncStateSchema);

// ── GmailLabel ────────────────────────────────────────────────────────────────
const GmailLabelSchema = new mongoose.Schema(
  {
    account: { type: String, index: true },
    labelId: String,
    name: String,
    type: String,
    messagesTotal: Number,
    messagesUnread: Number,
    threadsTotal: Number,
    threadsUnread: Number,
    color: {
      textColor: String,
      backgroundColor: String,
    },
  },
  { timestamps: true },
);

GmailLabelSchema.index({ account: 1, labelId: 1 }, { unique: true });

const GmailLabel = mongoose.model("GmailLabel", GmailLabelSchema);

// ── AccountCredentials ────────────────────────────────────────────────────────
const AccountCredentialsSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
    },

    // OAuth tokens written by the auth server after consent
    refreshToken: { type: String, default: null },
    accessToken: { type: String, default: null },
    tokenExpiry: { type: Date, default: null },

    // true once the user has completed the OAuth consent flow
    authorized: { type: Boolean, default: false, index: true },
    authorizedAt: { type: Date, default: null },

    // Populated after each sync attempt
    lastSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    consecutiveErrors: { type: Number, default: 0 },

    // Sync lock — prevents two cron ticks from processing the same account
    // A lock older than SYNC_LOCK_TTL_MS is considered stale and auto-released
    syncLocked: { type: Boolean, default: false },
    syncLockedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// 30-minute stale lock threshold
AccountCredentialsSchema.statics.SYNC_LOCK_TTL_MS = 30 * 60 * 1000;

const AccountCredentials = mongoose.model(
  "AccountCredentials",
  AccountCredentialsSchema,
);

// ── AppConfig (singleton) ─────────────────────────────────────────────────────
// Stores user-configurable settings persisted in MongoDB.
// Only one document ever exists (id = "singleton").

const SINGLETON_ID = "singleton";

const AppConfigSchema = new mongoose.Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    saveAttachments: { type: Boolean, default: false },
    // "disk" → save to local filesystem; "aws" → upload to S3
    attachmentStorage: {
      type: String,
      enum: ["disk", "aws"],
      default: "disk",
    },
    // Max attachment size in bytes. 0 = no limit. Default: 20 GB.
    maxAttachmentSizeBytes: {
      type: Number,
      default: 20 * 1024 * 1024 * 1024,
      min: 0,
    },
    aws: {
      region: { type: String, default: "" },
      bucket: { type: String, default: "" },
      accessKeyId: { type: String, default: "" },
      accessSecret: { type: String, default: "" },
    },
  },
  { timestamps: true, _id: false },
);

// Fetch the singleton, creating it with defaults if it doesn't exist yet.
AppConfigSchema.statics.getOrCreate = async function () {
  let doc = await this.findById(SINGLETON_ID);
  if (!doc) {
    doc = await this.create({ _id: SINGLETON_ID });
  }
  return doc;
};

const AppConfig = mongoose.model("AppConfig", AppConfigSchema);

// ── Connection ────────────────────────────────────────────────────────────────
async function connectDB() {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });
}

module.exports = {
  connectDB,
  GmailEmail,
  SyncState,
  GmailLabel,
  AccountCredentials,
  AppConfig,
};
