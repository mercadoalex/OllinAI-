/**
 * Rate Limiting Middleware — OllinAI Platform
 *
 * Implements sliding window rate limiting using Vercel KV (Redis).
 * Enforces 100 requests/min per tenant for API endpoints.
 * Returns HTTP 429 with Retry-After header when limit is exceeded.
 *
 * Requirements:
 *  - 11.3: Rate limit API requests to 100 per minute per tenant
 *  - 11.4: Return HTTP 429 with Retry-After header
 */

import { NextResponse } from "next/server";

/** Maximum requests per window */
const MAX_REQUESTS = 100;

/** Time window in seconds (1 minute) */
const WINDOW_SECONDS = 60;

/** Redis key prefix for rate limiting */
const KEY_PREFIX = "ratelimit:";

/** Response type for rate limit errors */
export interface RateLimitErrorResponse {
  error: string;
  code: "RATE_LIMIT_EXCEEDED";
  retryAfter: number;
}

/**
 * In-memory sliding window store for development/testing.
 * In production, this uses Vercel KV (Redis).
 */
const inMemoryStore = new Map<string, { timestamps: number[] }>();

/**
 * Checks rate limiting for a given tenant.
 *
 * Uses a sliding window counter:
 * - Records each request timestamp
 * - Counts requests within the sliding window
 * - Returns 429 if limit exceeded
 *
 * @param tenantId - The tenant to rate limit
 * @returns null if allowed, or a NextResponse (429) if rate limited
 *
 * @example
 * ```ts
 * const rateLimitResult = await withRateLimit(tenantId);
 * if (rateLimitResult instanceof NextResponse) {
 *   return rateLimitResult; // 429
 * }
 * // Proceed with request...
 * ```
 */
export async function withRateLimit(
  tenantId: string
): Promise<null | NextResponse> {
  const key = `${KEY_PREFIX}${tenantId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_SECONDS * 1000;

  try {
    // Attempt to use Vercel KV (Redis) in production
    if (isRedisAvailable()) {
      return await checkRateLimitRedis(key, now, windowStart);
    }

    // Fall back to in-memory store for development/testing
    return checkRateLimitInMemory(key, now, windowStart);
  } catch (error) {
    // On rate limiter failure, allow the request through (fail open)
    console.error("Rate limiter error:", error);
    return null;
  }
}

/**
 * Redis-backed sliding window rate limiter.
 * Uses sorted sets with timestamps as scores for precise sliding window.
 */
async function checkRateLimitRedis(
  key: string,
  now: number,
  windowStart: number
): Promise<null | NextResponse> {
  try {
    // Dynamic import to avoid build errors when @vercel/kv is not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { kv } = await (Function('return import("@vercel/kv")')() as Promise<{ kv: any }>);

    // Use a pipeline for atomic operations:
    // 1. Remove expired entries (before window start)
    // 2. Add current request
    // 3. Count requests in window
    // 4. Set TTL on key
    const pipe = kv.pipeline();
    pipe.zremrangebyscore(key, 0, windowStart);
    pipe.zadd(key, { score: now, member: `${now}:${Math.random()}` });
    pipe.zcard(key);
    pipe.expire(key, WINDOW_SECONDS + 1);

    const results = await pipe.exec();
    const requestCount = results[2] as number;

    if (requestCount > MAX_REQUESTS) {
      const retryAfter = Math.ceil(WINDOW_SECONDS - (now - windowStart) / 1000);
      return createRateLimitResponse(retryAfter);
    }

    return null;
  } catch (error) {
    // If Redis is unavailable, fall back to in-memory
    console.warn("Redis rate limiter failed, falling back to in-memory:", error);
    return checkRateLimitInMemory(key, now, windowStart);
  }
}

/**
 * In-memory sliding window rate limiter for development/testing.
 * Uses a simple array of timestamps per key.
 */
function checkRateLimitInMemory(
  key: string,
  now: number,
  windowStart: number
): null | NextResponse {
  let entry = inMemoryStore.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    inMemoryStore.set(key, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  // Check if limit exceeded
  if (entry.timestamps.length >= MAX_REQUESTS) {
    // Calculate retry-after based on oldest request in window
    const oldestInWindow = entry.timestamps[0];
    const retryAfter = Math.max(
      1,
      Math.ceil((oldestInWindow + WINDOW_SECONDS * 1000 - now) / 1000)
    );
    return createRateLimitResponse(retryAfter);
  }

  // Record this request
  entry.timestamps.push(now);

  return null;
}

/**
 * Creates a 429 Too Many Requests response with Retry-After header.
 */
function createRateLimitResponse(retryAfter: number): NextResponse {
  const response = NextResponse.json(
    {
      error: "Rate limit exceeded. Maximum 100 requests per minute.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter,
    } satisfies RateLimitErrorResponse,
    { status: 429 }
  );

  response.headers.set("Retry-After", String(retryAfter));
  return response;
}

/**
 * Checks if Redis/Vercel KV is available.
 */
function isRedisAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/**
 * Resets the in-memory rate limit store. Useful for testing.
 */
export function resetRateLimitStore(): void {
  inMemoryStore.clear();
}

/**
 * Gets the current request count for a tenant. Useful for testing.
 */
export function getRateLimitCount(tenantId: string): number {
  const key = `${KEY_PREFIX}${tenantId}`;
  const entry = inMemoryStore.get(key);
  if (!entry) return 0;

  const windowStart = Date.now() - WINDOW_SECONDS * 1000;
  return entry.timestamps.filter((ts) => ts > windowStart).length;
}
