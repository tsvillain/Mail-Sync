"use client";

import { useEffect, useRef, useState } from "react";

type ModalState =
  | { status: "idle" }
  | { status: "open" }
  | { status: "submitting" }
  | { status: "error"; message: string };

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function AddAccountButton({ variant = "default" }: { variant?: "default" | "prominent" }) {
  const [modal, setModal] = useState<ModalState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (modal.status === "open" || modal.status === "error") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [modal.status]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function open() {
    setEmail("");
    setTouched(false);
    setModal({ status: "open" });
  }

  function close() {
    if (modal.status === "submitting") return;
    setModal({ status: "idle" });
  }

  const emailError = touched && email.trim() && !isValidEmail(email)
    ? "Please enter a valid email address"
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);

    const trimmed = email.trim().toLowerCase();
    if (!isValidEmail(trimmed)) return;

    setModal({ status: "submitting" });

    try {
      // Pre-register the account so it shows as "pending" immediately
      const res = await fetch("/api/server/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!res.ok && res.status !== 200 && res.status !== 201) {
        const data = await res.json().catch(() => ({}));
        setModal({ status: "error", message: data.error ?? "Failed to register account. Is the server running?" });
        return;
      }

      // Navigate to OAuth — this is a full-page redirect to Google
      window.location.href = `/api/server/auth/start/${encodeURIComponent(trimmed)}`;
    } catch {
      setModal({ status: "error", message: "Network error — make sure the sync server is running on port 3000." });
    }
  }

  const isOpen = modal.status === "open" || modal.status === "submitting" || modal.status === "error";
  const isSubmitting = modal.status === "submitting";

  return (
    <>
      {/* Trigger button */}
      {variant === "prominent" ? (
        <button
          onClick={open}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors duration-150 cursor-pointer shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Gmail Account
        </button>
      ) : (
        <button
          onClick={open}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded transition-colors duration-150 cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Account
        </button>
      )}

      {/* Modal backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-50 flex items-center justify-center px-4"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-800 leading-tight">Connect Gmail Account</h2>
                  <p className="text-[11px] text-slate-400 leading-tight">Authorize read-only access via Google OAuth</p>
                </div>
              </div>
              {!isSubmitting && (
                <button
                  onClick={close}
                  className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-1 rounded"
                  aria-label="Close"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} noValidate>
              <div className="px-6 py-5 space-y-4">
                {/* Error banner */}
                {modal.status === "error" && (
                  <div className="flex items-start gap-2.5 px-3.5 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    <span>{modal.message}</span>
                  </div>
                )}

                {/* Email input */}
                <div>
                  <label htmlFor="add-account-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Gmail address
                  </label>
                  <input
                    ref={inputRef}
                    id="add-account-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setTouched(false); }}
                    onBlur={() => setTouched(true)}
                    placeholder="you@gmail.com"
                    disabled={isSubmitting}
                    autoComplete="email"
                    className={`w-full px-3.5 py-2.5 text-sm border rounded-lg outline-none transition-colors duration-150
                      placeholder:text-slate-300 text-slate-800
                      disabled:opacity-60 disabled:cursor-not-allowed
                      ${emailError
                        ? "border-red-300 focus:border-red-400 bg-red-50/30"
                        : "border-slate-200 focus:border-teal-400 bg-white hover:border-slate-300"
                      }`}
                  />
                  {emailError && (
                    <p className="mt-1.5 text-xs text-red-500">{emailError}</p>
                  )}
                </div>

                {/* Info callout */}
                <div className="flex items-start gap-2.5 px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <svg className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-xs text-slate-500 space-y-1">
                    <p>You&apos;ll be redirected to Google to grant <strong className="text-slate-700">read-only</strong> access to this inbox.</p>
                    <p>No emails are ever modified or deleted.</p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-slate-50 border-t border-slate-100">
                <button
                  type="button"
                  onClick={close}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || (touched && !!emailError)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Connecting…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Connect with Google
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
