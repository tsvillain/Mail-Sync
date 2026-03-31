import { NextRequest, NextResponse } from "next/server";
import { connectDB, GmailEmail, GmailLabel, SyncState, AccountCredentials } from "@/lib/db";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ account: string }> },
) {
  const { account: encodedAccount } = await params;
  const account = decodeURIComponent(encodedAccount);

  await connectDB();

  // Verify account exists before doing anything
  const creds = await AccountCredentials.findOne({ email: account }).lean();
  if (!creds) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }

  // Delete all synced data for this account
  const [emailResult] = await Promise.all([
    GmailEmail.deleteMany({ syncedFromAccount: account }),
    GmailLabel.deleteMany({ account }),
    SyncState.deleteOne({ account }),
    AccountCredentials.deleteOne({ email: account }),
  ]);

  // Best-effort revoke on the backend sync server so it stops polling
  try {
    const serverUrl = process.env.SERVER_URL || "http://localhost:3000";
    await fetch(`${serverUrl}/auth/revoke/${encodeURIComponent(account)}`, {
      method: "POST",
    });
  } catch {
    // Non-critical — DB cleanup already done above
  }

  return NextResponse.json({
    ok: true,
    account,
    deletedEmails: emailResult.deletedCount,
  });
}
