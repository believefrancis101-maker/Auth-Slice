import { cookies } from "next/headers";
import crypto from "crypto";
import prisma from "@/lib/prisma";

export const SESSION_COOKIE_NAME = "auth_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Computes a deterministic SHA-256 hash of a raw session token.
 * We store only the hash in the database, while the client holds the raw token in an HTTP-only cookie.
 * This guarantees consistency with PasswordResetToken: if the database is leaked or read-replicated,
 * an attacker cannot use leaked session rows to impersonate active users.
 */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Creates a database-backed session for the given user, persists the token's SHA-256 hash,
 * and attaches the raw token in an HTTP-only secure cookie.
 */
export async function createSession(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({
    data: {
      sessionToken: tokenHash,
      userId,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return rawToken;
}

/**
 * Validates a session token against the database by checking its SHA-256 hash and expiry.
 */
export async function validateSession(rawToken: string) {
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const session = await prisma.session.findUnique({
    where: { sessionToken: tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          emailVerified: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) return null;

  // Check expiration
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.user;
}

/**
 * Reads the session cookie and retrieves the authenticated user, or null if unauthenticated.
 */
export async function getCurrentUser() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!rawToken) return null;

  return validateSession(rawToken);
}

/**
 * Invalidates the current session from the database and removes the session cookie.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (rawToken) {
    const tokenHash = hashSessionToken(rawToken);
    await prisma.session.deleteMany({
      where: { sessionToken: tokenHash },
    }).catch(() => {});
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
