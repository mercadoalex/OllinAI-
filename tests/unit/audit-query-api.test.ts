/**
 * Unit tests for the Audit Log Query API endpoint.
 *
 * Tests cover: paginated query, filters (actor, action, resource, time),
 * tier gating, authorization, and max page size enforcement.
 *
 * Requirements: 12.4
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
  tenantAuditKey: (tenantId: string) => `TENANT#${tenantId}`,
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

vi.mock("@/lib/middleware/tier-gate", () => ({
  withTierGate: vi.fn().mockResolvedValue({ tier: "enterprise" }),
  getTenantSubscription: vi.fn().mockResolvedValue("enterprise"),
}));

import { GET } from "@/app/api/audit/route";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function makeAuditItem(index: number) {
  const timestamp = `2024-01-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`;
  return {
    PK: "TENANT#tenant-001",
    SK: `AUDIT#${timestamp}#audit-${index}`,
    actor: `user-${(index % 3) + 1}`,
    action: index % 2 === 0 ? "team.create" : "service.update",
    targetResource: `TEAM#team-${index}`,
    sourceIp: "192.168.1.1",
    outcome: "success",
    timestamp,
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
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/audit", () => {
  it("should return paginated audit logs", async () => {
    const items = Array.from({ length: 5 }, (_, i) => makeAuditItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/audit");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(5);
    expect(body.pagination.totalCount).toBe(5);
    expect(body.pagination.currentPage).toBe(1);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("should support page and pageSize parameters", async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeAuditItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/audit?page=2&pageSize=20");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(20);
    expect(body.pagination.currentPage).toBe(2);
    expect(body.pagination.pageSize).toBe(20);
    expect(body.pagination.totalCount).toBe(60);
    expect(body.pagination.hasMore).toBe(true);
  });

  it("should enforce maximum page size of 100", async () => {
    const items = Array.from({ length: 10 }, (_, i) => makeAuditItem(i));
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/audit?pageSize=200");
    const response = await GET(req);

    const body = await response.json();
    expect(body.pagination.pageSize).toBe(100);
  });

  it("should return audit entry fields correctly", async () => {
    const items = [makeAuditItem(0)];
    mockSend.mockResolvedValueOnce({ Items: items });

    const req = createGetRequest("http://localhost/api/audit");
    const response = await GET(req);

    const body = await response.json();
    const entry = body.data[0];
    expect(entry.actor).toBeDefined();
    expect(entry.action).toBeDefined();
    expect(entry.targetResource).toBeDefined();
    expect(entry.sourceIp).toBeDefined();
    expect(entry.outcome).toBeDefined();
    expect(entry.timestamp).toBeDefined();
  });

  it("should return empty data when no audit logs exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createGetRequest("http://localhost/api/audit");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(0);
    expect(body.pagination.totalCount).toBe(0);
  });

  it("should reject time range exceeding 90 days", async () => {
    const req = createGetRequest(
      "http://localhost/api/audit?from=2023-01-01T00:00:00Z&to=2024-01-01T00:00:00Z"
    );
    const response = await GET(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("90 days");
  });

  it("should require Enterprise tier", async () => {
    vi.mocked(withTierGate).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Upgrade required", code: "FEATURE_NOT_AVAILABLE", currentTier: "starter", requiredAction: "upgrade" },
        { status: 403 }
      )
    );

    const req = createGetRequest("http://localhost/api/audit");
    const response = await GET(req);

    expect(response.status).toBe(403);
  });

  it("should return 401/403 when not authorized", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createGetRequest("http://localhost/api/audit");
    const response = await GET(req);

    expect(response.status).toBe(401);
  });
});
