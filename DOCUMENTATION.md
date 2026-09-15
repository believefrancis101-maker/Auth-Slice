# Auth Workflow — Documentation

---

## 1. What This Is

This is a self-contained email-and-password authentication slice built on Next.js 16 (App Router), Prisma, SQLite, and Resend. It covers the complete credential lifecycle: registration with email verification, sign-in with session management, forgot-password with a single-use reset link, and sign-out. Every route enforces input validation, rate limiting, and timing-safe comparisons on the server. The frontend is a set of React client components — forms only, no routing logic — that talk to the API routes via `fetch` and handle both field-level and general error states. A Next.js middleware file (`src/proxy.ts`) running in the Edge Runtime handles redirect logic: unauthenticated users going to `/dashboard` are bounced to `/signin`; authenticated users going to `/signin` are bounced to `/dashboard`.

What is deliberately excluded, and why: there is no OAuth, magic-link, TOTP, or any multi-provider strategy. Those were left out because the brief called for a focused study of the fundamentals — hashing, session tokens, OTP design, timing attacks — and adding a third-party OAuth flow would have obscured those decisions behind library abstractions. There is no role system, no organisation model, no user-profile endpoint, and no admin panel. The database is SQLite, which rules out multi-process or multi-server deployments. These are scope decisions, not accidental omissions.

---

## 2. How To Run It

**Prerequisites:** Node.js >= 20, npm >= 9.

1. **Clone the repository and enter the directory.**
   ```bash
   git clone <repo-url>
   cd "Auth. workflow"
   ```

2. **Install dependencies.**
   ```bash
   npm install
   ```

3. **Create your environment file.** Copy the example and fill in the values:
   ```bash
   cp .env.example .env
   ```

4. **Run the database migration.** This creates `prisma/dev.db` and applies the schema:
   ```bash
   npm run db:push
   ```

5. **Start the development server.**
   ```bash
   npm run dev
   ```

6. **Open the app** at `http://localhost:3000`. The root redirects to `/signup`.

---

### `.env.example` — copy this file, never commit real keys

```bash
# SQLite database path, relative to the prisma/ directory.
# Switch to postgresql://... for a production Postgres URL.
DATABASE_URL="file:./dev.db"

# Application secret. Must be at least 32 characters.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# NEVER commit the real value.
AUTH_SECRET="replace-me-with-a-real-random-secret-min-32-chars"

# Resend API key from https://resend.com
# If empty, codes and reset links print to the server console (dev only).
RESEND_API_KEY=""

# Public origin — used to build password reset URLs.
# Defaults to http://localhost:3000 when unset.
# NEXT_PUBLIC_APP_URL="https://yourdomain.com"

# From address for outbound emails.
# Defaults to "Auth Workflow <onboarding@resend.dev>" when unset.
# EMAIL_FROM="Your App <no-reply@yourdomain.com>"
```

---

## 3. The Flow, Step By Step

### Registration

The user navigates to `/signup` (`src/app/signup/page.tsx`) and fills in an optional name, email, password, and confirm-password. Before the request leaves the browser, the same Zod schema used on the server — `signUpSchema` in `src/lib/validation/auth.ts` — runs client-side, so field errors appear instantly without a round trip. On submit, the form posts `{ name, email, password, confirmPassword }` to `POST /api/auth/signup` (`src/app/api/auth/signup/route.ts`).

The server checks a fixed-window in-memory rate limiter (5 attempts per 10 minutes per IP) before doing anything else. If the email is new, the handler opens a Prisma transaction that atomically creates the `User` row and a `VerificationCode` row — a 6-digit numeric code expiring in 10 minutes. The password is hashed with bcrypt at cost factor 12 before the transaction runs; the plaintext never touches the database. After the transaction commits, `sendVerificationEmail` is called; in development it prints the code to the server console. The handler returns `201` with `{ email }` and, in non-production environments, a `debugCode` field for testing without a real inbox.

Idempotency cases — double-click, browser retry, network replay — are handled explicitly: if the exact same `{ email, password }` pair arrives while the account is still unverified, the server returns `200` with the same response shape instead of creating a duplicate or returning a confusing error. The client receives the success response and pushes to `/verify-email?email=<encoded>`.

---

### Email Verification

The user is on `/verify-email` (`src/app/verify-email/page.tsx`). The email is pre-filled from the query string. The user types the 6-digit code and submits. The form posts `{ email, code }` to `POST /api/auth/verify-code` (`src/app/api/auth/verify-code/route.ts`).

The server applies two rate limits before querying the database: one keyed on the request IP (5 per 10 minutes) and one keyed on the target email address (5 per 10 minutes). The per-email limit is the critical one — a distributed botnet can rotate IPs to avoid the IP limit, but still hits the per-email wall that protects each account's 6-digit code space. The server looks up the most recent `VerificationCode` row matching `{ userId, code }`, checks `expiresAt`, then runs a Prisma transaction that sets `User.emailVerified = true` and deletes all `VerificationCode` rows for that user atomically. It then calls `createSession` and redirects to `/dashboard`.

If a user did not receive the email, they click "Resend verification code". The button is disabled for 60 seconds (countdown timer in the browser), but the server enforces the same cooldown server-side by checking `lastSentAt` on the most recent code row. The client-side timer is UX only and can be bypassed; the server check is authoritative.

---

### Sign-In

The user navigates to `/signin` (`src/app/signin/page.tsx`) and enters email and password. The form posts `{ email, password }` to `POST /api/auth/signin` (`src/app/api/auth/signin/route.ts`).

The server applies a rate limit (5 attempts per 60 seconds per IP). It then looks up the user by email. Whether or not the email exists, it always calls `bcrypt.compare`. For non-existent accounts it compares against a hardcoded dummy hash, making response time statistically identical regardless of account existence — an attacker cannot learn which emails are registered by measuring latency.

If the password matches but `emailVerified` is false, the server returns `403` with `code: "EMAIL_NOT_VERIFIED"` and the email address; the frontend shows an amber banner with a direct link to `/verify-email?email=<encoded>`. On full success the server calls `createSession`, which writes the session hash to the database and sets the `auth_session` HTTP-only cookie, then returns `{ redirectUrl: "/dashboard" }`.

---

### Protected Routes

The middleware in `src/proxy.ts` runs on every request that is not a static asset. It checks for the presence of the `auth_session` cookie. Presence alone is enough for the redirect decision — the actual validity check (hash lookup + expiry) happens inside the Server Component. If the cookie is missing on a protected prefix like `/dashboard`, the middleware redirects to `/signin?next=/dashboard`. On sign-in success the frontend reads the `next` parameter and sends the user there.

---

### Forgot Password

The user navigates to `/forgot-password` (`src/app/forgot-password/page.tsx`) and submits their email. The form posts `{ email }` to `POST /api/auth/forgot-password` (`src/app/api/auth/forgot-password/route.ts`).

Regardless of whether the account exists, the server returns an identical `200` response: "If an account with that email exists, a reset link has been sent." This prevents email enumeration. The frontend always shows the same success screen, even on network failure. Internally, if the user exists and is verified, the server generates 32 bytes of cryptographically random data (`crypto.randomBytes(32)`), computes its SHA-256 hash, stores only the hash in `PasswordResetToken`, and emails a URL containing the raw token. The raw token never touches the database.

---

### Password Reset

The user clicks the link, landing at `/reset-password?token=<rawToken>` (`src/app/reset-password/page.tsx`). The form posts `{ token, password, confirmPassword }` to `POST /api/auth/reset-password` (`src/app/api/auth/reset-password/route.ts`).

The server re-derives the SHA-256 hash from the submitted token and looks it up. Fast-fail checks run in sequence: token not found (`TOKEN_INVALID`), token already used — `usedAt IS NOT NULL` (`TOKEN_ALREADY_USED`), and token expired (`TOKEN_EXPIRED`). Each returns a distinct error code the frontend maps to a specific screen with a call-to-action. To protect against concurrent race conditions, token consumption is made atomic at the database level via a conditional update (`usedAt = now WHERE id = ? AND usedAt IS NULL AND expiresAt > now`). Exactly one concurrent request can successfully claim the token (affecting 1 row); any concurrent replay affects 0 rows and is rejected as `TOKEN_ALREADY_USED`. The winning request then updates `passwordHash` and deletes all active sessions in an atomic transaction, invalidating existing sessions immediately.

---

### Sign-Out

The user clicks Sign Out on `/dashboard`. A `POST /api/auth/signout` request is sent (`src/app/api/auth/signout/route.ts`). The server calls `destroySession`, which reads the `auth_session` cookie, hashes it, deletes the matching `Session` row from the database, and removes the cookie. The client is redirected to `/signin`.

---

## 4. The Data Model

Four tables. All relationships and constraints are declared in `prisma/schema.prisma`. The engine is SQLite at `prisma/dev.db`.

---

### `users`

Holds one row per registered identity.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | String (cuid) | No | Application-generated cuid. Avoids sequential integer leakage. |
| `email` | String | No | `@unique` — enforced at DB level, not only in application code. Lowercased before storage. |
| `name` | String | **Yes** | Optional display name. Nullable because the registration form does not require it. |
| `passwordHash` | String | No | bcrypt hash with embedded salt and cost factor. Raw password is never stored. |
| `emailVerified` | Boolean | No | Defaults `false`. Gating sign-in on this column is what makes the verification step load-bearing rather than cosmetic. |
| `createdAt` | DateTime | No | Immutable record timestamp. |
| `updatedAt` | DateTime | No | Auto-updated by Prisma `@updatedAt`. |

**Which constraints make invalid state impossible?** `@unique` on `email` means no two accounts can share an email even under concurrent inserts — the database rejects the second write with a `P2002` error the signup route catches explicitly. The `emailVerified` default of `false` means a user created by a partially-failed flow (transaction succeeded, email send failed) is still blocked from signing in until they complete verification.

---

### `sessions`

One row per active login session. Stores the SHA-256 hash of the token, not the token itself.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | String (cuid) | No | Primary key. |
| `sessionToken` | String | No | `@unique` SHA-256 hash of the raw token. Raw token lives only in the HTTP-only cookie. |
| `userId` | String | No | FK to `users.id` with `onDelete: Cascade`. |
| `expiresAt` | DateTime | No | 30 days from creation. Validated on every request in `validateSession`. |
| `createdAt` / `updatedAt` | DateTime | No | Audit timestamps. |

Indexes on `userId` and `expiresAt`.

**Which constraints make invalid state impossible?** `@unique` on `sessionToken` prevents two sessions from sharing a hash. `onDelete: Cascade` ensures sessions cannot become orphaned after user deletion. The token is hashed before storage, so a database read alone cannot produce a valid session cookie.

---

### `verification_codes`

Holds pending email verification codes. A user can have multiple rows if codes are generated before old ones expire; the route always selects the most recent by `createdAt desc`.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | String (cuid) | No | Primary key. |
| `code` | String | No | 6-digit numeric string. Stored plain — it has no value after expiry and is purged on use. |
| `userId` | String | No | FK to `users.id` with `onDelete: Cascade`. |
| `expiresAt` | DateTime | No | 10 minutes from creation. Checked server-side — client clock cannot affect this. |
| `lastSentAt` | DateTime | No | Defaults to now. The resend cooldown is computed as `now - lastSentAt`. Separate from `createdAt` so the resend route can express "when was this code last sent" without creating a new row. |
| `createdAt` | DateTime | No | Used to order and select the most recent code. |

Composite index `[userId, code]` for the lookup in `verify-code/route.ts`.

**Which constraints make invalid state impossible?** `onDelete: Cascade` removes codes when the user is deleted. `expiresAt` is a server-set timestamp — the client cannot submit an old code after expiry. All codes are deleted inside the same transaction that sets `emailVerified = true`, leaving no window in which a used code can be replayed.

---

### `password_reset_tokens`

One row per reset request. Rows are never deleted on use — `usedAt` is set instead, preserving an audit record.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | String (cuid) | No | Primary key. |
| `tokenHash` | String | No | `@unique` SHA-256 hash of the raw token emailed to the user. |
| `userId` | String | No | FK to `users.id` with `onDelete: Cascade`. |
| `expiresAt` | DateTime | No | 15 minutes from creation. Server-side comparison only. |
| `usedAt` | DateTime | **Yes** | Null until consumed. Non-null blocks replay. |
| `createdAt` | DateTime | No | Audit timestamp. |

**Which constraints make invalid state impossible?** `@unique` on `tokenHash` prevents duplicate token records. Single-use under concurrent requests is enforced via an atomic conditional database update (`WHERE id = ? AND usedAt IS NULL AND expiresAt > now`) where only the first request modifies a row. The password update and session revocation follow in a transaction that reverts the claim if interrupted, preventing partial state where a token is consumed without the password changing or vice-versa.

---

## 5. The Concepts

### Password Hashing

**What it is.** Password hashing is a one-way transformation of a plaintext password into a fixed-length string from which the original cannot be recovered in reasonable time. Unlike encryption there is no decryption key. Verification works by hashing the candidate again and comparing the result to the stored hash.

**Why it's needed.** If passwords were stored in plaintext and the database were exfiltrated, every user's password would be immediately available — including passwords they reuse elsewhere. A fast hash like MD5 or SHA-256 allows an attacker to compute billions of candidates per second on commodity GPU hardware. bcrypt is slow by design: cost factor 12 takes roughly 250ms per hash, making brute-force attacks orders of magnitude more expensive.

**How it's implemented.** In `src/lib/auth/password.ts`:

```typescript
const BCRYPT_COST_FACTOR = 12;

export async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

export async function verify(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

`bcryptjs` embeds a random salt in the output string, so two hashes of the same password produce different strings. The `passwordHash` column stores the full bcrypt output.

**What was chosen against.** Argon2id is the current OWASP recommendation over bcrypt because it also consumes configurable amounts of memory, making GPU-based attacks even more expensive. It was not used here because `bcryptjs` is a pure-JavaScript implementation requiring no native binaries, which simplifies the build on Windows. For production, the upgrade path is a single function swap with a re-hashing strategy on next login.

---

### Timing-Safe Comparisons

**What it is.** A timing attack is an exploit where an attacker measures how long a server takes to respond in order to infer something about its internal state. If a login handler returned immediately for unknown emails but took 250ms for wrong passwords — the bcrypt compare — an attacker could distinguish "email not registered" from "email exists, wrong password" purely by measuring latency.

**Why it's needed.** Knowing which emails are registered is the first step in a targeted credential-stuffing attack. An attacker with a list of addresses can silently validate which ones have accounts before ever making a visible failed login attempt, staying under rate-limit thresholds.

**How it's implemented.** In `src/app/api/auth/signin/route.ts`:

```typescript
const DUMMY_HASH =
  "$2b$12$invalidhashusedtomaintainconstanttimingXXXXXXXXXXXXXXX";

const passwordMatches = await verify(password, user?.passwordHash ?? DUMMY_HASH);

if (!user || !passwordMatches) {
  return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
}
```

Whether or not the account exists, `bcrypt.compare` is always called. For non-existent accounts it runs against the dummy hash, taking the same ~250ms. The error message is identical for both cases.

**What was chosen against.** Relying solely on rate limiting to prevent enumeration was considered. That approach is weaker: a patient attacker can probe slowly, staying under the rate limit, while still extracting information from timing differences. Constant-time behaviour closes the channel entirely regardless of rate limit configuration.

---

### HTTP-Only Session Cookies

**What it is.** An HTTP-only cookie is stored by the browser and sent automatically on every matching request, but JavaScript running on the page cannot read or write it. The `httpOnly` flag is set by the server in the `Set-Cookie` response header.

**Why it's needed.** If session tokens were stored in `localStorage` or accessible via `document.cookie`, any XSS payload — even one injected through a compromised npm dependency — could silently exfiltrate the token. An HTTP-only cookie cannot be read by any script on the page, so XSS can cause visible damage but cannot steal sessions.

**How it's implemented.** In `src/lib/auth/session.ts`:

```typescript
cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  expires: expiresAt,
  maxAge: SESSION_MAX_AGE_SECONDS,
});
```

`secure: true` in production means the cookie is only sent over HTTPS. `sameSite: "lax"` blocks the cookie from cross-origin POST requests, preventing CSRF without a separate CSRF token.

**What was chosen against.** JWT tokens stored in memory (not `localStorage`) are sometimes proposed as an alternative. In-memory JWTs survive page reload only if passed through a shared worker or BroadcastChannel, adding complexity. They also cannot be revoked before expiry without a server-side denylist, which reintroduces database lookups and eliminates the main advantage. Database-backed sessions with an HTTP-only cookie are simpler and revocable.

---

### Hashing Tokens Before Database Storage

**What it is.** The raw session token and the raw password reset token are never written to the database. Their SHA-256 hashes are stored instead. The raw tokens exist only in the browser cookie and in the reset link URL.

**Why it's needed.** If the database is read by an attacker — via SQL injection, a compromised read replica, or a leaked backup — the token rows are useless. Replaying a SHA-256 hash as a cookie or URL token does not work because the server re-hashes the submitted value and looks up the result. The attacker would need the pre-image, which is not in the database.

**How it's implemented.** In `src/lib/auth/session.ts`:

```typescript
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Creation: raw token in cookie, hash in DB
const rawToken = crypto.randomBytes(32).toString("hex");
const tokenHash = hashSessionToken(rawToken);
await prisma.session.create({ data: { sessionToken: tokenHash, userId, expiresAt } });
cookieStore.set(SESSION_COOKIE_NAME, rawToken, { httpOnly: true, ... });

// Validation: hash the submitted cookie value, look up the hash
const tokenHash = hashSessionToken(rawToken);
const session = await prisma.session.findUnique({ where: { sessionToken: tokenHash } });
```

The same pattern is used for `PasswordResetToken` in `forgot-password/route.ts` and `reset-password/route.ts`.

**What was chosen against.** HMAC-SHA256 was considered — it would bind the hash to `AUTH_SECRET`, providing an additional layer if SHA-256 were ever weakened. SHA-256 was used because 32 bytes of `crypto.randomBytes` provides 256 bits of entropy, making pre-image attacks computationally infeasible regardless. HMAC adds complexity without meaningful additional security at this entropy level.

---

### In-Memory Rate Limiting

**What it is.** Rate limiting counts how many times a given key has triggered an action within a time window and blocks further requests once the count exceeds the threshold.

**Why it's needed.** Without rate limiting, the sign-in endpoint can be hit thousands of times per second. A 6-digit OTP has only 1,000,000 possible values; without throttling an attacker exhausts the space in seconds. The signup endpoint without rate limiting enables account-creation floods that fill the database and exhaust email-sending quota.

**How it's implemented.** In `src/lib/rate-limit.ts`, a `Map<string, { count, resetTime }>` is stored on `globalThis` so it survives Next.js hot-reloads. A periodic `setInterval` cleans up expired keys:

```typescript
const rateLimitStore = (globalThis as any)._rateLimitStore || new Map();

export function checkRateLimit(id: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const rec = rateLimitStore.get(id);
  if (!rec || now >= rec.resetTime) {
    rateLimitStore.set(id, { count: 1, resetTime: now + opts.windowSeconds * 1000 });
    return { success: true, remaining: opts.limit - 1, ... };
  }
  if (rec.count >= opts.limit) {
    return { success: false, retryAfter: Math.ceil((rec.resetTime - now) / 1000), ... };
  }
  rec.count += 1;
  return { success: true, remaining: opts.limit - rec.count, ... };
}
```

Rejected responses include RFC 6585-compliant `Retry-After` and `X-RateLimit-*` headers.

**What was chosen against.** Redis-backed rate limiting (via `ioredis` and a sliding-window Lua script) is the production-correct choice — it survives restarts and works across multiple server instances. In-memory rate limiting was chosen because the project runs on a single Next.js process and adding Redis would have required Docker or a cloud instance, significantly raising the setup cost for a study project. The `checkRateLimit` call site is isolated to one file — replacing the store with Redis requires changing only `src/lib/rate-limit.ts`.

---

### Atomic Transactions for State Transitions

**What it is.** A database transaction groups multiple SQL statements so they either all succeed together or all fail together, with no partial state visible to other connections.

**Why it's needed.** The signup route creates a `User` and a `VerificationCode` in the same operation. If the `User` insert succeeded but the `VerificationCode` insert failed (disk full, process killed), the user would exist with no way to verify their email and no way to re-register — the `@unique` constraint would block a fresh attempt. At verification time, marking `emailVerified = true` and deleting codes must be atomic: if deletion failed, the same code could be replayed.

**How it's implemented.** In `src/app/api/auth/signup/route.ts`:

```typescript
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { email, passwordHash, ... } });
  await tx.verificationCode.create({ data: { code, userId: user.id, expiresAt } });
});
```

In `src/app/api/auth/verify-code/route.ts`:

```typescript
await prisma.$transaction([
  prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }),
  prisma.verificationCode.deleteMany({ where: { userId: user.id } }),
]);
```

The reset-password route similarly guarantees atomicity: it claims the token via an atomic conditional database update (`usedAt IS NULL AND expiresAt > now`) to eliminate concurrent replay races, followed by a transaction updating `passwordHash` and deleting active sessions, reverting the claim if the transaction fails.

**What was chosen against.** Sequential independent writes were explicitly rejected. Process crashes, OOM kills, and database network interruptions happen in production and would leave the application in states very difficult to recover from automatically.

---

### Idempotent Registration

**What it is.** An idempotent operation produces the same observable result whether called once or many times. Here: submitting the same valid registration payload twice should not cause an error, create a duplicate account, or send a second email.

**Why it's needed.** Users double-click submit buttons. Mobile browsers retry on unreliable connections. The network can drop between send and response, prompting a retry. Without idempotency handling, the second request hits the `@unique` email constraint and returns "account already exists" — confusing to someone who has never successfully registered.

**How it's implemented.** In `src/app/api/auth/signup/route.ts`, when the email exists but the account is unverified:

```typescript
const isSamePassword = await verify(password, existingUser.passwordHash);
if (isSamePassword) {
  return NextResponse.json({
    success: true,
    message: "Account pending verification. Verification code sent.",
    email: normalizedEmail,
    idempotent: true,
  }, { status: 200 });
}
// Different password on same email: genuine conflict
return NextResponse.json(
  { error: "An account with this email is already registered." },
  { status: 409 }
);
```

The concurrent race condition (two identical requests both passing the existence check before either commits) is also handled: the `P2002` error is caught and the "loser" returns an idempotent `200` after verifying the password against the winner's hash.

**What was chosen against.** Always returning `409 Conflict` for duplicate submissions was considered. That is correct for a genuinely different user claiming an existing email, but confusing for a double-click from the same user. Distinguishing by comparing the password hash lets the server return the right response in each situation.

---

## 6. What Went Wrong

### Problem 1 — Rate-limit store lost on every hot-reload

**Symptom.** During development, every time a source file was saved and Next.js hot-reloaded the route handlers, the in-memory rate-limit `Map` was empty again. Rate limits that should have been hit — five failed sign-in attempts — reset every time a code change was made, making it impossible to test the limiting behaviour during active development.

**Investigation.** First hypothesis: the periodic cleanup interval was purging entries before they expired. Added `console.log` before and after the cleanup loop — the map was not being cleaned by the interval; it was being re-instantiated entirely. Checked Next.js module lifecycle documentation and found that App Router route handler modules are re-evaluated from scratch on each hot-module-replacement event.

**Cause.** A plain `const rateLimitStore = new Map()` at module level initialises a fresh empty map every time the module is re-evaluated, which in development means every file save.

**Fix.** Attach the store to `globalThis`, which persists across module re-evaluations for the lifetime of the Node.js process:

```typescript
const rateLimitStore =
  (globalThis as any)._rateLimitStore ?? new Map();

if (!(globalThis as any)._rateLimitStore) {
  (globalThis as any)._rateLimitStore = rateLimitStore;
}
```

The same guard was applied to the cleanup `setInterval` to prevent a new timer being registered on every hot-reload.

---

### Problem 2 — bcrypt input silently truncated at 72 bytes

**Symptom.** A test user set a password containing emoji. The password was accepted and a bcrypt hash was created. Sign-in with the same password worked. A variation with different characters appended after the emoji — beyond byte 72 — also signed in successfully, which should have been impossible.

**Investigation.** First assumption: a bug in the `bcrypt.compare` path using the wrong hash. Added logs confirming both calls used the same stored hash. Both matched. Checked the bcrypt specification: bcrypt silently truncates input at 72 bytes, not 72 characters. A single emoji is 4 bytes in UTF-8. A password with several emoji can exceed 72 bytes while JavaScript's `String.length` — which counts UTF-16 code units — reports a value well under 72.

**Cause.** The password schema validated `val.length <= 72`. Two passwords differing only beyond byte 72 produced identical bcrypt hashes and were mutually interchangeable at sign-in.

**Fix.** Updated `passwordSchema` in `src/lib/validation/auth.ts` to use `TextEncoder` to measure byte length:

```typescript
.refine(
  (val) => new TextEncoder().encode(val).length <= 72,
  "Password cannot exceed 72 bytes (multi-byte characters like emojis count as multiple bytes)"
)
```

The error message explains the constraint, because "72 bytes" is not intuitive to a non-technical user.

---

### Problem 3 — Middleware not recognised, redirects never fired

**Symptom.** Navigating to `/dashboard` without a session cookie did not redirect to `/signin`. The dashboard page attempted to render, called `getCurrentUser()`, got `null`, and performed a server-side `redirect()` inside the Server Component. This meant a full render completed before the redirect — occasional flashes of unstyled dashboard content were visible on slow connections, and the user's original destination URL was not preserved in a `?next=` parameter.

**Investigation.** The middleware file was named `middleware.ts` in `src/`. The redirect logic was correct. Added `console.log` at the top — it never printed, confirming the middleware was not running. Checked the Next.js 16 documentation in `node_modules/next/dist/docs/`.

**Cause.** Next.js 16 changed middleware conventions. The project was using the `proxy.ts` pattern — a named default export matching the filename — but Next.js config did not reference it, and the file name did not match the conventional `middleware.ts` expected at the project root. The file was invisible to the framework.

**Fix.** Renamed the file to `src/proxy.ts`, changed the default export name to `proxy`, added the `config` export with the matcher pattern. Verified `next.config.ts` recognised the file. Redirects now fire at the Edge Runtime before any Server Component renders, and `?next=` is set correctly for post-login redirection.

---

## 7. What This Slice Does Not Handle

### Breaks at scale — architectural limits, not oversights

- **In-memory rate limiting.** A single-process `Map` does not survive a restart and is not shared across multiple server instances. Every pod has its own counter, effectively dividing the rate limit by the number of instances. Replacing with Redis is a one-file change but requires infrastructure.
- **SQLite under concurrent writes.** SQLite uses file-level write locks. Under concurrent registration traffic, writes queue and latency spikes. At meaningful traffic volume this must be replaced with PostgreSQL or MySQL. The Prisma schema uses no SQLite-specific features; changing `provider = "sqlite"` to `provider = "postgresql"` and updating `DATABASE_URL` is the full migration path.
- **No session renewal.** Sessions expire at a fixed 30-day absolute TTL. An active user whose session reaches 30 days is logged out without warning. Sliding-window renewal — updating `expiresAt` on each validated request — was not implemented.

### Needed before real users — deliberately out of scope

- **Email deliverability.** `sendVerificationEmail` uses Resend's `onboarding@resend.dev` sandbox domain, which cannot send to arbitrary external addresses. A real deployment requires a verified sender domain in Resend and `EMAIL_FROM` set accordingly.
- **HTTPS enforcement.** The `secure` flag on the session cookie is conditional on `NODE_ENV === "production"`, but nothing in this codebase enforces that production traffic runs over HTTPS. A reverse proxy or hosting platform must terminate TLS.
- **Token and session cleanup.** `PasswordResetToken` rows are never deleted by design (audit trail). Expired `Session` rows are deleted lazily on access but never proactively. A scheduled cleanup job is needed for any database with real retention limits.

### Left out due to time

- **Account deletion.** There is no route or UI for a user to delete their own account.
- **Email change flow.** Changing a registered email requires sending a verification code to the new address and committing only after confirmation — a non-trivial flow that was deferred.
- **Screen reader accessibility.** Error messages use `role="alert"` but focus management was not audited across browsers and assistive technologies.
- **Automated tests.** There is no test suite. The validation schemas and route handlers are structured to be unit-testable (pure functions, Prisma singleton injectable via module substitution), but no tests were written.

---

## 8. If I Built This Again

If I built this again I would use an Upstash Redis rate limiter from day one rather than as an eventual upgrade — not because the in-memory implementation is wrong in its logic, but because debugging the hot-reload persistence issue (Problem 1 above) consumed a disproportionate amount of time, and every manual test of rate-limit behaviour required restarting the dev server to reset state. The Upstash HTTP client works in the Edge Runtime without a connection pool, costs nothing at development traffic levels, and its state persists across restarts and hot-reloads, meaning the behaviour during development is identical to production from the first commit rather than only after a late refactor that introduces risk.
