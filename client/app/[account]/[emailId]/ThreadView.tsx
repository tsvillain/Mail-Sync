"use client";

import { useState } from "react";

export interface EmailMessage {
  gmailId: string;
  from: string;
  to: string[];
  cc: string[];
  date: string | null;
  labelIds: string[];
  bodyHtml: string;
  bodyText: string;
  isUnread: boolean;
  isStarred: boolean;
  attachments: { filename: string; contentType: string; size: number }[];
  hasAttachments: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFullDate(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function getSenderName(from: string) {
  if (!from) return "(no sender)";
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split("@")[0];
}

function avatarLetter(from: string) {
  return (getSenderName(from) || "?")[0].toUpperCase();
}

function avatarColor(from: string) {
  const colors = [
    "bg-teal-700", "bg-teal-500", "bg-teal-700",
    "bg-teal-600",  "bg-teal-500",  "bg-teal-700",
    "bg-teal-600", "bg-teal-500",
  ];
  let hash = 0;
  for (const ch of from) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith("image/")) {
    return (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (contentType === "application/pdf") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  );
}

// ── Message card ──────────────────────────────────────────────────────────────

function MessageCard({ email, defaultOpen }: { email: EmailMessage; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const senderName = getSenderName(email.from);

  return (
    <div className={`border rounded overflow-hidden transition-colors duration-150 ${
      open ? "border-teal-200 bg-white" : "border-teal-100 bg-white hover:border-teal-200"
    }`}>
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors duration-150 text-left cursor-pointer"
        aria-expanded={open}
      >
        {/* Avatar */}
        <div className={`w-8 h-8 rounded flex items-center justify-center text-white text-sm font-semibold shrink-0 ${avatarColor(email.from)}`}>
          {avatarLetter(email.from)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate ${email.isUnread ? "font-semibold text-slate-800" : "font-medium text-slate-700"}`}>
              {email.from || "(no sender)"}
            </p>
            {email.isStarred && (
              <svg className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            )}
          </div>

          {!open && (
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {email.bodyText?.slice(0, 120) || email.bodyHtml?.replace(/<[^>]+>/g, " ").slice(0, 120) || ""}
            </p>
          )}
          {open && email.to.length > 0 && (
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              to {email.to.slice(0, 3).join(", ")}
              {email.to.length > 3 && ` and ${email.to.length - 3} more`}
              {email.cc.length > 0 && ` · cc: ${email.cc.slice(0, 2).join(", ")}`}
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2.5">
          {email.hasAttachments && (
            <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          )}
          <span className="text-xs text-slate-400 whitespace-nowrap hidden sm:block">
            {formatFullDate(email.date)}
          </span>
          <svg
            className={`w-4 h-4 text-slate-300 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <>
          {/* Date on mobile */}
          <div className="px-5 pb-1 text-xs text-slate-400 sm:hidden">
            {formatFullDate(email.date)}
          </div>

          {/* Labels */}
          {email.labelIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-5 py-2.5 border-t border-teal-100">
              {email.labelIds.map((l) => (
                <span key={l} className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-teal-100">
                  {l}
                </span>
              ))}
            </div>
          )}

          {/* Attachments */}
          {email.hasAttachments && email.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-teal-100 bg-slate-50">
              {email.attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-slate-600 bg-white border border-teal-100 rounded px-3 py-2"
                >
                  <span className="text-slate-400">
                    <AttachmentIcon contentType={att.contentType || ""} />
                  </span>
                  <span className="max-w-36 truncate font-medium">
                    {att.filename || "attachment"}
                  </span>
                  {att.size > 0 && (
                    <span className="text-slate-400 shrink-0">
                      {formatFileSize(att.size)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Email body */}
          <div className="border-t border-teal-100">
            {email.bodyHtml ? (
              <iframe
                srcDoc={email.bodyHtml}
                className="w-full"
                style={{ height: "500px", minHeight: "200px" }}
                sandbox="allow-same-origin"
                title={`Email from ${senderName}`}
                loading="lazy"
              />
            ) : email.bodyText ? (
              <pre className="p-6 text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed overflow-auto max-h-150">
                {email.bodyText}
              </pre>
            ) : (
              <p className="p-8 text-sm text-slate-400 italic text-center">
                No message body.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Thread view ───────────────────────────────────────────────────────────────

export default function ThreadView({ emails }: { emails: EmailMessage[] }) {
  if (emails.length === 0) {
    return (
      <p className="text-center text-slate-400 text-sm py-10">No messages in this thread.</p>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map((email, idx) => (
        <MessageCard
          key={email.gmailId}
          email={email}
          defaultOpen={idx === emails.length - 1}
        />
      ))}
    </div>
  );
}
