/**
 * Unit tests for recommendation dismissal and suppression.
 *
 * Tests cover:
 * - POST /api/recommendations/{id}/dismiss: records dismissal and suppression
 * - Suppression check: same category + team + service is suppressed for 14 days
 * - GET /api/recommendations: lists active (non-dismissed) recommendations
 * - Authorization: only team_lead and tenant_admin can dismiss
 *
 * Requirements: 5.5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedSession } from "@/lib/types/auth";
import type { RecommendationConfigItem } from "@/lib/types/dynamo";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/authorize", () => ({
  withAuthorization: vi.fn(),
}));

vi.mock("@/lib/dynamo/client", () => ({
  getDocumentClient: vi.fn(),
  TableNames: {
    CONFIG: "ollinai-config",
    EVENTS: "ollinai-events",
    INCIDENTS: "ollinai-incidents",
    METRICS: "ollinai-metrics",
    AUDIT: "ollinai-audit",
  },
}));

vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, params: unknown) => params,
}));

import { withAuthorization } from "@/lib/middleware/authorize";
import { getDocumentClient } from "@/lib/dynamo/client";
import { POST as dismissHandler } from "@/app/api/recommendations/[id]/dismiss/route";
import { GET as listHandler } from "@/app/api/recommendations/route";

const mockedWithAuthorization = vi.mocked(withAuthorization);
const mockedGetDocumentClient = vi.mocked(getDocumentClient);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createMockSession(role: "tenant_admin" | "team_lead" | "viewer" = "tenant_admin"): AuthenticatedSession {
  return {
    userId: "user-123",
    tenantId: "tenant-abc",
    role,
    teamIds: ["team-1"],
    expiresAt: new Date(Date.now() + 3600000),
  };
}

function createMockRequest(url = "http://localhost:3000/api/recommendations/rec-123/dismiss"): NextRequest {
  return new NextRequest(new URL(url), { method: "POST" });
}

function createGetRequest(url = "http://localhost:3000/api/recommendations"): NextRequest {
  return new NextRequest(new URL(url), { method: "GET" });
}

function createRecommendationItem(
  id: string,
  overrides: Partial<RecommendationConfigItem["entityData"]> = {}
): RecommendationConfigItem {
  return {
    PK: "TENANT#tenant-abc",
    SK: `REC#${id}`,
    entityData: {
      id,
      category: "reduce_change_size",
      targetService: "service-1",
      targetTeam: "team-1",
      triggeringMetrics: { changeSize: 0.8 },
      timeRangeEvaluated: {
        start: "2024-01-01T00:00:00.000Z",
        end: "2024-01-08T00:00:00.000Z",
      },
      generatedAt: "2024-01-08T12:00:00.000Z",
      ...overrides,
    },
  };
}

// ─── Tests: POST /api/recommendations/[id]/dismiss ─────────────────────────────

describe("POST /api/recommendations/[id]/dismiss", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    mockedGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  it("records dismissal and sets suppressedUntil to 14 days ahead", async () => {
    mockedWithAuthorization.mockResolvedValue({ session: createMockSession() });

    const recommendation = createRecommendationItem("rec-123");
    mockSend
      .mockResolvedValueOnce({ Items: [recommendation] }) // Query to find recommendation
      .mockResolvedValueOnce({}); // Update command

    const request = createMockRequest();
    const response = await dismissHandler(request, { params: { id: "rec-123" } });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("rec-123");
    expect(body.dismissedAt).toBeDefined();
    expect(body.suppressedUntil).toBeDefined();
    expect(body.category).toBe("reduce_change_size");
    expect(body.targetTeam).toBe("team-1");
    expect(body.targetService).toBe("service-1");

    // Verify suppressedUntil is approximately 14 days from now
    const suppressedUntil = new Date(body.suppressedUntil);
    const expectedSuppression = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const diffMs = Math.abs(suppressedUntil.getTime() - expectedSuppression.getTime());
    expect(diffMs).toBeLessThan(5000); // within 5 seconds tolerance
  });

  it("returns 404 when recommendation does not exist", async () => {
    mockedWithAuthorization.mockResolvedValue({ session: createMockSession() });
    mockSend.mockResolvedValueOnce({ Items: [] });

    const request = createMockRequest();
    const response = await dismissHandler(request, { params: { id: "nonexistent" } });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  it("returns 409 when recommendation is already dismissed", async () => {
    mockedWithAuthorization.mockResolvedValue({ session: createMockSession() });

    const dismissed = createRecommendationItem("rec-123", {
      dismissedAt: "2024-01-09T12:00:00.000Z",
      suppressedUntil: "2024-01-23T12:00:00.000Z",
    });
    mockSend.mockResolvedValueOnce({ Items: [dismissed] });

    const request = createMockRequest();
    const response = await dismissHandler(request, { params: { id: "rec-123" } });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already been dismissed");
  });

  it("returns 400 for empty recommendation ID", async () => {
    mockedWithAuthorization.mockResolvedValue({ session: createMockSession() });

    const request = createMockRequest();
    const response = await dismissHandler(request, { params: { id: "" } });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("required");
  });

  it("returns authorization error when user has no update permission", async () => {
    const forbiddenResponse = NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 }
    );
    mockedWithAuthorization.mockResolvedValue(forbiddenResponse);

    const request = createMockRequest();
    const response = await dismissHandler(request, { params: { id: "rec-123" } });

    expect(response.status).toBe(403);
  });

  it("calls DynamoDB UpdateCommand with correct suppression fields", async () => {
    mockedWithAuthorization.mockResolvedValue({ session: createMockSession() });

    const recommendation = createRecommendationItem("rec-456");
    mockSend
      .mockResolvedValueOnce({ Items: [recommendation] })
      .mockResolvedValueOnce({});

    const request = createMockRequest();
    await dismissHandler(request, { params: { id: "rec-456" } });

    // Verify the update command was called
    expect(mockSend).toHaveBeenCalledTimes(2);

    const updateCall = mockSend.mock.calls[1][0];
    const input = updateCall.input;
    expect(input.Key.PK).toBe("TENANT#tenant-abc");
    expect(input.Key.SK).toBe("REC#rec-456");
    expect(input.UpdateExpression).toContain("dismissedAt");
    expect(input.UpdateExpression).toContain("suppressedUntil");
  });
});

// ─── Tests: GET /api/recommendations ───────────────────────────────────────────

describe("GET /api/recommendations", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    mockedGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  it("returns only active (non-dismissed) recommendations", async () => {
    mockedWithAuthorization.mockResolvedValue({ session: createMockSession() });

    const activeRec = createRecommendationItem("rec-active");
    const dismissedRec = createRecommendationItem("rec-dismissed", {
      dismissedAt: "2024-01-09T12:00:00.000Z",
      suppressedUntil: "2024-01-23T12:00:00.000Z",
    });

    mockSend.mockResolvedValueOnce({ Items: [activeRec, dismissedRec] });

    const request = createGetRequest();
    const response = await listHandler(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("rec-active");
  });

  it("returns empty array when no recommendations exist", async () => {
    mockedWithAuthorization.mockResolvedValue({ session: createMockSession() });
    mockSend.mockResolvedValueOnce({ Items: [] });

    const request = createGetRequest();
    const response = await listHandler(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(0);
  });

  it("returns authorization error for unauthenticated requests", async () => {
    const unauthorizedResponse = NextResponse.json(
      { error: "Authentication required", code: "MISSING_TOKEN" },
      { status: 401 }
    );
    mockedWithAuthorization.mockResolvedValue(unauthorizedResponse);

    const request = createGetRequest();
    const response = await listHandler(request);

    expect(response.status).toBe(401);
  });
});

// ─── Tests: Suppression Logic (Lambda integration) ─────────────────────────────

describe("Recommendation suppression in Lambda", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    mockedGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  it("suppression key is category + targetTeam + targetService", async () => {
    // Import the suppression module
    const { isRecommendationSuppressed } = await import(
      "@/lib/recommendations/suppression"
    );

    // Create a dismissed recommendation with active suppression
    const now = new Date();
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    const suppressedRec = createRecommendationItem("rec-old", {
      category: "reduce_change_size",
      targetTeam: "team-1",
      targetService: "svc-A",
      dismissedAt: "2024-01-09T12:00:00.000Z",
      suppressedUntil: futureDate.toISOString(),
    });

    mockSend.mockResolvedValueOnce({ Items: [suppressedRec] });

    const result = await isRecommendationSuppressed({
      tenantId: "tenant-abc",
      category: "reduce_change_size",
      targetTeam: "team-1",
      targetService: "svc-A",
    });

    expect(result).toBe(true);
  });

  it("returns false when suppression has expired", async () => {
    const { isRecommendationSuppressed } = await import(
      "@/lib/recommendations/suppression"
    );

    // suppressedUntil is in the past
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday

    const expiredRec = createRecommendationItem("rec-expired", {
      category: "reduce_change_size",
      targetTeam: "team-1",
      targetService: "svc-A",
      dismissedAt: "2024-01-01T12:00:00.000Z",
      suppressedUntil: pastDate.toISOString(),
    });

    mockSend.mockResolvedValueOnce({ Items: [expiredRec] });

    const result = await isRecommendationSuppressed({
      tenantId: "tenant-abc",
      category: "reduce_change_size",
      targetTeam: "team-1",
      targetService: "svc-A",
    });

    expect(result).toBe(false);
  });

  it("returns false when different category is suppressed", async () => {
    const { isRecommendationSuppressed } = await import(
      "@/lib/recommendations/suppression"
    );

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const differentCategoryRec = createRecommendationItem("rec-other", {
      category: "adjust_timing", // different category
      targetTeam: "team-1",
      targetService: "svc-A",
      dismissedAt: "2024-01-09T12:00:00.000Z",
      suppressedUntil: futureDate.toISOString(),
    });

    mockSend.mockResolvedValueOnce({ Items: [differentCategoryRec] });

    const result = await isRecommendationSuppressed({
      tenantId: "tenant-abc",
      category: "reduce_change_size", // checking for different category
      targetTeam: "team-1",
      targetService: "svc-A",
    });

    expect(result).toBe(false);
  });

  it("returns false when different team is suppressed", async () => {
    const { isRecommendationSuppressed } = await import(
      "@/lib/recommendations/suppression"
    );

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const differentTeamRec = createRecommendationItem("rec-other-team", {
      category: "reduce_change_size",
      targetTeam: "team-2", // different team
      targetService: "svc-A",
      dismissedAt: "2024-01-09T12:00:00.000Z",
      suppressedUntil: futureDate.toISOString(),
    });

    mockSend.mockResolvedValueOnce({ Items: [differentTeamRec] });

    const result = await isRecommendationSuppressed({
      tenantId: "tenant-abc",
      category: "reduce_change_size",
      targetTeam: "team-1", // checking for different team
      targetService: "svc-A",
    });

    expect(result).toBe(false);
  });

  it("returns false when different service is suppressed", async () => {
    const { isRecommendationSuppressed } = await import(
      "@/lib/recommendations/suppression"
    );

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const differentServiceRec = createRecommendationItem("rec-other-svc", {
      category: "reduce_change_size",
      targetTeam: "team-1",
      targetService: "svc-B", // different service
      dismissedAt: "2024-01-09T12:00:00.000Z",
      suppressedUntil: futureDate.toISOString(),
    });

    mockSend.mockResolvedValueOnce({ Items: [differentServiceRec] });

    const result = await isRecommendationSuppressed({
      tenantId: "tenant-abc",
      category: "reduce_change_size",
      targetTeam: "team-1",
      targetService: "svc-A", // checking for different service
    });

    expect(result).toBe(false);
  });
});

// ─── Tests: filterSuppressedRecommendations ────────────────────────────────────

describe("filterSuppressedRecommendations", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    mockedGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  it("filters out suppressed candidates from a batch", async () => {
    const { filterSuppressedRecommendations } = await import(
      "@/lib/recommendations/suppression"
    );

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const suppressedRec = createRecommendationItem("rec-suppressed", {
      category: "reduce_change_size",
      targetTeam: "team-1",
      targetService: "svc-A",
      dismissedAt: "2024-01-09T12:00:00.000Z",
      suppressedUntil: futureDate.toISOString(),
    });

    mockSend.mockResolvedValueOnce({ Items: [suppressedRec] });

    const candidates = [
      { category: "reduce_change_size" as const, targetTeam: "team-1", targetService: "svc-A" },
      { category: "adjust_timing" as const, targetTeam: "team-1", targetService: "svc-A" },
      { category: "reduce_change_size" as const, targetTeam: "team-2", targetService: "svc-A" },
    ];

    const result = await filterSuppressedRecommendations("tenant-abc", candidates);

    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("adjust_timing");
    expect(result[1].targetTeam).toBe("team-2");
  });
});
