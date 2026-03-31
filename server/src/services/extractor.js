/**
 * Gmail message parsing and attachment handling.
 *
 * parseGmailMessage()             — converts raw Gmail API response to a flat document
 * downloadAndUploadAttachment()   — downloads attachment from Gmail, saves to disk or S3
 *
 * Attachment config is passed at call-time (fetched from AppConfig in DB) rather than
 * read from env vars, so settings take effect on the next sync without a server restart.
 */

const path = require("path");
const fs = require("fs/promises");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const log = require("../utils/logger");

// Project-root attachments directory (backup_full_gmail/attachments/)
const ATTACHMENTS_ROOT = path.join(__dirname, "..", "..", "..", "attachments");

// ── S3 client factory (created per-config, not module-level) ──────────────────
function makeS3Client(awsCfg) {
  if (!awsCfg?.region || !awsCfg?.bucket || !awsCfg?.accessKeyId || !awsCfg?.accessSecret) {
    return null;
  }
  return new S3Client({
    region: awsCfg.region,
    credentials: {
      accessKeyId: awsCfg.accessKeyId,
      secretAccessKey: awsCfg.accessSecret,
    },
  });
}

// ── Header helpers ────────────────────────────────────────────────────────────
function getHeader(headers, name) {
  const h = (headers || []).find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return h ? h.value : "";
}

// ── Recursively extract body from MIME parts ──────────────────────────────────
function extractBodyFromParts(parts, mimeType) {
  if (!parts) return "";
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.parts) {
      const nested = extractBodyFromParts(part.parts, mimeType);
      if (nested) return nested;
    }
  }
  return "";
}

// ── Recursively collect attachment metadata from MIME parts ───────────────────
function collectAttachments(parts, attachments = []) {
  if (!parts) return attachments;
  for (const part of parts) {
    if (part.filename && part.filename.length > 0) {
      attachments.push({
        filename: part.filename,
        contentType: part.mimeType || "application/octet-stream",
        size: part.body?.size || 0,
        gmailAttachmentId: part.body?.attachmentId || null,
        savedPath: null,
      });
    }
    if (part.parts) {
      collectAttachments(part.parts, attachments);
    }
  }
  return attachments;
}

// ── Parse a Gmail API message (format: "full") ────────────────────────────────
function parseGmailMessage(msg) {
  const headers = msg.payload?.headers || [];
  const labelIds = msg.labelIds || [];

  const fromRaw = getHeader(headers, "From");
  const fromMatch = fromRaw.match(/<(.+?)>/);
  const fromAddress = (fromMatch ? fromMatch[1] : fromRaw).toLowerCase().trim();

  const toRaw = getHeader(headers, "To");
  const ccRaw = getHeader(headers, "Cc");
  const bccRaw = getHeader(headers, "Bcc");
  const referencesRaw = getHeader(headers, "References");

  // Body extraction — handles plain, HTML, and multipart
  let bodyText = "";
  let bodyHtml = "";
  const { mimeType, body, parts } = msg.payload || {};

  if (mimeType === "text/plain" && body?.data) {
    bodyText = Buffer.from(body.data, "base64url").toString("utf-8");
  } else if (mimeType === "text/html" && body?.data) {
    bodyHtml = Buffer.from(body.data, "base64url").toString("utf-8");
  } else if (parts) {
    bodyText = extractBodyFromParts(parts, "text/plain");
    bodyHtml = extractBodyFromParts(parts, "text/html");
  }

  const attachments = parts ? collectAttachments(parts) : [];
  const internalDate = msg.internalDate
    ? new Date(parseInt(msg.internalDate, 10))
    : null;

  const dateHeader = getHeader(headers, "Date");
  const date = dateHeader ? new Date(dateHeader) : internalDate;

  const referencesArr = referencesRaw
    ? referencesRaw.trim().split(/\s+/).filter(Boolean)
    : [];

  return {
    gmailId: msg.id,
    threadId: msg.threadId,
    historyId: msg.historyId,
    internalDate,
    sizeEstimate: msg.sizeEstimate || 0,
    snippet: msg.snippet || "",

    from: fromRaw,
    fromAddress,
    to: toRaw ? toRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    cc: ccRaw ? ccRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    bcc: bccRaw ? bccRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    replyTo: getHeader(headers, "Reply-To"),
    subject: getHeader(headers, "Subject"),
    date,
    messageId: getHeader(headers, "Message-ID"),
    inReplyTo: getHeader(headers, "In-Reply-To"),
    references: referencesArr,

    // Cap body sizes to stay under MongoDB's 16 MB document limit
    bodyText: bodyText.slice(0, 200_000),
    bodyHtml: bodyHtml.slice(0, 1_000_000),

    labelIds,
    isUnread: labelIds.includes("UNREAD"),
    isStarred: labelIds.includes("STARRED"),
    isInbox: labelIds.includes("INBOX"),
    isSent: labelIds.includes("SENT"),
    isTrash: labelIds.includes("TRASH"),
    isSpam: labelIds.includes("SPAM"),
    isDraft: labelIds.includes("DRAFT"),

    attachments,
    hasAttachments: attachments.length > 0,
  };
}

// ── Sanitize a filename for safe filesystem/S3 key use ────────────────────────
function sanitizeFilename(name) {
  return (name || "attachment")
    .replace(/[^a-zA-Z0-9._\-() ]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200);
}

// ── Save attachment buffer to disk ────────────────────────────────────────────
async function saveToDisk(account, messageId, filename, buffer) {
  // Sanitize the account email for use as a directory name (replace @ and . with _)
  const accountDir = account.replace(/[@.]/g, "_").replace(/[^a-zA-Z0-9_\-]/g, "_");
  const msgDir = path.join(ATTACHMENTS_ROOT, accountDir, messageId);
  await fs.mkdir(msgDir, { recursive: true });

  const safeName = sanitizeFilename(filename);
  const filePath = path.join(msgDir, safeName);

  // Avoid overwriting if a file with the same name already exists
  let finalPath = filePath;
  try {
    await fs.access(filePath);
    // File exists — append a timestamp suffix
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    finalPath = path.join(msgDir, `${base}_${Date.now()}${ext}`);
  } catch {
    // File does not exist — use the original path
  }

  await fs.writeFile(finalPath, buffer);
  return finalPath;
}

// ── Download attachment from Gmail API and persist based on config ────────────
//
// @param {object} gmail       — authenticated Gmail API client
// @param {string} messageId   — Gmail message ID
// @param {object} attachment  — attachment metadata from parseGmailMessage
// @param {object} config      — AppConfig document from MongoDB
//   config.attachmentStorage  — "disk" | "aws"
//   config.aws                — { region, bucket, accessKeyId, accessSecret }

// ── Human-readable byte size ──────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function downloadAndUploadAttachment(gmail, account, messageId, attachment, config) {
  if (!attachment.gmailAttachmentId) return attachment;

  const limitBytes = config?.maxAttachmentSizeBytes ?? 0;

  // Pre-flight size check using Gmail metadata (size may be 0 if unknown — skip check then)
  if (limitBytes > 0 && attachment.size > 0 && attachment.size > limitBytes) {
    log.info(
      "ATTACH",
      `Skipping "${attachment.filename}" — metadata size ${formatBytes(attachment.size)} exceeds limit ${formatBytes(limitBytes)}`,
    );
    return attachment;
  }

  try {
    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachment.gmailAttachmentId,
    });

    const data = res.data.data;
    if (!data) {
      log.warn("ATTACH", `Empty attachment data for "${attachment.filename}" on message ${messageId}`);
      return attachment;
    }

    const buffer = Buffer.from(data, "base64url");

    // Post-download size check — catches cases where metadata size was 0 or inaccurate
    if (limitBytes > 0 && buffer.length > limitBytes) {
      log.info(
        "ATTACH",
        `Skipping save for "${attachment.filename}" — actual size ${formatBytes(buffer.length)} exceeds limit ${formatBytes(limitBytes)}`,
      );
      return { ...attachment, size: buffer.length }; // record real size but don't persist
    }

    // ── AWS S3 ────────────────────────────────────────────────────────────────
    if (config?.attachmentStorage === "aws") {
      const s3 = makeS3Client(config.aws);

      if (!s3) {
        log.warn(
          "ATTACH",
          `AWS storage selected but credentials are incomplete — skipping "${attachment.filename}". ` +
          "Update AWS settings in the dashboard.",
        );
        return { ...attachment, size: buffer.length };
      }

      const safeName = sanitizeFilename(attachment.filename);
      const key = `gmail-attachments/${account}/${messageId}/${safeName}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: config.aws.bucket,
          Key: key,
          Body: buffer,
          ContentType: attachment.contentType || "application/octet-stream",
        }),
      );

      const savedPath = `s3://${config.aws.bucket}/${key}`;
      log.info(
        "ATTACH",
        `Uploaded "${attachment.filename}" (${(buffer.length / 1024).toFixed(1)} KB) → ${savedPath}`,
      );
      return { ...attachment, savedPath, size: buffer.length };
    }

    // ── Disk ──────────────────────────────────────────────────────────────────
    if (config?.attachmentStorage === "disk") {
      const filePath = await saveToDisk(account, messageId, attachment.filename, buffer);
      const savedPath = `disk://${filePath}`;
      log.info(
        "ATTACH",
        `Saved "${attachment.filename}" (${(buffer.length / 1024).toFixed(1)} KB) → ${filePath}`,
      );
      return { ...attachment, savedPath, size: buffer.length };
    }

    // Fallback — no storage configured
    log.debug("ATTACH", `No storage target configured — skipping save for "${attachment.filename}"`);
    return { ...attachment, size: buffer.length };
  } catch (err) {
    log.warn(
      "ATTACH",
      `Failed to process attachment "${attachment.filename}" on message ${messageId}: ${err.message}`,
    );
    return attachment;
  }
}

module.exports = { parseGmailMessage, downloadAndUploadAttachment };
