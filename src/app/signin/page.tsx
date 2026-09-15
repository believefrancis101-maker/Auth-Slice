"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?next= is set by middleware when a signed-out user hits a protected route
  const nextUrl = searchParams.get("next") || "/dashboard";

  const [formData, setFormData] = useState<LoginInput>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => { const u = { ...prev }; delete u[name]; return u; });
    }
    setGeneralError(null);
    setUnverifiedEmail(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});
    setUnverifiedEmail(null);

    const result = loginSchema.safeParse(formData);
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
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED") {
          setUnverifiedEmail(data.email);
        } else if (data.details) {
          const errs: Record<string, string> = {};
          Object.entries(data.details).forEach(([k, v]) => {
            if (Array.isArray(v) && v.length > 0) errs[k] = v[0];
          });
          setFieldErrors(errs);
        } else {
          setGeneralError(data.error || "Sign-in failed. Please try again.");
        }
        setIsLoading(false);
        return;
      }

      // Honour ?next= from the middleware redirect, then fall back to the
      // API route's suggestion, then default to /dashboard.
      router.push(nextUrl || data.redirectUrl || "/dashboard");
    } catch {
      setGeneralError("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-zinc-200 p-8 dark:bg-zinc-900 dark:border-zinc-800">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Sign In
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Welcome back. Enter your credentials to continue.
          </p>
        </div>

        {generalError && (
          <div role="alert" className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400">
            {generalError}
          </div>
        )}

        {unverifiedEmail && (
          <div role="alert" className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400">
            <p className="font-medium">Email not verified</p>
            <p className="mt-1">
              Please verify your email before signing in.{" "}
              <Link
                href={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                className="underline underline-offset-2 font-medium hover:text-amber-900 dark:hover:text-amber-300"
              >
                Go to verification →
              </Link>
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <label htmlFor="signin-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Email Address <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <input
                id="signin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                aria-invalid={!!fieldErrors.email}
                className={`w-full rounded-lg border px-3.5 py-2.5 text-zinc-900 placeholder-zinc-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-offset-zinc-900 ${
                  fieldErrors.email
                    ? "border-red-500 focus:border-red-500"
                    : "border-zinc-300 bg-white dark:border-zinc-700 focus:border-blue-600"
                }`}
              />
            </div>
            {fieldErrors.email && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.email}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="signin-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Password <span className="text-red-500">*</span>
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 focus:outline-none focus:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="mt-1">
              <input
                id="signin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••••••"
                aria-invalid={!!fieldErrors.password}
                className={`w-full rounded-lg border px-3.5 py-2.5 text-zinc-900 placeholder-zinc-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-offset-zinc-900 ${
                  fieldErrors.password
                    ? "border-red-500 focus:border-red-500"
                    : "border-zinc-300 bg-white dark:border-zinc-700 focus:border-blue-600"
                }`}
              />
            </div>
            {fieldErrors.password && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.password}</p>}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 flex items-center justify-center rounded-lg bg-blue-600 py-3 px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-900"
          >
            {isLoading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
          <p className="text-zinc-500">Loading…</p>
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
