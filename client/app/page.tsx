/**
 * app/page.tsx — Dashboard
 */

import Link from "next/link";
import { connectDB, AccountCredentials, SyncState, GmailEmail } from "@/lib/db";
import type { IAccountCredentials } from "@/lib/db";
import RevokeButton from "./RevokeButton";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import DeleteAccountButton from "./DeleteAccountButton";
import AddAccountButton from "./AddAccountButton";
import SyncNowButton from "./SyncNowButton";
import SettingsModal from "./SettingsModal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountCard {
  email: string;
  authorized: boolean;
  authStatus: "authorized" | "error" | "pending";
  authorizedAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  consecutiveErrors: number;
  lastFullSyncAt: Date | null;
  totalEmailsSynced: number;
  totalEmails: number;
  unreadCount: number;
  inEnvList: boolean;
}

// ── Data fetcher ──────────────────────────────────────────────────────────────

async function getAccountCards(): Promise<AccountCard[]> {
  await connectDB();

  const [dbAccounts, syncStates] = await Promise.all([
    AccountCredentials.find().sort({ email: 1 }).lean<IAccountCredentials[]>(),
    SyncState.find().lean(),
  ]);

  const syncMap = new Map(syncStates.map((s) => [s.account, s]));

  // Count emails for ALL accounts — imported-but-unauthorized accounts may have emails too
  const allEmails = dbAccounts.map((a) => a.email);

  const emailCountMap = new Map<string, { total: number; unread: number }>();

  if (allEmails.length > 0) {
    const counts = await Promise.all(
      allEmails.map(async (email) => {
        const [total, unread] = await Promise.all([
          GmailEmail.countDocuments({ syncedFromAccount: email }),
          GmailEmail.countDocuments({ syncedFromAccount: email, isUnread: true }),
        ]);
        return { email, total, unread };
      }),
    );
    for (const { email, total, unread } of counts) {
      emailCountMap.set(email, { total, unread });
    }
  }

  return dbAccounts.map((acc) => {
    const sync = syncMap.get(acc.email);
    const counts = emailCountMap.get(acc.email);

    let authStatus: "authorized" | "error" | "pending" = "pending";
    if (acc.authorized && acc.consecutiveErrors >= 5) authStatus = "error";
    else if (acc.authorized) authStatus = "authorized";

    return {
      email: acc.email,
      authorized: acc.authorized,
      authStatus,
      authorizedAt: acc.authorizedAt ?? null,
      lastSyncAt: acc.lastSyncAt ?? null,
      lastSyncError: acc.lastSyncError ?? null,
      consecutiveErrors: acc.consecutiveErrors ?? 0,
      lastFullSyncAt: sync?.lastFullSyncAt ?? null,
      totalEmailsSynced: sync?.totalEmailsSynced ?? 0,
      totalEmails: counts?.total ?? 0,
      unreadCount: counts?.unread ?? 0,
      inEnvList: true,
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: Date | null) {
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function getInitials(email: string) {
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AccountCard["authStatus"] }) {
  if (status === "authorized") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
        Authorized
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
        Auth Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
      Not Authorized
    </span>
  );
}

function AccountCard({ card }: { card: AccountCard }) {
  const isAuthorized = card.authStatus === "authorized";
  const isError = card.authStatus === "error";

  const avatarBg = isAuthorized
    ? "bg-teal-700"
    : isError
    ? "bg-red-500"
    : "bg-slate-400";

  return (
    <div className="bg-white border border-teal-100 rounded p-5 hover:border-teal-200 transition-colors duration-150">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-10 h-10 rounded flex items-center justify-center text-white text-sm font-semibold shrink-0 ${avatarBg}`}
        >
          {getInitials(card.email)}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-semibold text-slate-800 truncate leading-tight">{card.email}</p>
          <div className="mt-1.5">
            <StatusBadge status={card.authStatus} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-4">
        {card.totalEmails > 0 ? (
          <div className="flex items-center justify-between text-xs">
            <div className="text-slate-500">
              <span className="font-semibold text-slate-800 text-sm">{card.totalEmails.toLocaleString()}</span>
              <span className="ml-1">emails</span>
              {card.unreadCount > 0 && (
                <span className="ml-2 font-semibold text-slate-700">
                  {card.unreadCount.toLocaleString()} unread
                </span>
              )}
              {!isAuthorized && (
                <span className="ml-2 text-amber-600 font-medium">(imported)</span>
              )}
            </div>
            <div className="text-slate-400">
              {isAuthorized ? formatDate(card.lastSyncAt) : "Not syncing"}
            </div>
          </div>
        ) : isAuthorized ? (
          <p className="text-xs text-slate-400">First sync will begin shortly.</p>
        ) : (
          <p className="text-xs text-slate-400">
            {isError
              ? `${card.consecutiveErrors} consecutive errors. Re-authorize to fix.`
              : "Authorize to start syncing emails."}
          </p>
        )}
      </div>

      {/* Error details */}
      {card.lastSyncError && (
        <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2 mb-4">
          <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="truncate">{card.lastSyncError}</span>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-teal-100 mb-4" />

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {card.totalEmails > 0 && (
          <Link
            href={`/${encodeURIComponent(card.email)}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded transition-colors duration-150 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            View Emails
          </Link>
        )}

        <a
          href={`/api/server/auth/start/${encodeURIComponent(card.email)}`}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors duration-150 cursor-pointer ${
            isAuthorized
              ? "bg-slate-50 hover:bg-slate-100 text-slate-600 border border-teal-100"
              : "bg-teal-600 hover:bg-teal-700 text-white"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          {isAuthorized ? "Re-authorize" : "Authorize"}
        </a>

        {isAuthorized && <SyncNowButton email={card.email} />}
        {isAuthorized && <RevokeButton email={card.email} />}
        {isAuthorized && card.totalEmails > 0 && <ExportButton email={card.email} />}
        <DeleteAccountButton email={card.email} totalEmails={card.totalEmails} />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ authorized?: string; revoked?: string; error?: string }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const { authorized, revoked, error } = await searchParams;

  let cards: AccountCard[] = [];
  let fetchError: string | null = null;

  try {
    cards = await getAccountCards();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Failed to load accounts";
    console.error("[Dashboard] Failed to fetch accounts:", err);
  }

  const authorizedCount = cards.filter((c) => c.authStatus === "authorized").length;
  const pendingCount = cards.filter((c) => c.authStatus === "pending").length;
  const errorCount = cards.filter((c) => c.authStatus === "error").length;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header */}
      <header className="bg-white border-b border-teal-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-teal-600 rounded flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-800 leading-tight">Mail Sync</h1>
              <p className="text-[11px] text-slate-400 leading-tight">
                {authorizedCount} authorized · {pendingCount} pending
                {errorCount > 0 && <span className="text-red-500"> · {errorCount} error{errorCount > 1 ? "s" : ""}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ImportButton />
            <AddAccountButton />
            <SettingsModal />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Toasts */}
        {authorized && (
          <div className="mb-5 flex items-center gap-3 px-4 py-3 bg-white border border-emerald-200 rounded text-sm text-emerald-800">
            <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>
              <strong className="font-semibold">{decodeURIComponent(authorized)}</strong> authorized.
              Sync begins on next run.
            </span>
          </div>
        )}

        {revoked && (
          <div className="mb-5 flex items-center gap-3 px-4 py-3 bg-white border border-amber-200 rounded text-sm text-amber-800">
            <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>Access revoked for <strong className="font-semibold">{decodeURIComponent(revoked)}</strong>. Sync stopped.</span>
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-center gap-3 px-4 py-3 bg-white border border-red-200 rounded text-sm text-red-700">
            <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>An error occurred: {decodeURIComponent(error)}</span>
          </div>
        )}

        {fetchError && (
          <div className="mb-5 px-4 py-3 bg-white border border-red-200 rounded text-sm text-red-700">
            <p className="font-semibold mb-0.5">Failed to load accounts</p>
            <p className="text-xs text-red-500">{fetchError}</p>
            <p className="text-xs text-slate-400 mt-1">Check MongoDB is running and MONGODB_URI is set in client/.env.local</p>
          </div>
        )}

        {/* Account grid */}
        {!fetchError && cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            {/* Icon */}
            <div className="w-16 h-16 bg-white border border-teal-100 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
              <svg className="w-7 h-7 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>

            {/* Heading */}
            <h2 className="text-slate-800 font-semibold text-base mb-2">No accounts yet</h2>
            <p className="text-slate-400 text-sm max-w-xs mb-7">
              Connect a Gmail account to start syncing emails. You&apos;ll authorize read-only access via Google OAuth.
            </p>

            {/* CTA */}
            <AddAccountButton variant="prominent" />

            {/* Steps */}
            <div className="mt-10 grid grid-cols-3 gap-6 max-w-md text-center">
              {[
                { step: "1", label: "Enter your Gmail address" },
                { step: "2", label: "Authorize read-only access on Google" },
                { step: "3", label: "Emails sync automatically every 5 min" },
              ].map(({ step, label }) => (
                <div key={step} className="flex flex-col items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-teal-50 border border-teal-200 text-teal-600 text-xs font-bold flex items-center justify-center">
                    {step}
                  </div>
                  <p className="text-xs text-slate-400 leading-snug">{label}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((card) => (
              <AccountCard key={card.email} card={card} />
            ))}
          </div>
        )}

        {cards.length > 0 && (
          <p className="mt-10 text-center text-xs text-slate-400">
            Emails sync every 5 minutes · Stored in MongoDB
          </p>
        )}
      </main>
    </div>
  );
}
