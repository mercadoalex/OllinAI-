/**
 * Unit tests for the Risk Weight Configuration API.
 *
 * Tests cover: GET (default and custom), PUT (valid, invalid, boundary values,
 * sum validation), and authorization enforcement (tenant_admin required for PUT).
 *
 * Requirements: 4.4, 4.8
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
import { GET, PUT } from "@/app/api/settings/risk-weights/route";
import { withAuthorization } from "@/lib/middleware/authorize";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createGetRequest(): NextRequest {
  return new NextRequest("http://localhost/api/settings/risk-weights", {
    method: "GET",
  });
}

function createPutRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/settings/risk-weights", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRiskWeightsItem(weights: {
  changeFailureRate: number;
  changeSize: number;
  deploymentTiming: number;
  authorFailureRate: number;
}) {
  return {
    PK: "TENANT#tenant-001",
    SK: "SETTINGS#risk_weights",
    entityData: {
      ...weights,
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

describe("GET /api/settings/risk-weights", () => {
  it("should return default weights when no custom weights are configured", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weights.changeFailureRate).toBe(0.35);
    expect(body.weights.changeSize).toBe(0.25);
    expect(body.weights.deploymentTiming).toBe(0.20);
    expect(body.weights.authorFailureRate).toBe(0.20);
    expect(body.isDefault).toBe(true);
    expect(body.updatedAt).toBeNull();
    expect(body.updatedBy).toBeNull();
  });

  it("should return custom weights when configured", async () => {
    mockSend.mockResolvedValueOnce({
      Item: makeRiskWeightsItem({
        changeFailureRate: 0.4,
        changeSize: 0.3,
        deploymentTiming: 0.2,
        authorFailureRate: 0.1,
      }),
    });

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weights.changeFailureRate).toBe(0.4);
    expect(body.weights.changeSize).toBe(0.3);
    expect(body.weights.deploymentTiming).toBe(0.2);
    expect(body.weights.authorFailureRate).toBe(0.1);
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

describe("PUT /api/settings/risk-weights", () => {
  it("should update weights with valid values summing to 1.0", async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.4,
        changeSize: 0.3,
        deploymentTiming: 0.2,
        authorFailureRate: 0.1,
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weights.changeFailureRate).toBe(0.4);
    expect(body.weights.changeSize).toBe(0.3);
    expect(body.weights.deploymentTiming).toBe(0.2);
    expect(body.weights.authorFailureRate).toBe(0.1);
    expect(body.isDefault).toBe(false);
    expect(body.updatedBy).toBe("user-001");
    expect(body.updatedAt).toBeDefined();
  });

  it("should accept equal weights (0.25 each)", async () => {
    mockSend.mockResolvedValueOnce({});

    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.25,
        changeSize: 0.25,
        deploymentTiming: 0.25,
        authorFailureRate: 0.25,
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weights.changeFailureRate).toBe(0.25);
  });

  it("should accept weight of 0 for a factor", async () => {
    mockSend.mockResolvedValueOnce({});

    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.5,
        changeSize: 0.5,
        deploymentTiming: 0,
        authorFailureRate: 0,
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weights.deploymentTiming).toBe(0);
    expect(body.weights.authorFailureRate).toBe(0);
  });

  it("should accept weight of 1 for a single factor", async () => {
    mockSend.mockResolvedValueOnce({});

    const response = await PUT(
      createPutRequest({
        changeFailureRate: 1,
        changeSize: 0,
        deploymentTiming: 0,
        authorFailureRate: 0,
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weights.changeFailureRate).toBe(1);
  });

  it("should accept weights within floating-point tolerance of 1.0", async () => {
    mockSend.mockResolvedValueOnce({});

    // These sum to 0.9999 which is within 0.001 tolerance
    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.333,
        changeSize: 0.333,
        deploymentTiming: 0.333,
        authorFailureRate: 0.0009,
      })
    );

    expect(response.status).toBe(200);
  });

  it("should reject weights that sum to less than 1.0 outside tolerance", async () => {
    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.2,
        changeSize: 0.2,
        deploymentTiming: 0.2,
        authorFailureRate: 0.2,
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields._sum).toBeDefined();
    expect(body.fields._sum[0]).toContain("sum to 1.0");
  });

  it("should reject weights that sum to more than 1.0 outside tolerance", async () => {
    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.4,
        changeSize: 0.4,
        deploymentTiming: 0.3,
        authorFailureRate: 0.2,
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields._sum).toBeDefined();
  });

  it("should reject weight greater than 1", async () => {
    const response = await PUT(
      createPutRequest({
        changeFailureRate: 1.5,
        changeSize: 0,
        deploymentTiming: 0,
        authorFailureRate: 0,
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields.changeFailureRate).toBeDefined();
    expect(body.fields.changeFailureRate[0]).toContain("between 0 and 1");
  });

  it("should reject negative weight", async () => {
    const response = await PUT(
      createPutRequest({
        changeFailureRate: -0.1,
        changeSize: 0.5,
        deploymentTiming: 0.3,
        authorFailureRate: 0.3,
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields.changeFailureRate).toBeDefined();
  });

  it("should reject non-numeric weight values", async () => {
    const response = await PUT(
      createPutRequest({
        changeFailureRate: "high",
        changeSize: 0.25,
        deploymentTiming: 0.25,
        authorFailureRate: 0.25,
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields.changeFailureRate).toBeDefined();
  });

  it("should reject missing weight fields", async () => {
    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.5,
        changeSize: 0.5,
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should reject empty body", async () => {
    const response = await PUT(createPutRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should return 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/settings/risk-weights", {
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

    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.25,
        changeSize: 0.25,
        deploymentTiming: 0.25,
        authorFailureRate: 0.25,
      })
    );
    expect(response.status).toBe(403);
  });

  it("should return 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await PUT(
      createPutRequest({
        changeFailureRate: 0.25,
        changeSize: 0.25,
        deploymentTiming: 0.25,
        authorFailureRate: 0.25,
      })
    );
    expect(response.status).toBe(401);
  });

  it("should store correct DynamoDB item structure", async () => {
    mockSend.mockResolvedValueOnce({});

    await PUT(
      createPutRequest({
        changeFailureRate: 0.4,
        changeSize: 0.3,
        deploymentTiming: 0.2,
        authorFailureRate: 0.1,
      })
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0];
    const input = putCall.input;

    expect(input.TableName).toBe("ollinai-config");
    expect(input.Item.PK).toBe("TENANT#tenant-001");
    expect(input.Item.SK).toBe("SETTINGS#risk_weights");
    expect(input.Item.entityData.changeFailureRate).toBe(0.4);
    expect(input.Item.entityData.changeSize).toBe(0.3);
    expect(input.Item.entityData.deploymentTiming).toBe(0.2);
    expect(input.Item.entityData.authorFailureRate).toBe(0.1);
    expect(input.Item.entityData.updatedBy).toBe("user-001");
    expect(input.Item.entityData.updatedAt).toBeDefined();
  });
});
