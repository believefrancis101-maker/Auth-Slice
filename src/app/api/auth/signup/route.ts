import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hash, verify } from "@/lib/auth/password";
import { signUpSchema } from "@/lib/validation/auth";
import { sendVerificationEmail } from "@/lib/email";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

// Rate limit: 5 signups per 10 minutes per IP
const SIGNUP_LIMIT = { limit: 5, windowSeconds: 600 };

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rateLimitCheck = checkRateLimit(`signup:${ip}`, SIGNUP_LIMIT);

    if (!rateLimitCheck.success) {
      return rateLimitExceededResponse(
        `Too many registration attempts. Please try again in ${rateLimitCheck.retryAfter} seconds.`,
        rateLimitCheck
      );
    }

    const body = await request.json();
    const result = signUpSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, password, name } = result.data;
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check if user already exists
    let existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        verificationCodes: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    // 2. IDEMPOTENT HANDLING FOR EXISTING ACCOUNT
    if (existingUser) {
      // Case A: User is already verified
      if (existingUser.emailVerified) {
        const isPasswordMatch = await verify(password, existingUser.passwordHash);
        if (isPasswordMatch) {
          // Idempotent duplicate: user already registered & verified with this exact credential
          return NextResponse.json(
            {
              success: true,
              message: "Account already exists and is verified. Please sign in.",
              email: normalizedEmail,
              alreadyVerified: true,
              idempotent: true,
            },
            { status: 200 }
          );
        }
        return NextResponse.json(
          { error: "An account with this email already exists." },
          { status: 409 }
        );
      }

      // Case B: User exists but is unverified (Pending verification)
      const isSamePassword = await verify(password, existingUser.passwordHash);
      if (isSamePassword) {
        // IDEMPOTENT DOUBLE SUBMISSION:
        // The user double-clicked or replayed the identical registration payload.
        // Return exactly the same success response without creating a second account or failing.
        const latestCode = existingUser.verificationCodes[0];
        let activeCode = latestCode?.code;
        const now = new Date();

        // If no code exists or code expired, generate a new one
        if (!latestCode || latestCode.expiresAt < now) {
          activeCode = Math.floor(100000 + Math.random() * 900000).toString();
          await prisma.verificationCode.create({
            data: {
              code: activeCode,
              userId: existingUser.id,
              expiresAt: new Date(now.getTime() + 10 * 60 * 1000), // 10 minutes
              lastSentAt: now,
            },
          });
          await sendVerificationEmail(normalizedEmail, activeCode);
        }

        return NextResponse.json(
          {
            success: true,
            message: "Account pending verification. Verification code sent.",
            email: normalizedEmail,
            idempotent: true,
            ...(process.env.NODE_ENV !== "production" ? { debugCode: activeCode } : {}),
          },
          { status: 200 }
        );
      } else {
        return NextResponse.json(
          { error: "An account with this email is already registered." },
          { status: 409 }
        );
      }
    }

    // 3. FIRST TIME SUBMISSION: Create user and verification code
    const passwordHash = await hash(password);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            name: name && name.trim().length > 0 ? name.trim() : null,
            emailVerified: false,
          },
        });

        await tx.verificationCode.create({
          data: {
            code,
            userId: user.id,
            expiresAt,
            lastSentAt: new Date(),
          },
        });
      });

      await sendVerificationEmail(normalizedEmail, code);

      return NextResponse.json(
        {
          success: true,
          message: "Account created successfully. Verification code sent.",
          email: normalizedEmail,
          idempotent: false,
          ...(process.env.NODE_ENV !== "production" ? { debugCode: code } : {}),
        },
        { status: 201 }
      );
    } catch (createError: any) {
      // Handle concurrent race condition where two identical requests hit at the exact same millisecond
      if (createError.code === "P2002") {
        // Unique constraint on email collided concurrently.
        // Fetch the winner of the race condition and return an idempotent 200 response.
        const winner = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          include: { verificationCodes: { orderBy: { createdAt: "desc" }, take: 1 } },
        });

        if (winner && (await verify(password, winner.passwordHash))) {
          return NextResponse.json(
            {
              success: true,
              message: "Account created. Verification code sent.",
              email: normalizedEmail,
              idempotent: true,
              ...(process.env.NODE_ENV !== "production"
                ? { debugCode: winner.verificationCodes[0]?.code }
                : {}),
            },
            { status: 200 }
          );
        }
      }

      console.error("Signup transaction error:", createError);
      return NextResponse.json(
        { error: "Failed to create account. Please try again." },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Signup route error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
