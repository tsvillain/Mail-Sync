import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDB, GmailEmail } from "@/lib/db";
import ThreadView, { EmailMessage } from "./ThreadView";

interface PageProps {
  params: Promise<{ account: string; emailId: string }>;
  searchParams: Promise<{ filter?: string; page?: string }>;
}

export default async function ThreadPage({ params, searchParams }: PageProps) {
  const { account: encodedAccount, emailId: encodedThreadId } = await params;
  const { filter = "inbox", page = "1" } = await searchParams;

  const account = decodeURIComponent(encodedAccount);
  const threadId = decodeURIComponent(encodedThreadId);

  await connectDB();

  const rawEmails = await GmailEmail.find({
    threadId,
    syncedFromAccount: account,
  })
    .sort({ date: 1 })
    .select("gmailId from to cc date labelIds bodyHtml bodyText attachments hasAttachments subject snippet isUnread isStarred")
    .lean();

  if (!rawEmails.length) notFound();

  const subject = rawEmails[rawEmails.length - 1].subject || "(no subject)";
  const backHref = `/${encodedAccount}?filter=${filter}&page=${page}`;

  const emails: EmailMessage[] = rawEmails.map((e) => ({
    gmailId:        e.gmailId,
    from:           e.from ?? "",
    to:             e.to ?? [],
    cc:             e.cc ?? [],
    date:           e.date ? new Date(e.date).toISOString() : null,
    labelIds:       e.labelIds ?? [],
    bodyHtml:       e.bodyHtml ?? "",
    bodyText:       e.bodyText ?? "",
    isUnread:       e.isUnread ?? false,
    isStarred:      e.isStarred ?? false,
    attachments:    (e.attachments ?? []).map((a) => ({
      filename:    a.filename,
      contentType: a.contentType,
      size:        a.size,
    })),
    hasAttachments: e.hasAttachments ?? false,
  }));

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-teal-100 bg-white sticky top-0 z-10">
        <Link
          href={backHref}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm font-medium transition-colors duration-150 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <div className="flex-1" />
        <span className="text-xs text-slate-300 truncate max-w-50 hidden sm:block">{account}</span>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-8 py-8">
        <div className="flex items-baseline gap-3 mb-6">
          <h1 className="text-lg font-semibold text-slate-800 leading-snug">{subject}</h1>
          {emails.length > 1 && (
            <span className="text-xs text-slate-400 font-medium shrink-0">
              {emails.length} messages
            </span>
          )}
        </div>

        <ThreadView emails={emails} />
      </main>
    </div>
  );
}
