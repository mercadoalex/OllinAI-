/**
 * Unit tests for tier gate middleware.
 *
 * Tests cover:
 * - Feature gate rejects requests on insufficient tier (8.5)
 * - Service limit gate rejects when limit exceeded (8.4)
 * - Returns 403 with descriptive upgrade messages
 * - Default to "starter" when no subscription record exists
 * - Combined gate checks both feature and service limit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Mock the DynamoDB client module
vi.mock("@/lib/dynamo/client", () => ({
  getDocumentClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  TableNames: {
    EVENTS: "ollinai-events",
    INCIDENTS: "ollinai-incidents",
    METRICS: "ollinai-metrics",
    CONFIG: "ollinai-config",
    AUDIT: "ollinai-audit",
  },
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  GetCommand: vi.fn().mockImplementation((input) => ({ input })),
  QueryCommand: vi.fn(),
  PutCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  DeleteCommand: vi.fn(),
}));

import { getDocumentClient } from "@/lib/dynamo/client";
import {
  getTenantSubscription,
  withTierGate,
  withServiceLimitGate,
  withFullTierGate,
  type TierGateErrorResponse,
  type TierGateContext,
} from "@/lib/middleware/tier-gate";

const mockSend = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
    send: mockSend,
  });
});

// ─── getTenantSubscription ─────────────────────────────────────────────────────

describe("getTenantSubscription", () => {
  it("returns 'starter' when no subscription record exists", async () => {
    mockSend.mockResolvedValue({ Item: undefined });
    const tier = await getTenantSubscription("tenant-1");
    expect(tier).toBe("starter");
  });

  it("returns the stored tier", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#tenant-1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });
    const tier = await getTenantSubscription("tenant-1");
    expect(tier).toBe("pro");
  });

  it("returns enterprise tier when stored", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#tenant-1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "enterprise", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });
    const tier = await getTenantSubscription("tenant-1");
    expect(tier).toBe("enterprise");
  });

  it("queries with correct PK and SK", async () => {
    mockSend.mockResolvedValue({ Item: undefined });
    await getTenantSubscription("tenant-abc");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.input.TableName).toBe("ollinai-config");
    expect(command.input.Key.PK).toBe("TENANT#tenant-abc");
    expect(command.input.Key.SK).toBe("SUBSCRIPTION#current");
  });
});

// ─── withTierGate ──────────────────────────────────────────────────────────────

describe("withTierGate", () => {
  it("returns TierGateContext when feature is available", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#t1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });

    const result = await withTierGate("t1", "risk_score");
    expect(result).not.toBeInstanceOf(NextResponse);
    const ctx = result as TierGateContext;
    expect(ctx.tier).toBe("pro");
  });

  it("returns 403 when feature is not available on starter tier", async () => {
    mockSend.mockResolvedValue({ Item: undefined }); // defaults to starter

    const result = await withTierGate("t1", "risk_score");
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);

    const body: TierGateErrorResponse = await response.json();
    expect(body.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(body.currentTier).toBe("starter");
    expect(body.requiredAction).toBe("upgrade");
    expect(body.error).toContain("Deployment Risk Scoring");
    expect(body.error).toContain("Pro");
  });

  it("returns 403 when pro tier requests enterprise-only feature", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#t1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });

    const result = await withTierGate("t1", "audit_logs");
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);

    const body: TierGateErrorResponse = await response.json();
    expect(body.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(body.currentTier).toBe("pro");
    expect(body.error).toContain("Audit Logs");
    expect(body.error).toContain("Enterprise");
  });

  it("allows enterprise tier to access all features", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#t1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "enterprise", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });

    const result = await withTierGate("t1", "data_residency");
    expect(result).not.toBeInstanceOf(NextResponse);
    const ctx = result as TierGateContext;
    expect(ctx.tier).toBe("enterprise");
  });

  it("returns 403 for starter requesting recommendations", async () => {
    mockSend.mockResolvedValue({ Item: undefined });

    const result = await withTierGate("t1", "recommendations");
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    const body: TierGateErrorResponse = await response.json();
    expect(body.error).toContain("Actionable Recommendations");
    expect(body.error).toContain("Starter");
  });

  it("returns 403 for starter requesting incident_correlation", async () => {
    mockSend.mockResolvedValue({ Item: undefined });

    const result = await withTierGate("t1", "incident_correlation");
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    const body: TierGateErrorResponse = await response.json();
    expect(body.error).toContain("Incident Correlation");
  });
});

// ─── withServiceLimitGate ──────────────────────────────────────────────────────

describe("withServiceLimitGate", () => {
  it("returns TierGateContext when under service limit", async () => {
    mockSend.mockResolvedValue({ Item: undefined }); // starter

    const result = await withServiceLimitGate("t1", 3);
    expect(result).not.toBeInstanceOf(NextResponse);
    const ctx = result as TierGateContext;
    expect(ctx.tier).toBe("starter");
  });

  it("returns 403 when starter reaches 5 services", async () => {
    mockSend.mockResolvedValue({ Item: undefined }); // starter

    const result = await withServiceLimitGate("t1", 5);
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);

    const body: TierGateErrorResponse = await response.json();
    expect(body.code).toBe("TIER_LIMIT_EXCEEDED");
    expect(body.currentTier).toBe("starter");
    expect(body.requiredAction).toBe("upgrade");
    expect(body.error).toContain("5");
    expect(body.error).toContain("Pro");
  });

  it("allows pro tier with any service count", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#t1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });

    const result = await withServiceLimitGate("t1", 100);
    expect(result).not.toBeInstanceOf(NextResponse);
    const ctx = result as TierGateContext;
    expect(ctx.tier).toBe("pro");
  });

  it("allows enterprise tier with any service count", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#t1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "enterprise", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });

    const result = await withServiceLimitGate("t1", 500);
    expect(result).not.toBeInstanceOf(NextResponse);
  });
});

// ─── withFullTierGate ──────────────────────────────────────────────────────────

describe("withFullTierGate", () => {
  it("passes when no checks are specified", async () => {
    mockSend.mockResolvedValue({ Item: undefined }); // starter

    const result = await withFullTierGate("t1", {});
    expect(result).not.toBeInstanceOf(NextResponse);
  });

  it("rejects on feature check failure", async () => {
    mockSend.mockResolvedValue({ Item: undefined }); // starter

    const result = await withFullTierGate("t1", { feature: "risk_score" });
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
  });

  it("rejects on service limit failure", async () => {
    mockSend.mockResolvedValue({ Item: undefined }); // starter

    const result = await withFullTierGate("t1", {
      checkServiceLimit: { currentServiceCount: 5 },
    });
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    const body: TierGateErrorResponse = await response.json();
    expect(body.code).toBe("TIER_LIMIT_EXCEEDED");
  });

  it("checks feature before service limit", async () => {
    mockSend.mockResolvedValue({ Item: undefined }); // starter

    // Both would fail, but feature should be checked first
    const result = await withFullTierGate("t1", {
      feature: "risk_score",
      checkServiceLimit: { currentServiceCount: 10 },
    });
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    const body: TierGateErrorResponse = await response.json();
    expect(body.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("passes when both checks succeed", async () => {
    mockSend.mockResolvedValue({
      Item: {
        PK: "TENANT#t1",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });

    const result = await withFullTierGate("t1", {
      feature: "risk_score",
      checkServiceLimit: { currentServiceCount: 50 },
    });
    expect(result).not.toBeInstanceOf(NextResponse);
    const ctx = result as TierGateContext;
    expect(ctx.tier).toBe("pro");
  });
});
