import { NextRequest } from "next/server";
import { connectDB, GmailEmail, GmailLabel, SyncState } from "@/lib/db";
import { gzipSync } from "zlib";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ account: string }> },
) {
  const { account: encodedAccount } = await params;
  const account = decodeURIComponent(encodedAccount);

  await connectDB();

  const [emails, labels, syncState] = await Promise.all([
    GmailEmail.find({ syncedFromAccount: account }).lean(),
    GmailLabel.find({ account }).lean(),
    SyncState.findOne({ account }).lean(),
  ]);

  const exportData = {
    /**
     * Export format version — bump this if the schema changes in a
     * breaking way so the importer can handle migrations.
     */
    version: 1,
    exportedAt: new Date().toISOString(),
    account,
    emails,
    labels,
    syncState,
  };

  const json = JSON.stringify(exportData);
  const compressed = gzipSync(Buffer.from(json, "utf-8"));

  const date = new Date().toISOString().split("T")[0];
  const filename = `mail-sync-${account}-${date}.json.gz`;

  return new Response(compressed, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(compressed.length),
    },
  });
}
