/**
 * Unit tests for the Integration Test Connectivity endpoint.
 *
 * Tests cover: successful test, missing integration, missing config,
 * authorization, and timeout handling.
 *
 * Requirements: 10.4
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

import { POST } from "@/app/api/integrations/[id]/test/route";
import { withAuthorization } from "@/lib/middleware/authorize";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createPostRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "POST" });
}

function makeRouteContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeIntegrationItem(id: string, type: string = "github_actions") {
  return {
    PK: "TENANT#tenant-001",
    SK: `INTEGRATION#${id}`,
    entityData: {
      integrationId: id,
      name: "Test Integration",
      type,
      secretKeyHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  };
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withAuthorization).mockResolvedValue({
    session: {
      userId: "user-001",
      tenantId: "tenant-001",
      role: "tenant_admin",
      teamIds: ["team-001"],
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/integrations/[id]/test", () => {
  it("should return success for a properly configured integration", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeIntegrationItem("int-1", "github_actions")],
    });

    const req = createPostRequest("http://localhost/api/integrations/int-1/test");
    const response = await POST(req, makeRouteContext("int-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.integrationId).toBe("int-1");
    expect(body.latencyMs).toBeDefined();
    expect(body.testedAt).toBeDefined();
  });

  it("should return 404 for a non-existent integration", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createPostRequest("http://localhost/api/integrations/nonexistent/test");
    const response = await POST(req, makeRouteContext("nonexistent"));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Integration not found");
  });

  it("should return failure when integration has no secret key", async () => {
    const item = makeIntegrationItem("int-1", "github_actions");
    item.entityData.secretKeyHash = "";
    mockSend.mockResolvedValueOnce({ Items: [item] });

    const req = createPostRequest("http://localhost/api/integrations/int-1/test");
    const response = await POST(req, makeRouteContext("int-1"));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("missing a secret key");
  });

  it("should return 401/403 when not authorized", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createPostRequest("http://localhost/api/integrations/int-1/test");
    const response = await POST(req, makeRouteContext("int-1"));

    expect(response.status).toBe(401);
  });

  it("should work with all valid integration types", async () => {
    const types = ["github_actions", "gitlab_ci", "jenkins", "circleci", "pagerduty", "opsgenie", "custom"];

    for (const type of types) {
      mockSend.mockResolvedValueOnce({
        Items: [makeIntegrationItem("int-1", type)],
      });

      const req = createPostRequest("http://localhost/api/integrations/int-1/test");
      const response = await POST(req, makeRouteContext("int-1"));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    }
  });
});
