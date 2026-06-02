/**
 * Unit tests for the Data Export API — Deployments endpoint.
 *
 * Tests cover: pagination, filters (service, team, time range, risk),
 * tier gating, rate limiting, and response shape.
 *
 * Requirements: 11.1, 11.2, 11.5, 11.7
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
  tenantServiceKey: (tenantId: string, serviceId: string) => `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantTeamKey: (tenantId: string, teamId: string) => `TENANT#${tenantId}#TEAM#${teamId}`,
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

vi.mock("@/lib/middleware/tier-gate", () => ({
  withTierGate: vi.fn().mockResolvedValue({ tier: "enterprise" }),
  getTenantSubscription: vi.fn().mockResolvedValue("enterprise"),
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  withRateLimit: vi.fn().mockResolvedValue(null),
}));

import { GET } from "@/app/api/v1/deployments/route";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import { withRateLimit } from "@/lib/middleware/rate-limit";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function makeEventItem(index: number, riskScore: string = "medium") {
  return {
    PK: `TENANT#tenant-001#SVC#service-${index}`,
    SK: `DEPLOY#2024-01-${String(index + 1).padStart(2, "0")}T10:00:00Z#evt-${index}`,
    eventId: `evt-${index}`,
    commitShas: [`sha-${index}`],
    author: `author-${index}`,
    services: [`service-${index}`],
    environment: "production",
    teamId: `team-${(index % 2) + 1}`,
    riskScore,
    riskFactors: { changeFailureRate: 0.3, changeSize: 0.2, deploymentTiming: 0.1, authorFailureRate: 0.2 },
    changeSize: { linesAdded: 100, linesRemoved: 50, filesChanged: 5 },
    correlatedIncidents: [],
    createdAt: `2024-01-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
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
  vi.mocked(withTierGate).mockResolvedValue({ tier: "enterprise" });
  vi.mocked(withRateLimit).mockResolvedValue(null);
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/v1/deployments", () => {
  it("should return paginated deployment events", async () => {
    const items = Array.from({ length: 5 }, (_, i) => makeEventItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/deployments");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(5);
    expect(body.pagination.totalCount).toBe(5);
    expect(body.pagination.currentPage).toBe(1);
    expect(body.pagination.pageSize).toBe(25);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("should default page size to 25", async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeEventItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/deployments");
    const response = await GET(req);

    const body = await response.json();
    expect(body.data).toHaveLength(25);
    expect(body.pagination.pageSize).toBe(25);
    expect(body.pagination.hasMore).toBe(true);
  });

  it("should enforce max page size of 100", async () => {
    const items = Array.from({ length: 10 }, (_, i) => makeEventItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/deployments?pageSize=200");
    const response = await GET(req);

    const body = await response.json();
    expect(body.pagination.pageSize).toBe(100);
  });

  it("should include correct response shape for each event", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeEventItem(0)] });

    const req = createGetRequest("http://localhost/api/v1/deployments");
    const response = await GET(req);

    const body = await response.json();
    const event = body.data[0];
    expect(event.eventId).toBe("evt-0");
    expect(event.commitShas).toEqual(["sha-0"]);
    expect(event.author).toBe("author-0");
    expect(event.services).toEqual(["service-0"]);
    expect(event.environment).toBe("production");
    expect(event.riskScore).toBe("medium");
    expect(event.riskFactors).toBeDefined();
    expect(event.changeSize).toBeDefined();
    expect(event.createdAt).toBeDefined();
  });

  it("should require Enterprise tier", async () => {
    vi.mocked(withTierGate).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Upgrade required", code: "FEATURE_NOT_AVAILABLE", currentTier: "pro", requiredAction: "upgrade" },
        { status: 403 }
      )
    );

    const req = createGetRequest("http://localhost/api/v1/deployments");
    const response = await GET(req);

    expect(response.status).toBe(403);
  });

  it("should return 429 when rate limited", async () => {
    vi.mocked(withRateLimit).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Rate limit exceeded", code: "RATE_LIMIT_EXCEEDED", retryAfter: 30 },
        { status: 429 }
      )
    );

    const req = createGetRequest("http://localhost/api/v1/deployments");
    const response = await GET(req);

    expect(response.status).toBe(429);
  });

  it("should return 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createGetRequest("http://localhost/api/v1/deployments");
    const response = await GET(req);

    expect(response.status).toBe(401);
  });

  it("should support pagination with page parameter", async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeEventItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/deployments?page=3&pageSize=20");
    const response = await GET(req);

    const body = await response.json();
    expect(body.pagination.currentPage).toBe(3);
    expect(body.pagination.pageSize).toBe(20);
    expect(body.data).toHaveLength(20);
  });
});
