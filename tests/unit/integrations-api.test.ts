/**
 * Unit tests for the Integration Management API endpoints.
 *
 * Tests cover: listing, creation (with key generation), get single,
 * update (name/type), key rotation, revocation/deletion, and authorization.
 *
 * Requirements: 10.7
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

// Mock generateSecretKey to return predictable values for testing
let mockKeyCounter = 0;
vi.mock("@/lib/webhooks/hmac", () => ({
  generateSecretKey: () => {
    mockKeyCounter++;
    return "a".repeat(64).slice(0, 60) + String(mockKeyCounter).padStart(4, "0");
  },
}));

// Import handlers after mocks
import { GET as listIntegrations, POST as createIntegration } from "@/app/api/integrations/route";
import {
  GET as getIntegration,
  PUT as updateIntegration,
  DELETE as deleteIntegration,
} from "@/app/api/integrations/[id]/route";
import { withAuthorization } from "@/lib/middleware/authorize";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const TEST_TENANT_ID = "tenant-001";

function createGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createPutRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "DELETE" });
}

function makeRouteContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeIntegrationItem(
  integrationId: string,
  name: string,
  type: string = "github_actions"
) {
  return {
    PK: `TENANT#${TEST_TENANT_ID}`,
    SK: `INTEGRATION#${integrationId}`,
    entityData: {
      integrationId,
      name,
      type,
      secretKeyHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
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
  mockKeyCounter = 0;
  vi.mocked(withAuthorization).mockResolvedValue({ session: mockSession });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/integrations", () => {
  it("should return list of integrations for the tenant", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIntegrationItem("int-1", "GitHub Actions - Prod", "github_actions"),
        makeIntegrationItem("int-2", "PagerDuty Alerts", "pagerduty"),
      ],
    });

    const req = createGetRequest("http://localhost/api/integrations");
    const response = await listIntegrations(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].integrationId).toBe("int-1");
    expect(body.data[0].name).toBe("GitHub Actions - Prod");
    expect(body.data[0].type).toBe("github_actions");
    expect(body.data[1].integrationId).toBe("int-2");
    expect(body.data[1].type).toBe("pagerduty");
  });

  it("should NOT expose secretKeyHash in list response", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "Test Integration")],
    });

    const req = createGetRequest("http://localhost/api/integrations");
    const response = await listIntegrations(req);

    const body = await response.json();
    expect(body.data[0].secretKeyHash).toBeUndefined();
    expect(body.data[0].secretKey).toBeUndefined();
  });

  it("should return empty array when no integrations exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createGetRequest("http://localhost/api/integrations");
    const response = await listIntegrations(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(0);
  });

  it("should return 401/403 when not authorized", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createGetRequest("http://localhost/api/integrations");
    const response = await listIntegrations(req);
    expect(response.status).toBe(401);
  });
});

describe("POST /api/integrations", () => {
  it("should create integration and return secret key", async () => {
    mockSend.mockResolvedValueOnce({});

    const req = createPostRequest("http://localhost/api/integrations", {
      name: "GitHub Actions - Production",
      type: "github_actions",
    });

    const response = await createIntegration(req);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.integrationId).toBeDefined();
    expect(body.name).toBe("GitHub Actions - Production");
    expect(body.type).toBe("github_actions");
    expect(body.secretKey).toBeDefined();
    expect(body.secretKey.length).toBe(64); // 32 bytes hex-encoded
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();
  });

  it("should generate a unique secret key for each integration", async () => {
    mockSend.mockResolvedValue({});

    const req1 = createPostRequest("http://localhost/api/integrations", {
      name: "Integration 1",
      type: "github_actions",
    });
    const res1 = await createIntegration(req1);
    const body1 = await res1.json();

    const req2 = createPostRequest("http://localhost/api/integrations", {
      name: "Integration 2",
      type: "gitlab_ci",
    });
    const res2 = await createIntegration(req2);
    const body2 = await res2.json();

    expect(body1.secretKey).not.toBe(body2.secretKey);
  });

  it("should accept all valid integration types", async () => {
    const validTypes = [
      "github_actions",
      "gitlab_ci",
      "jenkins",
      "circleci",
      "pagerduty",
      "opsgenie",
      "custom",
    ];

    for (const type of validTypes) {
      mockSend.mockResolvedValueOnce({});
      const req = createPostRequest("http://localhost/api/integrations", {
        name: `Integration - ${type}`,
        type,
      });
      const response = await createIntegration(req);
      expect(response.status).toBe(201);
    }
  });

  it("should return 400 for invalid integration type", async () => {
    const req = createPostRequest("http://localhost/api/integrations", {
      name: "Invalid Integration",
      type: "invalid_type",
    });

    const response = await createIntegration(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Validation failed");
    expect(body.fields.type).toBeDefined();
  });

  it("should return 400 when name is empty", async () => {
    const req = createPostRequest("http://localhost/api/integrations", {
      name: "",
      type: "github_actions",
    });

    const response = await createIntegration(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should return 400 when name exceeds 200 characters", async () => {
    const req = createPostRequest("http://localhost/api/integrations", {
      name: "a".repeat(201),
      type: "github_actions",
    });

    const response = await createIntegration(req);
    expect(response.status).toBe(400);
  });

  it("should return 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json {{{",
    });

    const response = await createIntegration(req);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("should return 400 when type is missing", async () => {
    const req = createPostRequest("http://localhost/api/integrations", {
      name: "No Type Integration",
    });

    const response = await createIntegration(req);
    expect(response.status).toBe(400);
  });

  it("should require tenant_admin role for creation", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      )
    );

    const req = createPostRequest("http://localhost/api/integrations", {
      name: "Test",
      type: "github_actions",
    });

    const response = await createIntegration(req);
    expect(response.status).toBe(403);
  });
});

describe("GET /api/integrations/[id]", () => {
  it("should return integration details without secret key", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "GitHub Actions - Prod", "github_actions")],
    });

    const req = createGetRequest("http://localhost/api/integrations/int-1");
    const response = await getIntegration(req, makeRouteContext("int-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.integrationId).toBe("int-1");
    expect(body.name).toBe("GitHub Actions - Prod");
    expect(body.type).toBe("github_actions");
    expect(body.secretKeyHash).toBeUndefined();
    expect(body.secretKey).toBeUndefined();
  });

  it("should return 404 when integration not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createGetRequest("http://localhost/api/integrations/nonexistent");
    const response = await getIntegration(req, makeRouteContext("nonexistent"));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Integration not found");
  });

  it("should return lastUsedAt when present", async () => {
    const item = makeIntegrationItem("int-1", "Test");
    (item.entityData as Record<string, unknown>).lastUsedAt = "2024-06-15T10:00:00.000Z";
    mockSend.mockResolvedValueOnce({ Items: [item] });

    const req = createGetRequest("http://localhost/api/integrations/int-1");
    const response = await getIntegration(req, makeRouteContext("int-1"));

    const body = await response.json();
    expect(body.lastUsedAt).toBe("2024-06-15T10:00:00.000Z");
  });
});

describe("PUT /api/integrations/[id]", () => {
  it("should update integration name", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "Old Name", "github_actions")],
    });
    mockSend.mockResolvedValueOnce({});

    const req = createPutRequest("http://localhost/api/integrations/int-1", {
      name: "New Name",
    });

    const response = await updateIntegration(req, makeRouteContext("int-1"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.name).toBe("New Name");
    expect(body.secretKey).toBeUndefined(); // Not rotated
  });

  it("should rotate key when rotateKey is true", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "Test", "github_actions")],
    });
    mockSend.mockResolvedValueOnce({});

    const req = createPutRequest("http://localhost/api/integrations/int-1", {
      rotateKey: true,
    });

    const response = await updateIntegration(req, makeRouteContext("int-1"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.secretKey).toBeDefined();
    expect(body.secretKey.length).toBe(64); // New 32-byte hex key
  });

  it("should update name and rotate key simultaneously", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "Old Name", "github_actions")],
    });
    mockSend.mockResolvedValueOnce({});

    const req = createPutRequest("http://localhost/api/integrations/int-1", {
      name: "Updated Name",
      rotateKey: true,
    });

    const response = await updateIntegration(req, makeRouteContext("int-1"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.name).toBe("Updated Name");
    expect(body.secretKey).toBeDefined();
  });

  it("should update integration type", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "Test", "github_actions")],
    });
    mockSend.mockResolvedValueOnce({});

    const req = createPutRequest("http://localhost/api/integrations/int-1", {
      type: "gitlab_ci",
    });

    const response = await updateIntegration(req, makeRouteContext("int-1"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.type).toBe("gitlab_ci");
  });

  it("should return 404 when integration not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createPutRequest("http://localhost/api/integrations/nonexistent", {
      name: "Updated",
    });

    const response = await updateIntegration(req, makeRouteContext("nonexistent"));
    expect(response.status).toBe(404);
  });

  it("should return 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/integrations/int-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    const response = await updateIntegration(req, makeRouteContext("int-1"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("should return 400 for invalid type on update", async () => {
    const req = createPutRequest("http://localhost/api/integrations/int-1", {
      type: "invalid_type",
    });

    const response = await updateIntegration(req, makeRouteContext("int-1"));
    expect(response.status).toBe(400);
  });

  it("should require tenant_admin role for update", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      )
    );

    const req = createPutRequest("http://localhost/api/integrations/int-1", {
      name: "Updated",
    });

    const response = await updateIntegration(req, makeRouteContext("int-1"));
    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/integrations/[id]", () => {
  it("should delete integration and return 200", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "To Delete", "github_actions")],
    });
    mockSend.mockResolvedValueOnce({});

    const req = createDeleteRequest("http://localhost/api/integrations/int-1");
    const response = await deleteIntegration(req, makeRouteContext("int-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toContain("revoked");
    expect(body.integrationId).toBe("int-1");
  });

  it("should return 404 when integration not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createDeleteRequest("http://localhost/api/integrations/nonexistent");
    const response = await deleteIntegration(req, makeRouteContext("nonexistent"));

    expect(response.status).toBe(404);
  });

  it("should require tenant_admin role for deletion", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      )
    );

    const req = createDeleteRequest("http://localhost/api/integrations/int-1");
    const response = await deleteIntegration(req, makeRouteContext("int-1"));

    expect(response.status).toBe(403);
  });
});
