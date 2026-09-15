import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verify } from "@/lib/auth/password";
import { loginSchema } from "@/lib/validation/auth";
import { createSession } from "@/lib/auth/session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

// Rate limit: 5 sign-in attempts per 60 seconds per IP
const SIGNIN_LIMIT = { limit: 5, windowSeconds: 60 };

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rateLimitCheck = checkRateLimit(`signin:${ip}`, SIGNIN_LIMIT);

    if (!rateLimitCheck.success) {
      return rateLimitExceededResponse(
        `Too many sign-in attempts. Please try again in ${rateLimitCheck.retryAfter} seconds.`,
        rateLimitCheck
      );
    }

    const body = await request.json();
    const result = loginSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, password } = result.data;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Use a constant-time response for unknown email to prevent user enumeration.
    // We still do the bcrypt compare so timing is identical whether or not the
    // account exists — an attacker cannot distinguish "wrong email" from "wrong password"
    // by measuring response time.
    const DUMMY_HASH =
      "$2b$12$invalidhashusedtomaintainconstanttimingXXXXXXXXXXXXXXX";

    const passwordMatches = await verify(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordMatches) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    if (!user.emailVerified) {
      return NextResponse.json(
        {
          error: "Please verify your email address before signing in.",
          code: "EMAIL_NOT_VERIFIED",
          email: normalizedEmail,
        },
        { status: 403 }
      );
    }

    await createSession(user.id);

    return NextResponse.json(
      {
        success: true,
        message: "Signed in successfully.",
        redirectUrl: "/dashboard",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Sign-in error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
