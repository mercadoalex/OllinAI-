/**
 * Unit tests for the rate limiting middleware.
 *
 * Tests cover: in-memory sliding window, request counting,
 * limit enforcement, Retry-After header, and store reset.
 *
 * Requirements: 11.3, 11.4
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  withRateLimit,
  resetRateLimitStore,
  getRateLimitCount,
} from "@/lib/middleware/rate-limit";
import { NextResponse } from "next/server";

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetRateLimitStore();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("withRateLimit", () => {
  it("should allow requests under the limit", async () => {
    const result = await withRateLimit("tenant-001");
    expect(result).toBeNull();
  });

  it("should count requests for a tenant", async () => {
    await withRateLimit("tenant-001");
    await withRateLimit("tenant-001");
    await withRateLimit("tenant-001");

    expect(getRateLimitCount("tenant-001")).toBe(3);
  });

  it("should isolate rate limits per tenant", async () => {
    for (let i = 0; i < 5; i++) {
      await withRateLimit("tenant-001");
    }
    for (let i = 0; i < 3; i++) {
      await withRateLimit("tenant-002");
    }

    expect(getRateLimitCount("tenant-001")).toBe(5);
    expect(getRateLimitCount("tenant-002")).toBe(3);
  });

  it("should return 429 when limit is exceeded (100 requests/min)", async () => {
    // Make 100 requests (all allowed)
    for (let i = 0; i < 100; i++) {
      const result = await withRateLimit("tenant-001");
      expect(result).toBeNull();
    }

    // 101st request should be rate limited
    const result = await withRateLimit("tenant-001");
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(429);
  });

  it("should include Retry-After header in 429 response", async () => {
    for (let i = 0; i < 100; i++) {
      await withRateLimit("tenant-001");
    }

    const result = await withRateLimit("tenant-001");
    expect(result).not.toBeNull();
    expect(result!.headers.get("Retry-After")).toBeDefined();
    const retryAfter = parseInt(result!.headers.get("Retry-After")!, 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("should include error body with code and retryAfter", async () => {
    for (let i = 0; i < 100; i++) {
      await withRateLimit("tenant-001");
    }

    const result = await withRateLimit("tenant-001");
    const body = await result!.json();
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.error).toContain("Rate limit exceeded");
  });

  it("should allow requests from different tenants independently", async () => {
    // Fill up tenant-001's limit
    for (let i = 0; i < 100; i++) {
      await withRateLimit("tenant-001");
    }

    // tenant-002 should still be allowed
    const result = await withRateLimit("tenant-002");
    expect(result).toBeNull();
  });
});

describe("resetRateLimitStore", () => {
  it("should clear all rate limit entries", async () => {
    for (let i = 0; i < 50; i++) {
      await withRateLimit("tenant-001");
    }

    expect(getRateLimitCount("tenant-001")).toBe(50);

    resetRateLimitStore();

    expect(getRateLimitCount("tenant-001")).toBe(0);
  });
});

describe("getRateLimitCount", () => {
  it("should return 0 for unknown tenants", () => {
    expect(getRateLimitCount("nonexistent")).toBe(0);
  });
});
