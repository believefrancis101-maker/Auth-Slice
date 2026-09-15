"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email") || "";

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // 60-second cooldown timer
  const [cooldownSeconds, setCooldownSeconds] = useState(60);

  useEffect(() => {
    if (emailParam) {
      setEmail(emailParam);
    }
  }, [emailParam]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!code || code.trim().length !== 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }

    setIsVerifying(true);

    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Verification failed. Please try again.");
        setIsVerifying(false);
        return;
      }

      router.push(data.redirectUrl || "/dashboard");
    } catch (err) {
      console.error("Verification network error:", err);
      setError("Network error. Please try again.");
      setIsVerifying(false);
    }
  }

  async function handleResend() {
    if (!email) {
      setError("Email address is required to resend verification code.");
      return;
    }

    setError(null);
    setInfoMessage(null);
    setIsResending(true);

    try {
      const res = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Handle server-enforced HTTP 429 cooldown
        if (res.status === 429 && data.retryAfter) {
          setCooldownSeconds(data.retryAfter);
        }
        setError(data.error || "Failed to resend code.");
        setIsResending(false);
        return;
      }

      setInfoMessage("A new verification code has been sent!");
      setCooldownSeconds(data.cooldownSeconds || 60);
      setIsResending(false);
    } catch (err) {
      console.error("Resend network error:", err);
      setError("Failed to resend code due to network error.");
      setIsResending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-zinc-200 p-8 dark:bg-zinc-900 dark:border-zinc-800">
        <div className="mb-6 text-center">
          <div className="mx-auto w-12 h-12 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400 mb-4">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Check Your Email
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            We sent a 6-digit verification code to
          </p>
          <p className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm mt-0.5">
            {email || "your email address"}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {infoMessage && (
          <div
            role="status"
            className="mb-4 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-400"
          >
            {infoMessage}
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-5">
          <div>
            <label
              htmlFor="verification-code"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Verification Code
            </label>
            <div className="mt-1.5">
              <input
                id="verification-code"
                name="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))}
                placeholder="123456"
                autoComplete="one-time-code"
                className="w-full text-center tracking-[0.35em] text-2xl font-mono font-semibold rounded-lg border border-zinc-300 bg-white py-3 text-zinc-900 placeholder-zinc-300 transition-all duration-150 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder-zinc-600 dark:focus:ring-offset-zinc-900"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isVerifying || code.trim().length !== 6}
            className="w-full flex items-center justify-center rounded-lg bg-blue-600 py-3 px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-zinc-900"
          >
            {isVerifying ? "Verifying Code..." : "Verify & Continue"}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-zinc-200 dark:border-zinc-800 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
            Didn&apos;t receive the code?
          </p>

          <button
            type="button"
            onClick={handleResend}
            disabled={cooldownSeconds > 0 || isResending}
            className="text-sm font-medium text-blue-600 hover:text-blue-500 disabled:text-zinc-400 disabled:cursor-not-allowed dark:text-blue-400 dark:hover:text-blue-300 dark:disabled:text-zinc-600 transition-colors"
          >
            {isResending
              ? "Sending..."
              : cooldownSeconds > 0
              ? `Resend code in ${cooldownSeconds}s`
              : "Resend verification code"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
          <p className="text-zinc-500">Loading...</p>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
