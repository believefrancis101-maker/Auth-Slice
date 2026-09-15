import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

// Token is valid for 15 minutes
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

// Rate limits: 3 reset requests per 15 minutes per IP, and 3 per 15 minutes per email
const FORGOT_PASSWORD_IP_LIMIT = { limit: 3, windowSeconds: 900 };
const FORGOT_PASSWORD_EMAIL_LIMIT = { limit: 3, windowSeconds: 900 };

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipLimitCheck = checkRateLimit(`forgot_password_ip:${ip}`, FORGOT_PASSWORD_IP_LIMIT);

    if (!ipLimitCheck.success) {
      return rateLimitExceededResponse(
        `Too many password reset attempts. Please try again in ${ipLimitCheck.retryAfter} seconds.`,
        ipLimitCheck
      );
    }

    const body = await request.json();
    const result = forgotPasswordSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Please provide a valid email address." },
        { status: 400 }
      );
    }

    const email = result.data.email.toLowerCase().trim();

    // Secondary rate limit per targeted email address
    const emailLimitCheck = checkRateLimit(`forgot_password_email:${email}`, FORGOT_PASSWORD_EMAIL_LIMIT);
    if (!emailLimitCheck.success) {
      return rateLimitExceededResponse(
        `Too many password reset requests for this email. Please wait ${emailLimitCheck.retryAfter} seconds.`,
        emailLimitCheck
      );
    }

    // Always return the same success response regardless of whether the account
    // exists — prevents email-based account enumeration.
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.emailVerified) {
      // Intentionally identical response to the happy path
      return NextResponse.json(
        {
          success: true,
          message:
            "If an account with that email exists, a reset link has been sent.",
        },
        { status: 200 }
      );
    }

    // Generate a cryptographically random 32-byte raw token
    const rawToken = crypto.randomBytes(32).toString("hex");

    // Store only the SHA-256 hash — the raw token never touches the database
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
        usedAt: null,
      },
    });

    // The raw token goes in the link — only the recipient's inbox ever sees it
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/reset-password?token=${rawToken}`;

    await sendPasswordResetEmail(email, resetUrl);

    return NextResponse.json(
      {
        success: true,
        message:
          "If an account with that email exists, a reset link has been sent.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
