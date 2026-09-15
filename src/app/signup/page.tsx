"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signUpSchema, type SignUpInput } from "@/lib/validation/auth";

export default function SignupPage() {
  const router = useRouter();

  const [formData, setFormData] = useState<SignUpInput>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear specific field error when user starts typing
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const updated = { ...prev };
        delete updated[name];
        return updated;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    // Client-side Zod validation (early UX feedback)
    const result = signUpSchema.safeParse(formData);
    if (!result.success) {
      const formattedErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        if (field && !formattedErrors[field]) {
          formattedErrors[field] = issue.message;
        }
      });
      setFieldErrors(formattedErrors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.details) {
          const serverErrors: Record<string, string> = {};
          Object.entries(data.details).forEach(([key, msgs]) => {
            if (Array.isArray(msgs) && msgs.length > 0) {
              serverErrors[key] = msgs[0];
            }
          });
          setFieldErrors(serverErrors);
        } else {
          setGeneralError(data.error || "Signup failed. Please try again.");
        }
        setIsLoading(false);
        return;
      }

      // Success or Idempotent Success: Navigate to email verification screen
      const targetEmail = encodeURIComponent(formData.email.trim());
      router.push(`/verify-email?email=${targetEmail}`);
    } catch (err) {
      console.error("Submission error:", err);
      setGeneralError("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-zinc-200 p-8 dark:bg-zinc-900 dark:border-zinc-800">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Create an Account
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Sign up to get started with your secure authentication workflow
          </p>
        </div>

        {generalError && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
          >
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Name Field */}
          <div>
            <label
              htmlFor="signup-name"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Full Name <span className="text-zinc-400 font-normal">(optional)</span>
            </label>
            <div className="mt-1">
              <input
                id="signup-name"
                name="name"
                type="text"
                autoComplete="name"
                value={formData.name || ""}
                onChange={handleChange}
                placeholder="Jane Doe"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-zinc-900 placeholder-zinc-400 transition-all duration-150 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-offset-zinc-900"
              />
            </div>
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.name}</p>
            )}
          </div>

          {/* Email Field */}
          <div>
            <label
              htmlFor="signup-email"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Email Address <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <input
                id="signup-email"
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
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.email}</p>
            )}
          </div>

          {/* Password Field */}
          <div>
            <label
              htmlFor="signup-password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Password <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
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
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              At least 8 characters, with 1 uppercase, 1 lowercase, and 1 number (max 72).
            </p>
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.password}</p>
            )}
          </div>

          {/* Confirm Password Field */}
          <div>
            <label
              htmlFor="signup-confirm-password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Confirm Password <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <input
                id="signup-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="••••••••••••"
                aria-invalid={!!fieldErrors.confirmPassword}
                className={`w-full rounded-lg border px-3.5 py-2.5 text-zinc-900 placeholder-zinc-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-offset-zinc-900 ${
                  fieldErrors.confirmPassword
                    ? "border-red-500 focus:border-red-500"
                    : "border-zinc-300 bg-white dark:border-zinc-700 focus:border-blue-600"
                }`}
              />
            </div>
            {fieldErrors.confirmPassword && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 flex items-center justify-center rounded-lg bg-blue-600 py-3 px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-900"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                Creating Account...
              </span>
            ) : (
              "Sign Up"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
