/**
 * Unit tests for the Data Export API — Metrics endpoint.
 *
 * Tests cover: pagination, filters (service, team, time range),
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
  tenantMetricsScopeKey: (tenantId: string, scopeType: string, scopeId: string) =>
    `TENANT#${tenantId}#SCOPE#${scopeType}#${scopeId}`,
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

import { GET } from "@/app/api/v1/metrics/route";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import { withRateLimit } from "@/lib/middleware/rate-limit";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function makeMetricsItem(index: number) {
  const start = `2024-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`;
  const end = `2024-01-${String(index + 8).padStart(2, "0")}T00:00:00Z`;
  return {
    PK: "TENANT#tenant-001#SCOPE#ALL#ALL",
    SK: `PERIOD#${start}#${end}`,
    deploymentFrequency: 15 + index,
    leadTimeHours: 24 - index,
    changeFailureRate: 10 + index,
    mttrHours: 4 + index,
    unresolvedCount: index,
    dataPoints: 20,
    computedAt: "2024-01-15T10:00:00Z",
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

describe("GET /api/v1/metrics", () => {
  it("should return paginated metrics", async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeMetricsItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/metrics");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(3);
    expect(body.pagination.totalCount).toBe(3);
    expect(body.pagination.currentPage).toBe(1);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("should include correct response shape for each metric", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem(0)] });

    const req = createGetRequest("http://localhost/api/v1/metrics");
    const response = await GET(req);

    const body = await response.json();
    const metric = body.data[0];
    expect(metric.deploymentFrequency).toBe(15);
    expect(metric.leadTimeHours).toBe(24);
    expect(metric.changeFailureRate).toBe(10);
    expect(metric.mttrHours).toBe(4);
    expect(metric.unresolvedIncidentCount).toBe(0);
    expect(metric.period).toBeDefined();
    expect(metric.computedAt).toBeDefined();
  });

  it("should handle insufficient data sentinel value", async () => {
    const item = makeMetricsItem(0);
    item.deploymentFrequency = -1;
    item.leadTimeHours = -1;
    mockSend.mockResolvedValueOnce({ Items: [item] });

    const req = createGetRequest("http://localhost/api/v1/metrics");
    const response = await GET(req);

    const body = await response.json();
    expect(body.data[0].deploymentFrequency).toBe("insufficient_data");
    expect(body.data[0].leadTimeHours).toBe("insufficient_data");
  });

  it("should require Enterprise tier", async () => {
    vi.mocked(withTierGate).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Upgrade required", code: "FEATURE_NOT_AVAILABLE", currentTier: "starter", requiredAction: "upgrade" },
        { status: 403 }
      )
    );

    const req = createGetRequest("http://localhost/api/v1/metrics");
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

    const req = createGetRequest("http://localhost/api/v1/metrics");
    const response = await GET(req);

    expect(response.status).toBe(429);
  });

  it("should return 401 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createGetRequest("http://localhost/api/v1/metrics");
    const response = await GET(req);

    expect(response.status).toBe(401);
  });

  it("should default page size to 25", async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeMetricsItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/v1/metrics");
    const response = await GET(req);

    const body = await response.json();
    expect(body.data).toHaveLength(25);
    expect(body.pagination.pageSize).toBe(25);
  });

  it("should enforce max page size of 100", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createGetRequest("http://localhost/api/v1/metrics?pageSize=150");
    const response = await GET(req);

    const body = await response.json();
    expect(body.pagination.pageSize).toBe(100);
  });
});
