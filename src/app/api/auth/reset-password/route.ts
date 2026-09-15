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
    // usedAt is set atomically when the token is consumed. Any subsequent
    // request — from the same user clicking "back", a browser extension, or an
    // attacker who intercepted the link — hits this check and is rejected.
    // The token is NOT deleted after use so this audit record persists.
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
    // A client manipulating browser timers, JS execution context, or their system
    // clock cannot bypass this — it is a pure server-side database comparison.
    if (resetRecord.expiresAt < new Date()) {
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

    // Token is valid: hash the new password and mark the token as used atomically
    const newPasswordHash = await hash(password);

    await prisma.$transaction([
      // Update the user's password
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash: newPasswordHash },
      }),
      // Mark the token consumed — this is what prevents replay
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate all active sessions so existing logins are kicked out.
      // Without this, an attacker who compromised the account can stay logged
      // in even after the legitimate owner resets their password.
      prisma.session.deleteMany({
        where: { userId: resetRecord.userId },
      }),
    ]);

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
