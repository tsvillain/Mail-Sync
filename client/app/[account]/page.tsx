import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDB, GmailEmail, GmailLabel, SyncState, AccountCredentials } from "@/lib/db";

const PAGE_SIZE = 50;

const SYSTEM_LABELS = [
  { key: "inbox",   label: "Inbox",    field: "isInbox"   as const },
  { key: "starred", label: "Starred",  field: "isStarred" as const },
  { key: "sent",    label: "Sent",     field: "isSent"    as const },
  { key: "drafts",  label: "Drafts",   field: "isDraft"   as const },
  { key: "spam",    label: "Spam",     field: "isSpam"    as const },
  { key: "trash",   label: "Trash",    field: "isTrash"   as const },
  { key: "all",     label: "All Mail", field: null },
];

type FilterKey = "inbox" | "starred" | "sent" | "drafts" | "spam" | "trash" | "all";

function buildQuery(account: string, filter: FilterKey) {
  const base: Record<string, unknown> = { syncedFromAccount: account };
  const found = SYSTEM_LABELS.find((l) => l.key === filter);
  if (found?.field) base[found.field] = true;
  return base;
}

function formatEmailDate(date: Date | null) {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getSenderName(from: string) {
  if (!from) return "(no sender)";
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split("@")[0];
}

interface ThreadRow {
  _id: string;
  latestDate: Date;
  latestFrom: string;
  subject: string;
  snippet: string;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  isStarred: boolean;
}

interface PageProps {
  params: Promise<{ account: string }>;
  searchParams: Promise<{ filter?: string; page?: string }>;
}

export default async function AccountPage({ params, searchParams }: PageProps) {
  const { account: encodedAccount } = await params;
  const { filter: rawFilter, page: rawPage } = await searchParams;

  const account = decodeURIComponent(encodedAccount);
  const filter = (rawFilter ?? "inbox") as FilterKey;
  const page = Math.max(1, parseInt(rawPage ?? "1", 10));

  await connectDB();

  const creds = await AccountCredentials.findOne({ email: account }).lean();
  if (!creds) notFound();

  const query = buildQuery(account, filter);

  const [totalAgg, threads, labels, syncState] = await Promise.all([
    GmailEmail.aggregate([
      { $match: query },
      { $group: { _id: "$threadId" } },
      { $count: "total" },
    ]),
    GmailEmail.aggregate([
      { $match: query },
      { $sort: { date: -1 } },
      {
        $group: {
          _id:            "$threadId",
          latestDate:     { $first: "$date" },
          latestFrom:     { $first: "$from" },
          subject:        { $first: "$subject" },
          snippet:        { $first: "$snippet" },
          messageCount:   { $sum: 1 },
          unreadCount:    { $sum: { $cond: ["$isUnread", 1, 0] } },
          hasAttachments: { $max: "$hasAttachments" },
          isStarred:      { $max: "$isStarred" },
        },
      },
      { $sort: { latestDate: -1 } },
      { $skip: (page - 1) * PAGE_SIZE },
      { $limit: PAGE_SIZE },
    ]) as Promise<ThreadRow[]>,
    GmailLabel.find({ account }).lean(),
    SyncState.findOne({ account }).lean(),
  ]);

  const total: number = (totalAgg as { total: number }[])[0]?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  const labelMap = new Map(labels.map((l) => [l.labelId, l]));
  const inboxUnread = labelMap.get("INBOX")?.messagesUnread ?? 0;

  function buildHref(f: string, p = 1) {
    return `/${encodedAccount}?filter=${f}&page=${p}`;
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-5 py-3.5 border-b border-teal-100 bg-white sticky top-0 z-10">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm font-medium transition-colors duration-150 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 truncate max-w-50 hidden sm:block">{account}</span>
          {syncState?.lastFullSyncAt && (
            <span className="text-xs text-slate-300 hidden md:block">
              Synced {formatEmailDate(syncState.lastFullSyncAt)}
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-48 shrink-0 border-r border-teal-100 bg-white pt-4 hidden sm:block sticky top-14.25 self-start h-[calc(100vh-57px)] overflow-y-auto">
          <div className="px-3 mb-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-2">Folders</p>
          </div>
          <nav className="space-y-0.5 px-2">
            {SYSTEM_LABELS.map(({ key, label }) => {
              const isActive = filter === key;
              const unread = key === "inbox" ? inboxUnread : 0;
              return (
                <Link
                  key={key}
                  href={buildHref(key)}
                  className={`flex items-center justify-between px-3 py-2 rounded text-sm transition-colors duration-150 cursor-pointer ${
                    isActive
                      ? "bg-teal-600 text-white font-semibold"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  <span>{label}</span>
                  {unread > 0 && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                    }`}>
                      {unread.toLocaleString()}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Thread list */}
        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-teal-100">
            <span className="text-xs text-slate-400 font-medium">
              {total === 0
                ? "No threads"
                : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-0.5">
              <Link
                href={buildHref(filter, page - 1)}
                aria-disabled={page <= 1}
                className={`p-1.5 rounded transition-colors duration-150 ${
                  page <= 1
                    ? "pointer-events-none text-slate-200"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <Link
                href={buildHref(filter, page + 1)}
                aria-disabled={page >= totalPages}
                className={`p-1.5 rounded transition-colors duration-150 ${
                  page >= totalPages
                    ? "pointer-events-none text-slate-200"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Mobile label tabs */}
          <div className="flex gap-1.5 px-4 py-2.5 border-b border-teal-100 overflow-x-auto sm:hidden">
            {SYSTEM_LABELS.map(({ key, label }) => (
              <Link
                key={key}
                href={buildHref(key)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded font-medium transition-colors duration-150 cursor-pointer ${
                  filter === key
                    ? "bg-teal-600 text-white"
                    : "text-slate-500 bg-slate-100 hover:bg-slate-100"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Thread rows */}
          {threads.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-11 h-11 bg-slate-50 border border-teal-100 rounded flex items-center justify-center">
                <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-slate-400 text-sm">No threads in this folder</p>
            </div>
          ) : (
            <ul className="divide-y divide-teal-50">
              {(threads as ThreadRow[]).map((thread) => {
                const isUnread = thread.unreadCount > 0;
                return (
                  <li key={thread._id}>
                    <Link
                      href={`/${encodedAccount}/${encodeURIComponent(thread._id)}?filter=${filter}&page=${page}`}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 transition-colors duration-150 cursor-pointer"
                    >
                      {/* Unread dot */}
                      <div className="shrink-0 w-2 flex justify-center">
                        {isUnread && <div className="w-1.5 h-1.5 rounded-full bg-teal-700" />}
                      </div>

                      {/* Star */}
                      <div className="shrink-0">
                        <svg
                          className={`w-3.5 h-3.5 ${thread.isStarred ? "text-amber-400 fill-amber-400" : "text-slate-200 fill-none"}`}
                          stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                          />
                        </svg>
                      </div>

                      {/* Sender */}
                      <div className={`shrink-0 w-36 truncate text-sm ${isUnread ? "font-semibold text-slate-800" : "text-slate-500"}`}>
                        {getSenderName(thread.latestFrom)}
                        {thread.messageCount > 1 && (
                          <span className={`ml-1 text-xs ${isUnread ? "text-slate-500" : "text-slate-300"}`}>
                            {thread.messageCount}
                          </span>
                        )}
                      </div>

                      {/* Subject + snippet */}
                      <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                        <span className={`shrink-0 text-sm truncate ${isUnread ? "font-semibold text-slate-800" : "text-slate-600"}`}>
                          {thread.subject || "(no subject)"}
                        </span>
                        <span className="text-sm text-slate-300 truncate hidden md:block">
                          {thread.snippet}
                        </span>
                      </div>

                      {/* Attachment */}
                      {thread.hasAttachments && (
                        <svg className="shrink-0 w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      )}

                      {/* Date */}
                      <div className={`shrink-0 text-xs w-20 text-right ${isUnread ? "font-semibold text-slate-700" : "text-slate-400"}`}>
                        {formatEmailDate(thread.latestDate)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-teal-100 text-xs text-slate-400">
              <span>Page {page} of {totalPages.toLocaleString()}</span>
              <Link
                href={buildHref(filter, page - 1)}
                aria-disabled={page <= 1}
                className={`px-3 py-1.5 rounded border font-medium transition-colors duration-150 ${
                  page <= 1
                    ? "pointer-events-none text-slate-200 border-teal-100"
                    : "text-slate-500 border-teal-100 hover:bg-slate-50 cursor-pointer"
                }`}
              >
                Prev
              </Link>
              <Link
                href={buildHref(filter, page + 1)}
                aria-disabled={page >= totalPages}
                className={`px-3 py-1.5 rounded border font-medium transition-colors duration-150 ${
                  page >= totalPages
                    ? "pointer-events-none text-slate-200 border-teal-100"
                    : "text-slate-500 border-teal-100 hover:bg-slate-50 cursor-pointer"
                }`}
              >
                Next
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
