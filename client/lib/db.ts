/**
 * lib/db.ts
 *
 * MongoDB connection (singleton, survives Next.js hot reload) and
 * Mongoose model definitions for the Next.js frontend.
 *
 * The frontend reads directly from the same MongoDB database as the server.
 * All models are read-only from the UI's perspective.
 */

import mongoose, { Schema, model, models, Document } from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error(
    "MONGODB_URI is not set. Add it to the root .env file:\n  MONGODB_URI=mongodb://localhost:27017/gmail-sync",
  );
}

// ── Singleton connection cache (survives Next.js hot reload) ──────────────────

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

const cache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function connectDB() {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI!, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
      })
      .then((m) => m)
      .catch((err) => {
        // Reset promise on failure so the next call retries
        cache.promise = null;
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

// ── TypeScript interfaces ─────────────────────────────────────────────────────

export interface IAttachment {
  filename: string;
  contentType: string;
  size: number;
  gmailAttachmentId: string;
  savedPath: string;
}

export interface IGmailEmail extends Document {
  gmailId: string;
  threadId: string;
  historyId: string;
  internalDate: Date;
  sizeEstimate: number;
  snippet: string;
  syncedFromAccount: string;
  from: string;
  fromAddress: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string;
  subject: string;
  date: Date;
  messageId: string;
  inReplyTo: string;
  references: string[];
  bodyText: string;
  bodyHtml: string;
  labelIds: string[];
  isUnread: boolean;
  isStarred: boolean;
  isInbox: boolean;
  isSent: boolean;
  isTrash: boolean;
  isSpam: boolean;
  isDraft: boolean;
  attachments: IAttachment[];
  hasAttachments: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISyncState extends Document {
  account: string;
  historyId: string;
  lastFullSyncAt: Date;
  totalEmailsSynced: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGmailLabel extends Document {
  account: string;
  labelId: string;
  name: string;
  type: string;
  messagesTotal: number;
  messagesUnread: number;
  threadsTotal: number;
  threadsUnread: number;
  color: { textColor: string; backgroundColor: string };
}

export interface IAccountCredentials extends Document {
  email: string;
  refreshToken: string | null;
  accessToken: string | null;
  tokenExpiry: Date | null;
  authorized: boolean;
  authorizedAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  consecutiveErrors: number;
  syncLocked: boolean;
  syncLockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const AttachmentSchema = new Schema<IAttachment>(
  {
    filename: String,
    contentType: String,
    size: Number,
    gmailAttachmentId: String,
    savedPath: String,
  },
  { _id: false },
);

const GmailEmailSchema = new Schema<IGmailEmail>(
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

GmailEmailSchema.index({ syncedFromAccount: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isInbox: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isSent: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isStarred: 1, date: -1 });
GmailEmailSchema.index({ syncedFromAccount: 1, isUnread: 1, date: -1 });

const SyncStateSchema = new Schema<ISyncState>(
  {
    account: { type: String, unique: true, required: true },
    historyId: String,
    lastFullSyncAt: Date,
    totalEmailsSynced: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const GmailLabelSchema = new Schema<IGmailLabel>(
  {
    account: { type: String, index: true },
    labelId: String,
    name: String,
    type: String,
    messagesTotal: Number,
    messagesUnread: Number,
    threadsTotal: Number,
    threadsUnread: Number,
    color: { textColor: String, backgroundColor: String },
  },
  { timestamps: true },
);

GmailLabelSchema.index({ account: 1, labelId: 1 }, { unique: true });

const AccountCredentialsSchema = new Schema<IAccountCredentials>(
  {
    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    refreshToken: { type: String, default: null },
    accessToken: { type: String, default: null },
    tokenExpiry: { type: Date, default: null },
    authorized: { type: Boolean, default: false, index: true },
    authorizedAt: { type: Date, default: null },
    lastSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    consecutiveErrors: { type: Number, default: 0 },
    syncLocked: { type: Boolean, default: false },
    syncLockedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ── Models (safe for hot reload) ──────────────────────────────────────────────

export const GmailEmail =
  (models.GmailEmail as mongoose.Model<IGmailEmail>) ||
  model<IGmailEmail>("GmailEmail", GmailEmailSchema);

export const SyncState =
  (models.SyncState as mongoose.Model<ISyncState>) ||
  model<ISyncState>("SyncState", SyncStateSchema);

export const GmailLabel =
  (models.GmailLabel as mongoose.Model<IGmailLabel>) ||
  model<IGmailLabel>("GmailLabel", GmailLabelSchema);

export const AccountCredentials =
  (models.AccountCredentials as mongoose.Model<IAccountCredentials>) ||
  model<IAccountCredentials>("AccountCredentials", AccountCredentialsSchema);

// ── AppConfig (singleton) ─────────────────────────────────────────────────────

export interface IAppConfig extends Omit<Document, "_id"> {
  _id: string;
  saveAttachments: boolean;
  attachmentStorage: "disk" | "aws";
  maxAttachmentSizeBytes: number;
  aws: {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessSecret: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AppConfigSchema = new Schema<IAppConfig>(
  {
    _id: { type: String },
    saveAttachments: { type: Boolean, default: false },
    attachmentStorage: { type: String, enum: ["disk", "aws"], default: "disk" },
    maxAttachmentSizeBytes: { type: Number, default: 20 * 1024 * 1024 * 1024 },
    aws: {
      region: { type: String, default: "" },
      bucket: { type: String, default: "" },
      accessKeyId: { type: String, default: "" },
      accessSecret: { type: String, default: "" },
    },
  },
  { timestamps: true, _id: false },
);

export const AppConfig =
  (models.AppConfig as mongoose.Model<IAppConfig>) ||
  model<IAppConfig>("AppConfig", AppConfigSchema);
