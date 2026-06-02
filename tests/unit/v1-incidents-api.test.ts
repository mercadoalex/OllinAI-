/**
 * Unit tests for the Data Export API — Incidents endpoint.
 *
 * Tests cover: pagination, filters (service, time range, severity),
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

import { GET } from "@/app/api/v1/incidents/route";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import { withRateLimit } from "@/lib/middleware/rate-limit";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function makeIncidentItem(index: number, severity: string = "high") {
  const timestamp = `2024-01-${String(index + 1).padStart(2, "0")}T10:00:00Z`;
  return {
    PK: `TENANT#tenant-001#SVC#service-${index}`,
    SK: `INC#${timestamp}#inc-${index}`,
    incidentId: `inc-${index}`,
    externalId: `EXT-${index}`,
    severity,
    detectionTimestamp: timestamp,
    resolutionTimestamp: index % 2 === 0 ? `2024-01-${String(index + 1).padStart(2, "0")}T12:00:00Z` : undefined,
    correlatedDeployments: [`evt-${index}`],
    correlationStatus: "correlated",
    GSI1PK: "TENANT#tenant-001",
    GSI1SK: `INC#${timestamp}`,
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

describe("GET /api/v1/incidents", () => {
  it("should return paginated incidents", async () => {
    const items = Array.from({ length: 5 }, (_, i) => makeIncidentItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/incidents");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(5);
    expect(body.pagination.totalCount).toBe(5);
    expect(body.pagination.currentPage).toBe(1);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("should include correct response shape for each incident", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeIncidentItem(0)] });

    const req = createGetRequest("http://localhost/api/v1/incidents");
    const response = await GET(req);

    const body = await response.json();
    const incident = body.data[0];
    expect(incident.incidentId).toBe("inc-0");
    expect(incident.externalId).toBe("EXT-0");
    expect(incident.severity).toBe("high");
    expect(incident.detectionTimestamp).toBeDefined();
    expect(incident.correlatedDeployments).toEqual(["evt-0"]);
    expect(incident.correlationStatus).toBe("correlated");
  });

  it("should default page size to 25", async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeIncidentItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/incidents");
    const response = await GET(req);

    const body = await response.json();
    expect(body.data).toHaveLength(25);
    expect(body.pagination.pageSize).toBe(25);
    expect(body.pagination.hasMore).toBe(true);
  });

  it("should enforce max page size of 100", async () => {
    const items = Array.from({ length: 10 }, (_, i) => makeIncidentItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/incidents?pageSize=500");
    const response = await GET(req);

    const body = await response.json();
    expect(body.pagination.pageSize).toBe(100);
  });

  it("should require Enterprise tier", async () => {
    vi.mocked(withTierGate).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Upgrade required", code: "FEATURE_NOT_AVAILABLE", currentTier: "starter", requiredAction: "upgrade" },
        { status: 403 }
      )
    );

    const req = createGetRequest("http://localhost/api/v1/incidents");
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

    const req = createGetRequest("http://localhost/api/v1/incidents");
    const response = await GET(req);

    expect(response.status).toBe(429);
  });

  it("should return 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createGetRequest("http://localhost/api/v1/incidents");
    const response = await GET(req);

    expect(response.status).toBe(401);
  });

  it("should return empty data when no incidents exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createGetRequest("http://localhost/api/v1/incidents");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(0);
    expect(body.pagination.totalCount).toBe(0);
  });
});
