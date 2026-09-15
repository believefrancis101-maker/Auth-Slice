import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { emailSchema } from "@/lib/validation/auth";
import { sendVerificationEmail } from "@/lib/email";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

// Server-side cooldown per user in seconds
const RESEND_COOLDOWN_SECONDS = 60;

// IP-level flood protection: max 3 resend attempts per 5 minutes per IP
const RESEND_IP_LIMIT = { limit: 3, windowSeconds: 300 };

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipLimitCheck = checkRateLimit(`resend_code_ip:${ip}`, RESEND_IP_LIMIT);

    if (!ipLimitCheck.success) {
      return rateLimitExceededResponse(
        `Too many verification code requests from this network. Please wait ${ipLimitCheck.retryAfter} seconds.`,
        ipLimitCheck
      );
    }

    const body = await request.json();
    const result = emailSchema.safeParse(body.email);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid email address." },
        { status: 400 }
      );
    }

    const email = result.data.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        verificationCodes: {
          orderBy: { lastSentAt: "desc" },
          take: 1,
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Account not found with this email." },
        { status: 404 }
      );
    }

    if (user.emailVerified) {
      return NextResponse.json(
        { error: "Email is already verified. Please sign in." },
        { status: 400 }
      );
    }

    // SERVER-SIDE COOLDOWN ENFORCEMENT
    const latestCode = user.verificationCodes[0];
    if (latestCode) {
      const elapsedSeconds = Math.floor((Date.now() - latestCode.lastSentAt.getTime()) / 1000);

      if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
        const remainingSeconds = RESEND_COOLDOWN_SECONDS - elapsedSeconds;
        return NextResponse.json(
          {
            error: `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} before requesting another code.`,
            retryAfter: remainingSeconds,
          },
          {
            status: 429,
            headers: {
              "Retry-After": remainingSeconds.toString(),
              "X-RateLimit-Limit": "1",
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": Math.ceil((latestCode.lastSentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000) / 1000).toString(),
            },
          }
        );
      }
    }

    // Cooldown passed: Generate new 6-digit code and record lastSentAt
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.verificationCode.create({
      data: {
        code: newCode,
        userId: user.id,
        expiresAt,
        lastSentAt: new Date(),
      },
    });

    await sendVerificationEmail(email, newCode);

    return NextResponse.json(
      {
        success: true,
        message: "New verification code has been sent.",
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        ...(process.env.NODE_ENV !== "production" ? { debugCode: newCode } : {}),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Resend code error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
