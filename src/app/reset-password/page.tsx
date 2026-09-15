"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPasswordSchema } from "@/lib/validation/auth";

// Maps the server's error code to a user-facing message and a call-to-action
const TOKEN_ERROR_COPY: Record<string, { title: string; body: string; cta: string; href: string }> = {
  TOKEN_INVALID: {
    title: "Invalid reset link",
    body: "This link is malformed or was never issued. It may have been truncated by your email client.",
    cta: "Request a new link",
    href: "/forgot-password",
  },
  TOKEN_ALREADY_USED: {
    title: "Link already used",
    body: "This reset link has already been used. Each link is single-use for your security.",
    cta: "Request a new link",
    href: "/forgot-password",
  },
  TOKEN_EXPIRED: {
    title: "Link expired",
    body: "Password reset links are valid for 15 minutes. This one has expired.",
    cta: "Request a new link",
    href: "/forgot-password",
  },
};

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawToken = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [tokenError, setTokenError] = useState<keyof typeof TOKEN_ERROR_COPY | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setTokenError(null);
    setGeneralError(null);

    const result = resetPasswordSchema.safeParse({
      token: rawToken,
      password,
      confirmPassword,
    });

    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.issues.forEach((i) => {
        const f = i.path[0] as string;
        if (f && !errs[f]) errs[f] = i.message;
      });
      setFieldErrors(errs);
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken, password, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Surface the structured error code from the server
        if (data.code && data.code in TOKEN_ERROR_COPY) {
          setTokenError(data.code as keyof typeof TOKEN_ERROR_COPY);
        } else if (data.details) {
          const errs: Record<string, string> = {};
          Object.entries(data.details).forEach(([k, v]) => {
            if (Array.isArray(v) && v.length > 0) errs[k] = v[0];
          });
          setFieldErrors(errs);
        } else {
          setGeneralError(data.error || "Failed to reset password. Please try again.");
        }
        setIsLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push("/signin"), 2500);
    } catch {
      setGeneralError("Network error. Please check your connection.");
      setIsLoading(false);
    }
  }

  // ── Token-level error screen (invalid / used / expired) ────────────────────
  if (tokenError) {
    const copy = TOKEN_ERROR_COPY[tokenError];
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-zinc-200 p-8 text-center dark:bg-zinc-900 dark:border-zinc-800">
          <div className="mx-auto w-12 h-12 flex items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400 mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{copy.title}</h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{copy.body}</p>
          <Link
            href={copy.href}
            className="mt-6 inline-flex items-center justify-center w-full rounded-lg bg-blue-600 py-3 px-4 text-sm font-semibold text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 transition-colors"
          >
            {copy.cta}
          </Link>
        </div>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-zinc-200 p-8 text-center dark:bg-zinc-900 dark:border-zinc-800">
          <div className="mx-auto w-12 h-12 flex items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Password reset!</h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Your password has been updated. All active sessions have been signed out.
            Redirecting you to sign in…
          </p>
        </div>
      </div>
    );
  }

  // ── Reset form ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-zinc-200 p-8 dark:bg-zinc-900 dark:border-zinc-800">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Set a new password
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Choose a strong password. All your existing sessions will be signed out.
          </p>
        </div>

        {generalError && (
          <div role="alert" className="mb-5 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400">
            {generalError}
          </div>
        )}

        {!rawToken && (
          <div role="alert" className="mb-5 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400">
            No reset token found in the URL.{" "}
            <Link href="/forgot-password" className="underline font-medium">Request a new link.</Link>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <label htmlFor="reset-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              New Password <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <input
                id="reset-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors(p => { const u={...p}; delete u.password; return u; }); }}
                placeholder="••••••••••••"
                aria-invalid={!!fieldErrors.password}
                className={`w-full rounded-lg border px-3.5 py-2.5 text-zinc-900 placeholder-zinc-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-offset-zinc-900 ${
                  fieldErrors.password ? "border-red-500" : "border-zinc-300 bg-white dark:border-zinc-700 focus:border-blue-600"
                }`}
              />
            </div>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              At least 8 characters, 1 uppercase, 1 lowercase, 1 number (max 72).
            </p>
            {fieldErrors.password && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.password}</p>}
          </div>

          <div>
            <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Confirm New Password <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <input
                id="reset-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); if (fieldErrors.confirmPassword) setFieldErrors(p => { const u={...p}; delete u.confirmPassword; return u; }); }}
                placeholder="••••••••••••"
                aria-invalid={!!fieldErrors.confirmPassword}
                className={`w-full rounded-lg border px-3.5 py-2.5 text-zinc-900 placeholder-zinc-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-offset-zinc-900 ${
                  fieldErrors.confirmPassword ? "border-red-500" : "border-zinc-300 bg-white dark:border-zinc-700 focus:border-blue-600"
                }`}
              />
            </div>
            {fieldErrors.confirmPassword && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.confirmPassword}</p>}
          </div>

          <button
            type="submit"
            disabled={isLoading || !rawToken}
            className="w-full mt-2 flex items-center justify-center rounded-lg bg-blue-600 py-3 px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-900"
          >
            {isLoading ? "Resetting…" : "Reset password"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-zinc-500">Loading…</p>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  );
}
