import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import mongoose from "mongoose";
import {
  connectDB,
  GmailEmail,
  GmailLabel,
  SyncState,
  AccountCredentials,
} from "@/lib/db";

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// ── POST /api/import ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return err("Failed to parse request. Send multipart/form-data with a 'backup' file field.");
  }

  const file = formData.get("backup");
  if (!(file instanceof File)) return err("No backup file provided.");
  if (file.size === 0) return err("The backup file is empty.");
  if (file.size > 500 * 1024 * 1024) return err("File too large (max 500 MB).");

  // Decompress gzip
  const raw = Buffer.from(await file.arrayBuffer());
  let json: string;
  try {
    json = gunzipSync(raw).toString("utf-8");
  } catch {
    return err("Failed to decompress file. The file may be corrupt or not gzip-compressed.");
  }

  // Parse JSON
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    return err("Failed to parse backup file — invalid JSON after decompression.");
  }

  // ── Schema validation ───────────────────────────────────────────────────────

  if (typeof data.version !== "number") {
    return err("Invalid backup file: missing version field.");
  }
  if (data.version !== 1) {
    return err(`Unsupported backup version ${data.version}. This app supports version 1.`);
  }
  if (typeof data.account !== "string" || !data.account.includes("@")) {
    return err("Invalid backup file: missing or malformed account field.");
  }
  if (!Array.isArray(data.emails)) {
    return err("Invalid backup file: emails field must be an array.");
  }

  const account = data.account as string;
  const emails = data.emails as Record<string, unknown>[];
  const labels = Array.isArray(data.labels) ? (data.labels as Record<string, unknown>[]) : [];
  const syncState =
    data.syncState && typeof data.syncState === "object"
      ? (data.syncState as Record<string, unknown>)
      : null;

  await connectDB();

  // ── Ensure account exists ───────────────────────────────────────────────────

  let accountCreated = false;
  const existingAccount = await AccountCredentials.findOne({ email: account }).lean();
  if (!existingAccount) {
    await AccountCredentials.create({
      email: account,
      authorized: false,
      consecutiveErrors: 0,
      createdAt: new Date(),
    });
    accountCreated = true;
  }

  // ── Prepare email documents ─────────────────────────────────────────────────
  // Use collection.insertMany with ordered:false — MongoDB's unique index on
  // gmailId automatically skips duplicates, giving us accurate counts without
  // per-document round-trips.

  let emailsInvalid = 0;
  const validDocs: Record<string, unknown>[] = [];

  for (const email of emails) {
    if (typeof email.gmailId !== "string" || !email.gmailId) {
      emailsInvalid++;
      continue;
    }

    const doc: Record<string, unknown> = { ...email, syncedFromAccount: account };

    // Restore _id as ObjectId so reimporting the same backup is idempotent
    if (typeof doc._id === "string") {
      try {
        doc._id = new mongoose.Types.ObjectId(doc._id);
      } catch {
        delete doc._id; // not a valid ObjectId hex — let Mongo assign a new one
      }
    } else {
      delete doc._id;
    }

    // Restore Date fields that JSON serialises as ISO strings
    for (const field of ["date", "internalDate", "createdAt", "updatedAt"]) {
      if (typeof doc[field] === "string") {
        const d = new Date(doc[field] as string);
        doc[field] = isNaN(d.getTime()) ? null : d;
      }
    }

    validDocs.push(doc);
  }

  // ── Bulk insert emails ──────────────────────────────────────────────────────

  let emailsImported = 0;
  let emailsSkipped = 0;

  if (validDocs.length > 0) {
    try {
      const result = await GmailEmail.collection.insertMany(validDocs, {
        ordered: false, // continue on duplicate key errors
      });
      emailsImported = result.insertedCount;
      emailsSkipped = validDocs.length - emailsImported;
    } catch (bulkErr: unknown) {
      // MongoBulkWriteError when some (or all) docs are duplicates
      const e = bulkErr as { code?: number; insertedCount?: number; result?: { insertedCount?: number } };
      if (e.code === 11000 || (e as { writeErrors?: unknown[] }).writeErrors) {
        const inserted = e.insertedCount ?? e.result?.insertedCount ?? 0;
        emailsImported = inserted;
        emailsSkipped = validDocs.length - inserted;
      } else {
        return NextResponse.json(
          { ok: false, error: `Import failed: ${(bulkErr as Error).message}` },
          { status: 500 },
        );
      }
    }
  }

  // ── Import labels ───────────────────────────────────────────────────────────

  let labelsImported = 0;
  for (const label of labels) {
    if (typeof label.labelId !== "string" || !label.labelId) continue;

    const doc: Record<string, unknown> = { ...label, account };
    delete doc._id;

    try {
      const result = await GmailLabel.updateOne(
        { account, labelId: label.labelId },
        { $setOnInsert: doc },
        { upsert: true },
      );
      if (result.upsertedCount > 0) labelsImported++;
    } catch {
      // Non-critical — skip silently
    }
  }

  // ── Restore sync state ──────────────────────────────────────────────────────

  let syncStateRestored = false;
  if (syncState) {
    const doc: Record<string, unknown> = { ...syncState, account };
    delete doc._id;

    const existingSync = await SyncState.findOne({ account }).lean();
    const backupDate = syncState.lastFullSyncAt
      ? new Date(syncState.lastFullSyncAt as string)
      : null;
    const existingDate = existingSync?.lastFullSyncAt
      ? new Date(existingSync.lastFullSyncAt)
      : null;

    if (!existingDate || (backupDate && backupDate > existingDate)) {
      await SyncState.updateOne({ account }, { $set: doc }, { upsert: true });
      syncStateRestored = true;
    }
  }

  return NextResponse.json({
    ok: true,
    account,
    accountCreated,
    emailsImported,
    emailsSkipped,
    emailErrors: emailsInvalid,
    labelsImported,
    syncStateRestored,
  });
}
