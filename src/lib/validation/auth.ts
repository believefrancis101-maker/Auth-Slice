import { z } from "zod";

/**
 * Common validation primitives
 */
export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .max(255, "Email address is too long");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  // bcrypt limits input to 72 BYTES, not 72 characters.
  // Multi-byte UTF-8 characters (accents, non-Latin, emojis) take 2-4 bytes each.
  .refine(
    (val) => new TextEncoder().encode(val).length <= 72,
    "Password cannot exceed 72 bytes (multi-byte characters like emojis count as multiple bytes)"
  )
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

/**
 * Sign-Up Schema
 * Used by registration form (client) and sign-up API route / server action (server)
 */
export const signUpSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name must be at least 1 character")
      .max(100, "Name cannot exceed 100 characters")
      .optional()
      .or(z.literal("")),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Sign-In / Login Schema
 * Used by login form (client) and login API route / server action (server)
 */
export const loginSchema = z.object({
  email: emailSchema,
  // Do NOT enforce complexity regexes on login; only verify presence.
  // Enforcing complexity on login leaks policy and can lock out users if requirements change.
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Forgot Password Schema
 */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Reset Password Schema
 * Used when user submits the new password using the emailed reset token
 */
export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, "Reset token is required"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Verification Code Schema
 * Used for email verification code / 2FA code submission
 */
export const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .length(6, "Verification code must be exactly 6 characters")
    .regex(/^[a-zA-Z0-9]{6}$/, "Verification code must be alphanumeric"),
});

export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
