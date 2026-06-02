/**
 * Unit tests for the subscription tier management API.
 *
 * Tests cover:
 * - GET /api/subscriptions — returns current tier info
 * - PUT /api/subscriptions — tier upgrade
 * - PUT /api/subscriptions — tier downgrade
 * - PUT /api/subscriptions — no change
 * - Validation errors for invalid tier
 * - Authorization enforcement (tenant_admin required)
 *
 * Requirements: 8.6, 8.7, 8.8
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockSend = vi.fn();
vi.mock("@/lib/dynamo/client", () => ({
  getDocumentClient: () => ({ send: mockSend }),
  TableNames: {
    EVENTS: "ollinai-events",
    INCIDENTS: "ollinai-incidents",
    METRICS: "ollinai-metrics",
    CONFIG: "ollinai-config",
    AUDIT: "ollinai-audit",
  },
}));

vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

vi.mock("@/lib/middleware/authorize", () => ({
  withAuthorization: vi.fn(),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  GetCommand: vi.fn().mockImplementation((input) => ({ input })),
  PutCommand: vi.fn().mockImplementation((input) => ({ input })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ input })),
  UpdateCommand: vi.fn().mockImplementation((input) => ({ input })),
  DeleteCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { withAuthorization } from "@/lib/middleware/authorize";
import { GET, PUT } from "@/app/api/subscriptions/route";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const mockSession = {
  userId: "user-001",
  tenantId: "tenant-001",
  role: "tenant_admin" as const,
  teamIds: ["team-001"],
  expiresAt: new Date(Date.now() + 3600000),
};

function createRequest(
  url: string,
  method: string,
  body?: unknown
): NextRequest {
  const init: { method: string; headers?: Record<string, string>; body?: string } = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(new URL(url, "http://localhost"), init);
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withAuthorization).mockResolvedValue({ session: mockSession });
});

// ─── Tests: GET /api/subscriptions ─────────────────────────────────────────────

describe("GET /api/subscriptions", () => {
  it("returns starter tier with default limits when no record exists", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const req = createRequest("/api/subscriptions", "GET");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("starter");
    expect(body.displayName).toBe("Starter");
    expect(body.maxServices).toBe(5);
    expect(body.retentionDays).toBe(30);
    expect(body.features).toEqual([]);
  });

  it("returns pro tier info when subscription is pro", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: "TENANT#tenant-001",
        SK: "SUBSCRIPTION#current",
        entityData: {
          tier: "pro",
          activatedAt: "2024-06-01T00:00:00Z",
          previousTier: "starter",
          tierChangedAt: "2024-06-01T00:00:00Z",
        },
      },
    });

    const req = createRequest("/api/subscriptions", "GET");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("pro");
    expect(body.displayName).toBe("Pro");
    expect(body.maxServices).toBeNull();
    expect(body.retentionDays).toBe(90);
    expect(body.features).toContain("risk_score");
    expect(body.features).toContain("recommendations");
    expect(body.features).toContain("incident_correlation");
    expect(body.previousTier).toBe("starter");
    expect(body.tierChangedAt).toBe("2024-06-01T00:00:00Z");
  });

  it("returns enterprise tier with all features", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: "TENANT#tenant-001",
        SK: "SUBSCRIPTION#current",
        entityData: {
          tier: "enterprise",
          activatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    const req = createRequest("/api/subscriptions", "GET");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("enterprise");
    expect(body.displayName).toBe("Enterprise");
    expect(body.maxServices).toBeNull();
    expect(body.retentionDays).toBeNull();
    expect(body.features).toContain("sso");
    expect(body.features).toContain("audit_logs");
    expect(body.features).toContain("api_access");
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createRequest("/api/subscriptions", "GET");
    const response = await GET(req);

    expect(response.status).toBe(401);
  });
});

// ─── Tests: PUT /api/subscriptions (Upgrade) ───────────────────────────────────

describe("PUT /api/subscriptions — Upgrade", () => {
  it("upgrades from starter to pro", async () => {
    // First call: GetCommand to read current subscription
    mockSend.mockResolvedValueOnce({ Item: undefined }); // starter default
    // Second call: PutCommand to write new subscription
    mockSend.mockResolvedValueOnce({});

    const req = createRequest("/api/subscriptions", "PUT", { tier: "pro" });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("pro");
    expect(body.previousTier).toBe("starter");
    expect(body.changeType).toBe("upgrade");
    expect(body.tierChangedAt).toBeDefined();
    expect(body.message).toContain("Upgraded");
    expect(body.message).toContain("Pro");
    expect(body.message).toContain("unlimited");
    expect(body.message).toContain("90-day");
  });

  it("upgrades from pro to enterprise", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: "TENANT#tenant-001",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });
    mockSend.mockResolvedValueOnce({});

    const req = createRequest("/api/subscriptions", "PUT", { tier: "enterprise" });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("enterprise");
    expect(body.previousTier).toBe("pro");
    expect(body.changeType).toBe("upgrade");
    expect(body.message).toContain("Enterprise");
    expect(body.message).toContain("unlimited");
  });

  it("stores previousTier and tierChangedAt in DynamoDB", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // starter
    mockSend.mockResolvedValueOnce({});

    const req = createRequest("/api/subscriptions", "PUT", { tier: "pro" });
    await PUT(req);

    // Check the PutCommand was called with proper data
    expect(mockSend).toHaveBeenCalledTimes(2);
    const putCall = mockSend.mock.calls[1][0];
    const item = putCall.input.Item;
    expect(item.PK).toBe("TENANT#tenant-001");
    expect(item.SK).toBe("SUBSCRIPTION#current");
    expect(item.entityData.tier).toBe("pro");
    expect(item.entityData.previousTier).toBe("starter");
    expect(item.entityData.tierChangedAt).toBeDefined();
  });
});

// ─── Tests: PUT /api/subscriptions (Downgrade) ─────────────────────────────────

describe("PUT /api/subscriptions — Downgrade", () => {
  it("downgrades from enterprise to pro", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: "TENANT#tenant-001",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "enterprise", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });
    mockSend.mockResolvedValueOnce({});

    const req = createRequest("/api/subscriptions", "PUT", { tier: "pro" });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("pro");
    expect(body.previousTier).toBe("enterprise");
    expect(body.changeType).toBe("downgrade");
    expect(body.message).toContain("Downgraded");
    expect(body.message).toContain("Pro");
    expect(body.message).toContain("retained until the archival policy runs");
  });

  it("downgrades from pro to starter", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: "TENANT#tenant-001",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });
    mockSend.mockResolvedValueOnce({});

    const req = createRequest("/api/subscriptions", "PUT", { tier: "starter" });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("starter");
    expect(body.previousTier).toBe("pro");
    expect(body.changeType).toBe("downgrade");
    expect(body.message).toContain("5 services");
    expect(body.message).toContain("30-day");
    expect(body.message).toContain("Features restricted");
  });
});

// ─── Tests: PUT /api/subscriptions (No Change) ────────────────────────────────

describe("PUT /api/subscriptions — No Change", () => {
  it("returns no_change when setting same tier", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: "TENANT#tenant-001",
        SK: "SUBSCRIPTION#current",
        entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
      },
    });

    const req = createRequest("/api/subscriptions", "PUT", { tier: "pro" });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.changeType).toBe("no_change");
    expect(body.message).toContain("Already on");
    // Should NOT have called PutCommand for a no-change
    expect(mockSend).toHaveBeenCalledTimes(1); // Only the GetCommand
  });
});

// ─── Tests: PUT /api/subscriptions (Validation Errors) ─────────────────────────

describe("PUT /api/subscriptions — Validation", () => {
  it("returns 400 for invalid tier value", async () => {
    const req = createRequest("/api/subscriptions", "PUT", { tier: "gold" });
    const response = await PUT(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 for missing tier field", async () => {
    const req = createRequest("/api/subscriptions", "PUT", {});
    const response = await PUT(req);

    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(new URL("/api/subscriptions", "http://localhost"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{",
    });
    const response = await PUT(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON body");
  });
});

// ─── Tests: Authorization ──────────────────────────────────────────────────────

describe("PUT /api/subscriptions — Authorization", () => {
  it("returns 403 when user is not tenant_admin", async () => {
    vi.mocked(withAuthorization).mockResolvedValue(
      NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      )
    );

    const req = createRequest("/api/subscriptions", "PUT", { tier: "pro" });
    const response = await PUT(req);

    expect(response.status).toBe(403);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createRequest("/api/subscriptions", "PUT", { tier: "pro" });
    const response = await PUT(req);

    expect(response.status).toBe(401);
  });
});
