"use client";

import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SizeUnit = "KB" | "MB" | "GB";

const UNIT_BYTES: Record<SizeUnit, number> = {
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
};

/** Convert a byte value to the most appropriate display unit + value */
function bytesToDisplay(bytes: number): { value: string; unit: SizeUnit } {
  if (bytes >= UNIT_BYTES.GB && bytes % UNIT_BYTES.GB === 0) {
    return { value: String(bytes / UNIT_BYTES.GB), unit: "GB" };
  }
  if (bytes >= UNIT_BYTES.MB && bytes % UNIT_BYTES.MB === 0) {
    return { value: String(bytes / UNIT_BYTES.MB), unit: "MB" };
  }
  return { value: String(Math.ceil(bytes / UNIT_BYTES.KB)), unit: "KB" };
}

function displayToBytes(value: string, unit: SizeUnit): number {
  const num = parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * UNIT_BYTES[unit]);
}

interface Settings {
  saveAttachments: boolean;
  attachmentStorage: "disk" | "aws";
  maxSizeValue: string;   // display value, e.g. "20"
  maxSizeUnit: SizeUnit;  // "KB" | "MB" | "GB"
  aws: {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessSecret: string;   // empty = keep existing stored value
    accessSecretSet: boolean; // whether a secret is already stored
  };
}

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

// ── Field component ───────────────────────────────────────────────────────────

function Field({
  label,
  id,
  type = "text",
  value,
  placeholder,
  onChange,
  disabled,
  error,
  hint,
  autoComplete,
}: {
  label: string;
  id: string;
  type?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: string | null;
  hint?: string;
  autoComplete?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && !revealed ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          className={`w-full px-3.5 py-2.5 text-sm border rounded-lg outline-none transition-all duration-150
            placeholder:text-slate-300 text-slate-800 font-mono
            disabled:opacity-50 disabled:cursor-not-allowed
            ${isPassword ? "pr-10" : ""}
            ${error
              ? "border-red-300 bg-red-50/40 focus:border-red-400 focus:ring-2 focus:ring-red-100"
              : "border-slate-200 bg-white hover:border-slate-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            aria-label={revealed ? "Hide" : "Show"}
          >
            {revealed ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1"><span>⚠</span>{error}</p>}
      {hint && !error && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
        ${checked ? "bg-teal-500" : "bg-slate-200"}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm
          ring-0 transition-transform duration-200 ease-in-out
          ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Collapse({ show, children }: { show: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">(show ? "auto" : 0);
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setVisible(true);
      // Let DOM paint first, then animate to natural height
      requestAnimationFrame(() => {
        if (ref.current) setHeight(ref.current.scrollHeight);
        // After transition, unlock height so content can reflow
        const t = setTimeout(() => setHeight("auto"), 280);
        return () => clearTimeout(t);
      });
    } else {
      // Snapshot current height then animate to 0
      if (ref.current) setHeight(ref.current.scrollHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHeight(0);
        });
      });
      const t = setTimeout(() => setVisible(false), 280);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!visible && !show) return null;

  return (
    <div
      ref={ref}
      style={{
        height: height === "auto" ? "auto" : height,
        overflow: "hidden",
        transition: "height 260ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {children}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function SettingsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings>({
    saveAttachments: false,
    attachmentStorage: "disk",
    maxSizeValue: "20",
    maxSizeUnit: "GB",
    aws: { region: "", bucket: "", accessKeyId: "", accessSecret: "", accessSecretSet: false },
  });

  // Field-level errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && saveState !== "saving") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function open() {
    setIsOpen(true);
    setLoadState("loading");
    setErrors({});
    setSaveState("idle");
    setSaveError(null);

    try {
      const res = await fetch("/api/server/api/settings");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const { value: maxSizeValue, unit: maxSizeUnit } = bytesToDisplay(
        data.maxAttachmentSizeBytes ?? 20 * 1024 ** 3,
      );
      setSettings({
        saveAttachments: data.saveAttachments ?? false,
        attachmentStorage: data.attachmentStorage ?? "disk",
        maxSizeValue,
        maxSizeUnit,
        aws: {
          region: data.aws?.region ?? "",
          bucket: data.aws?.bucket ?? "",
          accessKeyId: data.aws?.accessKeyId ?? "",
          accessSecret: "",  // never pre-fill the secret field
          accessSecretSet: data.aws?.accessSecretSet ?? false,
        },
      });
      setLoadState("ready");
    } catch (err) {
      setLoadState("error");
      console.error("[Settings] Failed to load:", err);
    }
  }

  function close() {
    if (saveState === "saving") return;
    setIsOpen(false);
    setLoadState("idle");
  }

  function setAws(key: keyof Settings["aws"], value: string | boolean) {
    setSettings((s) => ({ ...s, aws: { ...s.aws, [key]: value } }));
    setErrors((e) => { const n = { ...e }; delete n[key as string]; return n; });
  }

  function validate(): boolean {
    if (!settings.saveAttachments) return true;

    const errs: Record<string, string> = {};

    // Size limit validation
    const sizeNum = parseFloat(settings.maxSizeValue);
    if (!settings.maxSizeValue.trim() || !Number.isFinite(sizeNum) || sizeNum <= 0) {
      errs.maxSize = "Enter a valid positive number";
    } else {
      const bytes = displayToBytes(settings.maxSizeValue, settings.maxSizeUnit);
      if (bytes < 1024) errs.maxSize = "Minimum size is 1 KB";
      if (bytes > 1024 ** 4) errs.maxSize = "Maximum size is 1 TB";
    }

    if (settings.attachmentStorage === "aws") {
      if (!settings.aws.region.trim()) errs.region = "Region is required";
      if (!settings.aws.bucket.trim()) errs.bucket = "Bucket name is required";
      if (!settings.aws.accessKeyId.trim()) errs.accessKeyId = "Access Key ID is required";
      if (!settings.aws.accessSecret.trim() && !settings.aws.accessSecretSet) {
        errs.accessSecret = "Secret Access Key is required";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSaveState("saving");
    setSaveError(null);

    try {
      const body: Record<string, unknown> = {
        saveAttachments: settings.saveAttachments,
        attachmentStorage: settings.attachmentStorage,
        maxAttachmentSizeBytes: displayToBytes(settings.maxSizeValue, settings.maxSizeUnit),
        aws: {
          region: settings.aws.region.trim(),
          bucket: settings.aws.bucket.trim(),
          accessKeyId: settings.aws.accessKeyId.trim(),
          // Only include secret if user typed something
          ...(settings.aws.accessSecret.trim()
            ? { accessSecret: settings.aws.accessSecret.trim() }
            : {}),
        },
      };

      const res = await fetch("/api/server/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSaveState("error");
        setSaveError(data.error ?? `Save failed (${res.status})`);
        return;
      }

      // Mark the secret as set if user just entered one
      if (settings.aws.accessSecret.trim()) {
        setSettings((s) => ({
          ...s,
          aws: { ...s.aws, accessSecret: "", accessSecretSet: true },
        }));
      }

      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setSaveError("Network error — is the sync server running?");
    }
  }

  const isSaving = saveState === "saving";

  return (
    <>
      {/* Trigger — gear icon button */}
      <button
        onClick={open}
        title="Settings"
        aria-label="Open settings"
        className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors duration-150 cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Backdrop + Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ animation: "fadeIn 180ms ease" }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={() => { if (saveState !== "saving") close(); }}
          />

          {/* Panel */}
          <div
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            style={{ animation: "slideUp 220ms cubic-bezier(0.4,0,0.2,1)", maxHeight: "90vh" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-800 leading-tight">Settings</h2>
                  <p className="text-[11px] text-slate-400 leading-tight">Sync preferences &amp; storage</p>
                </div>
              </div>
              <button
                onClick={close}
                disabled={isSaving}
                className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Close settings"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1">
              {/* Loading skeleton */}
              {loadState === "loading" && (
                <div className="px-6 py-6 space-y-5 animate-pulse">
                  {[80, 120, 60].map((w, i) => (
                    <div key={i} className="space-y-2">
                      <div className="h-3 bg-slate-100 rounded" style={{ width: `${w}px` }} />
                      <div className="h-10 bg-slate-100 rounded-lg" />
                    </div>
                  ))}
                </div>
              )}

              {/* Load error */}
              {loadState === "error" && (
                <div className="px-6 py-10 text-center">
                  <div className="w-10 h-10 bg-red-50 border border-red-200 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-slate-700 mb-1">Failed to load settings</p>
                  <p className="text-xs text-slate-400 mb-4">Make sure the sync server is running on port 3000.</p>
                  <button
                    onClick={open}
                    className="px-4 py-2 text-xs font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Settings form */}
              {loadState === "ready" && (
                <form id="settings-form" onSubmit={handleSave} noValidate>
                  <div className="px-6 py-5 space-y-6">

                    {/* ── Attachments section ─────────────────────────────── */}
                    <section>
                      <div className="flex items-center justify-between py-1">
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="text-sm font-semibold text-slate-800 leading-tight">Save Attachments</p>
                          <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                            Download and store email attachments during sync
                          </p>
                        </div>
                        <Toggle
                          checked={settings.saveAttachments}
                          onChange={(v) => {
                            setSettings((s) => ({ ...s, saveAttachments: v }));
                            setErrors({});
                          }}
                          disabled={isSaving}
                        />
                      </div>

                      {/* Storage target — collapses when saveAttachments is off */}
                      <Collapse show={settings.saveAttachments}>
                        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">

                          {/* ── Max file size ─────────────────────────────── */}
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1.5">
                              Max attachment size
                            </label>
                            <div className="flex items-stretch gap-0">
                              {/* Number input */}
                              <input
                                type="number"
                                min="0.001"
                                step="any"
                                value={settings.maxSizeValue}
                                onChange={(e) => {
                                  setSettings((s) => ({ ...s, maxSizeValue: e.target.value }));
                                  setErrors((er) => { const n = { ...er }; delete n.maxSize; return n; });
                                }}
                                onBlur={() => {
                                  const num = parseFloat(settings.maxSizeValue);
                                  if (Number.isFinite(num) && num > 0) {
                                    // Normalise to at most 3 decimal places
                                    setSettings((s) => ({ ...s, maxSizeValue: String(parseFloat(num.toFixed(3))) }));
                                  }
                                }}
                                disabled={isSaving}
                                placeholder="20"
                                className={`flex-1 min-w-0 px-3.5 py-2.5 text-sm border rounded-l-lg outline-none transition-all duration-150
                                  text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed
                                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                                  ${errors.maxSize
                                    ? "border-red-300 bg-red-50/40 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                                    : "border-slate-200 bg-white hover:border-slate-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 border-r-0"
                                  }`}
                              />
                              {/* Unit dropdown */}
                              <select
                                value={settings.maxSizeUnit}
                                onChange={(e) => {
                                  setSettings((s) => ({ ...s, maxSizeUnit: e.target.value as SizeUnit }));
                                  setErrors((er) => { const n = { ...er }; delete n.maxSize; return n; });
                                }}
                                disabled={isSaving}
                                className={`px-3 py-2.5 text-sm font-medium border rounded-r-lg outline-none cursor-pointer transition-all duration-150
                                  bg-slate-50 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed
                                  ${errors.maxSize
                                    ? "border-red-300 focus:border-red-400"
                                    : "border-slate-200 hover:border-slate-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                                  }`}
                              >
                                <option value="KB">KB</option>
                                <option value="MB">MB</option>
                                <option value="GB">GB</option>
                              </select>
                            </div>

                            {errors.maxSize ? (
                              <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                                <span>⚠</span>{errors.maxSize}
                              </p>
                            ) : (
                              <p className="mt-1.5 text-xs text-slate-400">
                                {(() => {
                                  const num = parseFloat(settings.maxSizeValue);
                                  if (!Number.isFinite(num) || num <= 0) return "Enter a size limit";
                                  return `Files larger than ${num} ${settings.maxSizeUnit} will be skipped`;
                                })()}
                              </p>
                            )}
                          </div>

                          {/* Storage type radio */}
                          <div>
                            <p className="text-xs font-medium text-slate-700 mb-2.5">Storage destination</p>
                            <div className="grid grid-cols-2 gap-2.5">
                              {(["disk", "aws"] as const).map((opt) => {
                                const isSelected = settings.attachmentStorage === opt;
                                return (
                                  <label
                                    key={opt}
                                    className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border-2 cursor-pointer transition-all duration-150
                                      ${isSaving ? "opacity-50 cursor-not-allowed" : ""}
                                      ${isSelected
                                        ? "border-teal-500 bg-teal-50/60"
                                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                                      }`}
                                  >
                                    <input
                                      type="radio"
                                      name="attachmentStorage"
                                      value={opt}
                                      checked={isSelected}
                                      onChange={() => {
                                        if (!isSaving) {
                                          setSettings((s) => ({ ...s, attachmentStorage: opt }));
                                          setErrors({});
                                        }
                                      }}
                                      className="mt-0.5 accent-teal-500 shrink-0"
                                    />
                                    <div>
                                      {opt === "disk" ? (
                                        <>
                                          <p className={`text-xs font-semibold leading-tight ${isSelected ? "text-teal-700" : "text-slate-700"}`}>
                                            Save to Disk
                                          </p>
                                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                            Local <code className="bg-slate-100 px-1 rounded">attachments/</code> folder
                                          </p>
                                        </>
                                      ) : (
                                        <>
                                          <p className={`text-xs font-semibold leading-tight ${isSelected ? "text-teal-700" : "text-slate-700"}`}>
                                            AWS S3
                                          </p>
                                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                            Upload to an S3 bucket
                                          </p>
                                        </>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          {/* Disk info callout */}
                          <Collapse show={settings.attachmentStorage === "disk"}>
                            <div className="flex items-start gap-2.5 px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl">
                              <svg className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                              </svg>
                              <div className="text-xs text-slate-500 space-y-0.5">
                                <p className="font-medium text-slate-700">Saves to project root</p>
                                <p>Attachments are written to <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-[11px]">attachments/&lt;account&gt;/&lt;messageId&gt;/</code></p>
                              </div>
                            </div>
                          </Collapse>

                          {/* AWS credentials — collapse when disk is selected */}
                          <Collapse show={settings.attachmentStorage === "aws"}>
                            <div className="space-y-3.5 pt-1">
                              {/* Existing secret indicator */}
                              {settings.aws.accessSecretSet && !settings.aws.accessSecret && (
                                <div className="flex items-center gap-2 px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                                  <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                  </svg>
                                  <p className="text-xs text-emerald-700">
                                    A secret key is stored. Leave the field below blank to keep it.
                                  </p>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-3.5">
                                <Field
                                  label="AWS Region"
                                  id="aws-region"
                                  value={settings.aws.region}
                                  placeholder="ap-south-1"
                                  onChange={(v) => setAws("region", v)}
                                  disabled={isSaving}
                                  error={errors.region}
                                  hint="e.g. us-east-1, eu-west-2"
                                  autoComplete="off"
                                />
                                <Field
                                  label="S3 Bucket Name"
                                  id="aws-bucket"
                                  value={settings.aws.bucket}
                                  placeholder="my-email-attachments"
                                  onChange={(v) => setAws("bucket", v)}
                                  disabled={isSaving}
                                  error={errors.bucket}
                                  autoComplete="off"
                                />
                              </div>

                              <Field
                                label="Access Key ID"
                                id="aws-key-id"
                                value={settings.aws.accessKeyId}
                                placeholder="AKIAIOSFODNN7EXAMPLE"
                                onChange={(v) => setAws("accessKeyId", v)}
                                disabled={isSaving}
                                error={errors.accessKeyId}
                                autoComplete="off"
                              />

                              <Field
                                label={`Secret Access Key${settings.aws.accessSecretSet ? " (leave blank to keep existing)" : ""}`}
                                id="aws-secret"
                                type="password"
                                value={settings.aws.accessSecret}
                                placeholder={settings.aws.accessSecretSet ? "••••••••••••••••" : "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}
                                onChange={(v) => setAws("accessSecret", v)}
                                disabled={isSaving}
                                error={errors.accessSecret}
                                autoComplete="new-password"
                              />

                              {/* Security callout */}
                              <div className="flex items-start gap-2.5 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                                <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                </svg>
                                <p className="text-xs text-amber-700">
                                  Credentials are stored in MongoDB. Use an IAM user with <strong>s3:PutObject</strong> permission only — never your root AWS key.
                                </p>
                              </div>
                            </div>
                          </Collapse>
                        </div>
                      </Collapse>
                    </section>

                  </div>
                </form>
              )}
            </div>

            {/* Footer */}
            {loadState === "ready" && (
              <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
                {/* Save feedback */}
                <div className="flex-1 min-w-0">
                  {saveState === "saved" && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium" style={{ animation: "fadeIn 200ms ease" }}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Settings saved
                    </span>
                  )}
                  {saveState === "error" && saveError && (
                    <span className="text-xs text-red-500 truncate block">{saveError}</span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={close}
                    disabled={isSaving}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="settings-form"
                    disabled={isSaving}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Saving…
                      </>
                    ) : "Save Settings"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global keyframe animations */}
      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </>
  );
}
