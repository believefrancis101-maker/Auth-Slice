import { NextRequest, NextResponse } from "next/server";

// Inlined from session.ts so this file has zero Node.js dependencies and
// can run in the Edge Runtime without issues.
const SESSION_COOKIE_NAME = "auth_session";

/**
 * Routes that require a valid session cookie to access.
 * Unauthenticated requests are redirected to /signin with the original
 * URL preserved as ?next= so the user lands back here after sign-in.
 */
const PROTECTED_PREFIXES = ["/dashboard"];

/**
 * Routes that signed-in users should not reach.
 * A user with a valid cookie hitting /signin is sent straight to /dashboard.
 */
const AUTH_ONLY_PREFIXES = [
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read session cookie — cookie access is fully supported in the Edge Runtime.
  // We only check *presence* here. The authoritative validation (DB lookup +
  // expiry check) still happens inside the Server Component via getCurrentUser()
  // so an expired or revoked cookie is caught before any page renders.
  const hasSessionCookie = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value
  );

  // ── Protected routes ───────────────────────────────────────────────────────
  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    if (!hasSessionCookie) {
      const signInUrl = new URL("/signin", request.url);
      signInUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  // ── Auth-only routes (already signed in) ───────────────────────────────────
  if (AUTH_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on all paths except:
     *  - Next.js internals (_next/static, _next/image)
     *  - Public files (favicon.ico, images)
     * API routes pass through to NextResponse.next() unchanged since they
     * are not listed in either PROTECTED_PREFIXES or AUTH_ONLY_PREFIXES.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
