import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyCodeSchema } from "@/lib/validation/auth";
import { createSession } from "@/lib/auth/session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

// Rate limit: 5 verification attempts per 10 minutes per IP / email to prevent OTP brute-forcing
const VERIFY_CODE_IP_LIMIT = { limit: 5, windowSeconds: 600 };
const VERIFY_CODE_EMAIL_LIMIT = { limit: 5, windowSeconds: 600 };

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipLimitCheck = checkRateLimit(`verify_code_ip:${ip}`, VERIFY_CODE_IP_LIMIT);

    if (!ipLimitCheck.success) {
      return rateLimitExceededResponse(
        `Too many verification attempts from this network. Please wait ${ipLimitCheck.retryAfter} seconds.`,
        ipLimitCheck
      );
    }

    const body = await request.json();
    const result = verifyCodeSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, code } = result.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Per-account rate limit: prevents distributed botnets from brute-forcing a single user's 6-digit OTP
    const emailLimitCheck = checkRateLimit(`verify_code_email:${normalizedEmail}`, VERIFY_CODE_EMAIL_LIMIT);
    if (!emailLimitCheck.success) {
      return rateLimitExceededResponse(
        `Too many failed verification attempts for this account. Please wait ${emailLimitCheck.retryAfter} seconds or request a new code.`,
        emailLimitCheck
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return NextResponse.json(
        { error: "No account found with this email." },
        { status: 404 }
      );
    }

    // Look for matching verification code
    const verificationRecord = await prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        code,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!verificationRecord) {
      return NextResponse.json(
        { error: "Invalid verification code. Please check and try again." },
        { status: 400 }
      );
    }

    // Check expiration
    if (verificationRecord.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "Verification code has expired. Please request a new one." },
        { status: 400 }
      );
    }

    // Code is valid: Mark user as verified and delete spent codes inside transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      }),
      prisma.verificationCode.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    // Create session & set HTTP-only cookie
    await createSession(user.id);

    return NextResponse.json(
      {
        success: true,
        message: "Email verified successfully.",
        redirectUrl: "/dashboard",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Verify code error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
