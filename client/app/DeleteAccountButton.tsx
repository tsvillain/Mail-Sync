"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteAccountButton({
  email,
  totalEmails,
}: {
  email: string;
  totalEmails: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    const emailCount = totalEmails > 0 ? `${totalEmails.toLocaleString()} synced email${totalEmails !== 1 ? "s" : ""}` : "all synced emails";

    const confirmed = window.confirm(
      `⚠ Delete account "${email}"?\n\n` +
      `This will permanently delete:\n` +
      `  • ${emailCount}\n` +
      `  • All labels and sync state\n` +
      `  • OAuth access (sync will stop immediately)\n\n` +
      `This action cannot be undone.`,
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/delete/${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        alert(`Delete failed: ${data.error ?? "Unknown error"}`);
        return;
      }

      router.refresh();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-red-50 text-red-500 text-xs font-semibold rounded border border-teal-100 hover:border-red-200 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <>
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Deleting…
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </>
      )}
    </button>
  );
}
