import { NextRequest, NextResponse } from "next/server";

interface RateLimitRecord {
  count: number;
  resetTime: number; // Unix epoch ms when the window resets
}

// In-memory rate limiting store (sliding/fixed window counter)
// Using globalThis to ensure the map persists across hot-reloads in development
const rateLimitStore: Map<string, RateLimitRecord> =
  (globalThis as unknown as { _rateLimitStore?: Map<string, RateLimitRecord> })._rateLimitStore ||
  new Map();

if (!(globalThis as unknown as { _rateLimitStore?: Map<string, RateLimitRecord> })._rateLimitStore) {
  (globalThis as unknown as { _rateLimitStore?: Map<string, RateLimitRecord> })._rateLimitStore = rateLimitStore;
}

// Periodic cleanup to avoid memory leak from stale keys
const CLEANUP_INTERVAL_MS = 60 * 1000;
if (!(globalThis as unknown as { _rateLimitCleanup?: boolean })._rateLimitCleanup) {
  (globalThis as unknown as { _rateLimitCleanup?: boolean })._rateLimitCleanup = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetTime) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS).unref?.();
}

export interface RateLimitOptions {
  limit: number; // Maximum number of requests allowed in window
  windowSeconds: number; // Time window duration in seconds
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
  retryAfter: number; // Seconds until quota resets
}

/**
 * Checks and records an action against a rate limit rule.
 *
 * @param identifier Unique key (e.g. `signin:127.0.0.1` or `resend:user@example.com`)
 * @param options Configuration for limit count and window duration
 */
export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions
): RateLimitResult {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;
  const existing = rateLimitStore.get(identifier);

  // If no record exists or window expired, start fresh window
  if (!existing || now >= existing.resetTime) {
    const resetTime = now + windowMs;
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime,
    });

    return {
      success: true,
      limit: options.limit,
      remaining: options.limit - 1,
      reset: Math.ceil(resetTime / 1000),
      retryAfter: 0,
    };
  }

  // Window is active
  if (existing.count >= options.limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetTime - now) / 1000));
    return {
      success: false,
      limit: options.limit,
      remaining: 0,
      reset: Math.ceil(existing.resetTime / 1000),
      retryAfter,
    };
  }

  // Increment counter
  existing.count += 1;
  const retryAfter = 0;

  return {
    success: true,
    limit: options.limit,
    remaining: options.limit - existing.count,
    reset: Math.ceil(existing.resetTime / 1000),
    retryAfter,
  };
}

/**
 * Extracts client IP from request headers, falling back to 127.0.0.1 in local dev.
 */
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "127.0.0.1";
}

/**
 * Formats standard 429 Too Many Requests response with RFC-compliant headers.
 */
export function rateLimitExceededResponse(
  message: string,
  result: RateLimitResult
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      retryAfter: result.retryAfter,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: new Date(result.reset * 1000).toISOString(),
    },
    {
      status: 429,
      headers: {
        "Retry-After": result.retryAfter.toString(),
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": result.reset.toString(),
      },
    }
  );
}
