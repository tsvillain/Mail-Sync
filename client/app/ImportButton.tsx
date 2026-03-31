"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ImportResult {
  ok: boolean;
  error?: string;
  account?: string;
  accountCreated?: boolean;
  emailsImported?: number;
  emailsSkipped?: number;
  emailErrors?: number;
  labelsImported?: number;
  syncStateRestored?: boolean;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: ImportResult }
  | { status: "error"; message: string };

export default function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });

  function handleClick() {
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset so the same file can be picked again
    e.target.value = "";

    if (!file.name.endsWith(".json.gz")) {
      setState({ status: "error", message: "Invalid file type. Please select a .json.gz backup file." });
      return;
    }

    setState({ status: "loading" });

    try {
      const form = new FormData();
      form.append("backup", file);

      const res = await fetch("/api/import", { method: "POST", body: form });
      const data: ImportResult = await res.json();

      if (!res.ok || !data.ok) {
        setState({ status: "error", message: data.error ?? "Import failed." });
        return;
      }

      setState({ status: "success", result: data });
      router.refresh(); // reload dashboard to show newly imported account/emails
    } catch {
      setState({ status: "error", message: "Network error. Please try again." });
    }
  }

  function dismiss() {
    setState({ status: "idle" });
  }

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".json.gz"
        className="hidden"
        onChange={handleFile}
      />

      {/* Trigger button */}
      <button
        onClick={handleClick}
        disabled={state.status === "loading"}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-teal-50 text-teal-700 text-xs font-semibold rounded border border-teal-100 hover:border-teal-200 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state.status === "loading" ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Importing…
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import
          </>
        )}
      </button>

      {/* Result banner — rendered as a fixed overlay so it doesn't shift layout */}
      {(state.status === "success" || state.status === "error") && (
        <div className="fixed inset-x-0 top-4 flex justify-center px-4 z-50 pointer-events-none">
          <div
            className={`pointer-events-auto w-full max-w-md rounded border px-4 py-3 shadow-sm bg-white text-sm flex gap-3 items-start ${
              state.status === "success"
                ? "border-teal-200 text-teal-800"
                : "border-red-200 text-red-700"
            }`}
          >
            {/* Icon */}
            {state.status === "success" ? (
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
              </svg>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              {state.status === "success" ? (
                <>
                  <p className="font-semibold leading-tight">Import complete</p>
                  <p className="text-xs mt-1 text-slate-500">
                    Account: <span className="font-medium text-slate-700">{state.result.account}</span>
                    {state.result.accountCreated && (
                      <span className="ml-1 text-amber-600">(new — authorize to sync)</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-slate-500">
                    <span>
                      <span className="font-semibold text-teal-700">{state.result.emailsImported?.toLocaleString()}</span> imported
                    </span>
                    <span>
                      <span className="font-semibold text-slate-600">{state.result.emailsSkipped?.toLocaleString()}</span> already existed
                    </span>
                    {(state.result.emailErrors ?? 0) > 0 && (
                      <span>
                        <span className="font-semibold text-red-500">{state.result.emailErrors}</span> skipped (invalid)
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="font-semibold leading-tight">Import failed</p>
                  <p className="text-xs mt-0.5 text-slate-500">{state.message}</p>
                </>
              )}
            </div>

            {/* Dismiss */}
            <button
              onClick={dismiss}
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
