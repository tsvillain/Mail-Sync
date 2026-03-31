"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; message: string };

export default function SyncNowButton({ email }: { email: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });

  // Auto-dismiss toast after 4s and refresh dashboard so stats update
  useEffect(() => {
    if (state.status !== "success" && state.status !== "error") return;
    const t = setTimeout(() => {
      setState({ status: "idle" });
      if (state.status === "success") router.refresh();
    }, 4000);
    return () => clearTimeout(t);
  }, [state.status, router]);

  async function handleSync() {
    if (state.status === "loading") return;
    setState({ status: "loading" });

    try {
      const res = await fetch(
        `/api/server/api/accounts/${encodeURIComponent(email)}/sync`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));

      if (res.status === 202) {
        setState({ status: "success" });
        return;
      }

      setState({
        status: "error",
        message: data.error ?? `Unexpected response (${res.status})`,
      });
    } catch {
      setState({ status: "error", message: "Network error — is the sync server running?" });
    }
  }

  const isLoading = state.status === "loading";

  return (
    <>
      <button
        onClick={handleSync}
        disabled={isLoading}
        title="Sync this account now"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-teal-50 text-teal-700 text-xs font-semibold rounded border border-teal-100 hover:border-teal-200 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg
          className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {isLoading ? "Syncing…" : "Sync Now"}
      </button>

      {/* Toast */}
      {(state.status === "success" || state.status === "error") && (
        <div className="fixed inset-x-0 top-4 flex justify-center px-4 z-50 pointer-events-none">
          <div
            className={`pointer-events-auto w-full max-w-sm rounded-lg border px-4 py-3 shadow-md bg-white text-sm flex items-start gap-3 ${
              state.status === "success"
                ? "border-teal-200 text-teal-800"
                : "border-red-200 text-red-700"
            }`}
          >
            {state.status === "success" ? (
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            )}

            <div className="flex-1 min-w-0">
              {state.status === "success" ? (
                <>
                  <p className="font-semibold leading-tight">Sync started</p>
                  <p className="text-xs mt-0.5 text-slate-500 truncate">{email}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold leading-tight">Sync failed</p>
                  <p className="text-xs mt-0.5 text-slate-500">{state.message}</p>
                </>
              )}
            </div>

            <button
              onClick={() => setState({ status: "idle" })}
              className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
