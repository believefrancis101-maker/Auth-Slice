import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { hash } from "@/lib/auth/password";
import { resetPasswordSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = resetPasswordSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { token: rawToken, password } = result.data;

    // Re-derive the hash from the submitted raw token so we can look it up.
    // The database only holds hashes — the raw token is never persisted.
    const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    // ── SERVER-SIDE REJECTION #1: Token not found ────────────────────────────
    // Covers: fabricated tokens, typos, tokens that were never issued.
    if (!resetRecord) {
      return NextResponse.json(
        {
          error: "Invalid reset link. The link may be malformed or was never issued.",
          code: "TOKEN_INVALID",
        },
        { status: 400 }
      );
    }

    // ── SERVER-SIDE REJECTION #2: Token already used ─────────────────────────
    // Fast-fail check for non-concurrent requests. Note: this check alone does
    // not protect against concurrent replay; atomic token claiming is enforced
    // in the conditional database update inside the transaction below.
    if (resetRecord.usedAt !== null) {
      return NextResponse.json(
        {
          error:
            "This reset link has already been used. If you still need to reset your password, please request a new link.",
          code: "TOKEN_ALREADY_USED",
          usedAt: resetRecord.usedAt.toISOString(),
        },
        { status: 400 }
      );
    }

    // ── SERVER-SIDE REJECTION #3: Token expired ───────────────────────────────
    // expiresAt is stored in the database and compared against the server clock.
    const now = new Date();
    if (resetRecord.expiresAt < now) {
      return NextResponse.json(
        {
          error:
            "This reset link has expired. Password reset links are only valid for 15 minutes. Please request a new one.",
          code: "TOKEN_EXPIRED",
          expiredAt: resetRecord.expiresAt.toISOString(),
        },
        { status: 400 }
      );
    }

    // Token is preliminarily valid: hash the new password
    const newPasswordHash = await hash(password);

    // ── ATOMIC TOKEN CONSUMPTION & STATE TRANSITION ──────────────────────────
    // To prevent race conditions from concurrent requests with the same token:
    // 1. Atomically claim the token using a conditional update requiring usedAt to
    //    still be null and expiresAt to still be in the future.
    // 2. Only exactly ONE concurrent request will have count === 1.
    // 3. Any concurrent request that loses the race gets count === 0 and is rejected.
    // 4. After successfully claiming the token, update the password and invalidate
    //    all existing sessions in a transaction. If this step fails, roll back the
    //    token claim so token consumption and password change remain atomic.
    const claimTimestamp = new Date();

    const claim = await prisma.passwordResetToken.updateMany({
      where: {
        id: resetRecord.id,
        usedAt: null,
        expiresAt: { gt: claimTimestamp },
      },
      data: {
        usedAt: claimTimestamp,
      },
    });

    if (claim.count === 0) {
      // Re-read token to return specific error for the loser of the race condition
      const freshRecord = await prisma.passwordResetToken.findUnique({
        where: { id: resetRecord.id },
      });

      if (freshRecord?.usedAt) {
        return NextResponse.json(
          {
            error:
              "This reset link has already been used. If you still need to reset your password, please request a new link.",
            code: "TOKEN_ALREADY_USED",
            usedAt: freshRecord.usedAt.toISOString(),
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error:
            "This reset link has expired. Password reset links are only valid for 15 minutes. Please request a new one.",
          code: "TOKEN_EXPIRED",
          expiredAt: freshRecord?.expiresAt.toISOString() ?? resetRecord.expiresAt.toISOString(),
        },
        { status: 400 }
      );
    }

    // Successfully claimed the token: now update password and invalidate sessions
    try {
      await prisma.$transaction([
        // Update the user's password
        prisma.user.update({
          where: { id: resetRecord.userId },
          data: { passwordHash: newPasswordHash },
        }),
        // Invalidate all active sessions so existing logins are kicked out.
        prisma.session.deleteMany({
          where: { userId: resetRecord.userId },
        }),
      ]);
    } catch (txError) {
      // In the rare event the password update or session deletion fails,
      // revert the token claim so token consumption and password change remain atomic.
      await prisma.passwordResetToken.updateMany({
        where: { id: resetRecord.id, usedAt: claimTimestamp },
        data: { usedAt: null },
      });
      throw txError;
    }

    return NextResponse.json(
      {
        success: true,
        message: "Password has been reset successfully. Please sign in with your new password.",
        redirectUrl: "/signin",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
