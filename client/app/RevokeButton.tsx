"use client";

interface RevokeButtonProps {
  email: string;
}

export default function RevokeButton({ email }: RevokeButtonProps) {
  return (
    <form
      method="POST"
      action={`/api/server/auth/revoke/${encodeURIComponent(email)}`}
      onSubmit={(e) => {
        if (!confirm(`Revoke access for ${email}?\n\nEmail sync will stop immediately.`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-red-50 text-red-500 text-xs font-semibold rounded border border-teal-100 hover:border-red-200 transition-colors duration-150 cursor-pointer"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        Revoke
      </button>
    </form>
  );
}
