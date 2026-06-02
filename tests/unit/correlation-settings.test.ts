/**
 * Unit tests for the Correlation Window Configuration API.
 *
 * Tests cover: GET (default and custom), PUT (valid, invalid, boundary values),
 * and authorization enforcement (tenant_admin required for PUT).
 *
 * Requirements: 2.3, 2.4
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
  tenantPrefix: (tenantId: string) => `TENANT#${tenantId}`,
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

vi.mock("@/lib/middleware/authorize", () => ({
  withAuthorization: vi.fn().mockResolvedValue({
    session: {
      userId: "user-001",
      tenantId: "tenant-001",
      role: "tenant_admin",
      teamIds: ["team-001"],
      expiresAt: new Date(Date.now() + 3600000),
    },
  }),
}));

// Import handlers after mocks
import { GET, PUT } from "@/app/api/settings/correlation/route";
import { withAuthorization } from "@/lib/middleware/authorize";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createGetRequest(): NextRequest {
  return new NextRequest("http://localhost/api/settings/correlation", {
    method: "GET",
  });
}

function createPutRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/settings/correlation", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCorrelationWindowItem(windowMinutes: number) {
  return {
    PK: "TENANT#tenant-001",
    SK: "SETTINGS#correlation_window",
    entityData: {
      windowMinutes,
      updatedAt: "2024-01-15T10:00:00.000Z",
      updatedBy: "user-001",
    },
  };
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

const mockSession = {
  userId: "user-001",
  tenantId: "tenant-001",
  role: "tenant_admin" as const,
  teamIds: ["team-001"],
  expiresAt: new Date(Date.now() + 3600000),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withAuthorization).mockResolvedValue({ session: mockSession });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/settings/correlation", () => {
  it("should return default 60 minutes when no custom window is configured", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.windowMinutes).toBe(60);
    expect(body.isDefault).toBe(true);
    expect(body.updatedAt).toBeNull();
    expect(body.updatedBy).toBeNull();
  });

  it("should return custom correlation window when configured", async () => {
    mockSend.mockResolvedValueOnce({
      Item: makeCorrelationWindowItem(120),
    });

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.windowMinutes).toBe(120);
    expect(body.isDefault).toBe(false);
    expect(body.updatedAt).toBe("2024-01-15T10:00:00.000Z");
    expect(body.updatedBy).toBe("user-001");
  });

  it("should return 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await GET(createGetRequest());
    expect(response.status).toBe(401);
  });

  it("should allow viewer role to read settings", async () => {
    const viewerSession = { ...mockSession, role: "viewer" as const };
    vi.mocked(withAuthorization).mockResolvedValueOnce({
      session: viewerSession,
    });
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const response = await GET(createGetRequest());
    expect(response.status).toBe(200);
  });
});

describe("PUT /api/settings/correlation", () => {
  it("should update correlation window with valid value", async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const response = await PUT(createPutRequest({ windowMinutes: 90 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.windowMinutes).toBe(90);
    expect(body.isDefault).toBe(false);
    expect(body.updatedBy).toBe("user-001");
    expect(body.updatedAt).toBeDefined();
  });

  it("should accept minimum value of 5 minutes", async () => {
    mockSend.mockResolvedValueOnce({});

    const response = await PUT(createPutRequest({ windowMinutes: 5 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.windowMinutes).toBe(5);
  });

  it("should accept maximum value of 1440 minutes (24 hours)", async () => {
    mockSend.mockResolvedValueOnce({});

    const response = await PUT(createPutRequest({ windowMinutes: 1440 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.windowMinutes).toBe(1440);
  });

  it("should reject value below 5 minutes", async () => {
    const response = await PUT(createPutRequest({ windowMinutes: 4 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields.windowMinutes).toBeDefined();
    expect(body.fields.windowMinutes[0]).toContain("5");
  });

  it("should reject value above 1440 minutes", async () => {
    const response = await PUT(createPutRequest({ windowMinutes: 1441 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields.windowMinutes).toBeDefined();
    expect(body.fields.windowMinutes[0]).toContain("1440");
  });

  it("should reject zero value", async () => {
    const response = await PUT(createPutRequest({ windowMinutes: 0 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should reject negative values", async () => {
    const response = await PUT(createPutRequest({ windowMinutes: -10 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should reject non-integer values", async () => {
    const response = await PUT(createPutRequest({ windowMinutes: 30.5 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should reject non-numeric values", async () => {
    const response = await PUT(createPutRequest({ windowMinutes: "sixty" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should reject missing windowMinutes field", async () => {
    const response = await PUT(createPutRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should return 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/settings/correlation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not valid json {{{",
    });

    const response = await PUT(req);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("should return 403 when viewer attempts to update", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Insufficient permissions", code: "FORBIDDEN" },
        { status: 403 }
      )
    );

    const response = await PUT(createPutRequest({ windowMinutes: 90 }));
    expect(response.status).toBe(403);
  });

  it("should return 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await PUT(createPutRequest({ windowMinutes: 90 }));
    expect(response.status).toBe(401);
  });

  it("should store correct DynamoDB item structure", async () => {
    mockSend.mockResolvedValueOnce({});

    await PUT(createPutRequest({ windowMinutes: 120 }));

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0];
    const input = putCall.input;

    expect(input.TableName).toBe("ollinai-config");
    expect(input.Item.PK).toBe("TENANT#tenant-001");
    expect(input.Item.SK).toBe("SETTINGS#correlation_window");
    expect(input.Item.entityData.windowMinutes).toBe(120);
    expect(input.Item.entityData.updatedBy).toBe("user-001");
    expect(input.Item.entityData.updatedAt).toBeDefined();
  });
});
