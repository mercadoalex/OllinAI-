/**
 * Unit tests for the DORA Metrics Query API.
 *
 * Tests cover:
 * - Authentication enforcement (401 on missing/invalid token)
 * - Query parameter parsing and validation
 * - Default time range (30 days) when no from/to specified
 * - Maximum queryable range enforcement (365 days)
 * - Reading from cached metrics (DAX/DynamoDB)
 * - On-the-fly computation when no cached metrics exist
 * - INSUFFICIENT_DATA_SENTINEL conversion to "insufficient_data"
 * - Filter resolution (service > team > environment > ALL)
 * - Response shape matches DORAMetrics interface
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSend, mockComputeAndStoreMetrics } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockComputeAndStoreMetrics: vi.fn(),
}));

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
  tenantMetricsScopeKey: (
    tenantId: string,
    scopeType: string,
    scopeId: string
  ) => `TENANT#${tenantId}#SCOPE#${scopeType}#${scopeId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

vi.mock("@/lambdas/dora-computer/handler", () => ({
  computeAndStoreMetrics: mockComputeAndStoreMetrics,
  INSUFFICIENT_DATA_SENTINEL: -1,
}));

vi.mock("@/lib/middleware/authorize", () => ({
  withAuthorization: vi.fn(),
}));

import { GET } from "@/app/api/metrics/dora/route";
import { withAuthorization } from "@/lib/middleware/authorize";
import { NextResponse } from "next/server";
import type { MetricsItem } from "@/lib/types/dynamo";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

function mockAuthenticated() {
  (withAuthorization as ReturnType<typeof vi.fn>).mockResolvedValue({
    session: {
      userId: "user-001",
      tenantId: "tenant-123",
      role: "tenant_admin" as const,
      teamIds: ["team-alpha"],
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
}

function mockUnauthenticated() {
  (withAuthorization as ReturnType<typeof vi.fn>).mockResolvedValue(
    NextResponse.json(
      { error: "Authentication required", code: "MISSING_TOKEN" },
      { status: 401 }
    )
  );
}

function createMetricsItem(overrides?: Partial<MetricsItem>): MetricsItem {
  return {
    PK: "TENANT#tenant-123#SCOPE#SERVICE#payment-service",
    SK: "PERIOD#2024-01-01T00:00:00.000Z#2024-01-31T00:00:00.000Z",
    deploymentFrequency: 15,
    leadTimeHours: 4.5,
    changeFailureRate: 12.5,
    mttrHours: 2.3,
    unresolvedCount: 1,
    dataPoints: 15,
    computedAt: "2024-01-31T12:00:00.000Z",
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/metrics/dora", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── Authentication ────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("should return 401 when not authenticated", async () => {
      mockUnauthenticated();

      const request = createRequest("/api/metrics/dora");
      const response = await GET(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Authentication required");
    });

    it("should proceed when authenticated", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  // ─── Query Parameter Validation ────────────────────────────────────────────

  describe("query parameter validation", () => {
    it("should return 400 for invalid 'from' date", async () => {
      mockAuthenticated();

      const request = createRequest("/api/metrics/dora?from=not-a-date");
      const response = await GET(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Invalid 'from' parameter");
    });

    it("should return 400 for invalid 'to' date", async () => {
      mockAuthenticated();

      const request = createRequest("/api/metrics/dora?to=invalid");
      const response = await GET(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Invalid 'to' parameter");
    });

    it("should return 400 when 'from' is after 'to'", async () => {
      mockAuthenticated();

      const request = createRequest(
        "/api/metrics/dora?from=2024-02-01T00:00:00.000Z&to=2024-01-01T00:00:00.000Z"
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("'from' must be before 'to'");
    });

    it("should return 400 when range exceeds 365 days", async () => {
      mockAuthenticated();

      const request = createRequest(
        "/api/metrics/dora?from=2022-01-01T00:00:00.000Z&to=2024-01-01T00:00:00.000Z"
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Maximum queryable range is 365 days");
    });

    it("should accept range exactly at 365 days", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest(
        "/api/metrics/dora?from=2023-02-01T00:00:00.000Z&to=2024-02-01T00:00:00.000Z&service=svc"
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  // ─── Default Time Range ────────────────────────────────────────────────────

  describe("default time range", () => {
    it("should default to 30 days when no from/to specified", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Period should be 30 days back from now (2024-02-01)
      expect(body.period.end).toBe("2024-02-01T00:00:00.000Z");
      expect(body.period.start).toBe("2024-01-02T00:00:00.000Z");
    });

    it("should default 'from' to 30 days before 'to' when only 'to' is specified", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest(
        "/api/metrics/dora?to=2024-01-31T00:00:00.000Z&service=svc"
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.period.start).toBe("2024-01-01T00:00:00.000Z");
      expect(body.period.end).toBe("2024-01-31T00:00:00.000Z");
    });
  });

  // ─── Scope Resolution ─────────────────────────────────────────────────────

  describe("scope resolution", () => {
    it("should use SERVICE scope when service filter is provided", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem();
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      await GET(request);

      const getInput = mockSend.mock.calls[0][0].input;
      expect(getInput.Key.PK).toBe(
        "TENANT#tenant-123#SCOPE#SERVICE#payment-service"
      );
    });

    it("should use TEAM scope when team filter is provided (no service)", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem();
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest("/api/metrics/dora?team=team-alpha");
      await GET(request);

      const getInput = mockSend.mock.calls[0][0].input;
      expect(getInput.Key.PK).toBe(
        "TENANT#tenant-123#SCOPE#TEAM#team-alpha"
      );
    });

    it("should use ENVIRONMENT scope when only environment filter is provided", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem();
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest("/api/metrics/dora?environment=production");
      await GET(request);

      const getInput = mockSend.mock.calls[0][0].input;
      expect(getInput.Key.PK).toBe(
        "TENANT#tenant-123#SCOPE#ENVIRONMENT#production"
      );
    });

    it("should use ALL scope when no filters are provided", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem();
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest("/api/metrics/dora");
      await GET(request);

      const getInput = mockSend.mock.calls[0][0].input;
      expect(getInput.Key.PK).toBe("TENANT#tenant-123#SCOPE#ALL#ALL");
    });

    it("should prioritize service over team when both provided", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem();
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest(
        "/api/metrics/dora?service=payment-service&team=team-alpha"
      );
      await GET(request);

      const getInput = mockSend.mock.calls[0][0].input;
      expect(getInput.Key.PK).toBe(
        "TENANT#tenant-123#SCOPE#SERVICE#payment-service"
      );
    });
  });

  // ─── Cached Metrics Reading ────────────────────────────────────────────────

  describe("cached metrics reading", () => {
    it("should return cached metrics when available", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem({
        deploymentFrequency: 20,
        leadTimeHours: 3.2,
        changeFailureRate: 8.5,
        mttrHours: 1.1,
        unresolvedCount: 3,
      });
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.deploymentFrequency).toBe(20);
      expect(body.leadTimeHours).toBe(3.2);
      expect(body.changeFailureRate).toBe(8.5);
      expect(body.mttrHours).toBe(1.1);
      expect(body.unresolvedIncidentCount).toBe(3);
    });

    it("should NOT call computeAndStoreMetrics when cached metrics exist", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      await GET(request);

      expect(mockComputeAndStoreMetrics).not.toHaveBeenCalled();
    });
  });

  // ─── On-the-fly Computation ────────────────────────────────────────────────

  describe("on-the-fly computation", () => {
    it("should compute metrics when no cached metrics exist", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: undefined }); // No cached metrics
      mockComputeAndStoreMetrics.mockResolvedValueOnce(createMetricsItem());

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockComputeAndStoreMetrics).toHaveBeenCalledOnce();
      expect(mockComputeAndStoreMetrics).toHaveBeenCalledWith(
        "tenant-123",
        "SERVICE",
        "payment-service",
        "payment-service",
        undefined,
        expect.any(String),
        expect.any(String)
      );
    });

    it("should pass team as both scopeId and teamId for TEAM scope computation", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockComputeAndStoreMetrics.mockResolvedValueOnce(createMetricsItem());

      const request = createRequest("/api/metrics/dora?team=team-alpha");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockComputeAndStoreMetrics).toHaveBeenCalledWith(
        "tenant-123",
        "TEAM",
        "team-alpha",
        "team-alpha", // serviceId falls back to scopeId
        "team-alpha", // teamId from filter
        expect.any(String),
        expect.any(String)
      );
    });
  });

  // ─── Insufficient Data Transformation ──────────────────────────────────────

  describe("insufficient data transformation", () => {
    it("should convert -1 sentinel to 'insufficient_data' in response", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem({
        deploymentFrequency: -1,
        leadTimeHours: -1,
        changeFailureRate: -1,
        mttrHours: -1,
        unresolvedCount: 0,
        dataPoints: 1,
      });
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.deploymentFrequency).toBe("insufficient_data");
      expect(body.leadTimeHours).toBe("insufficient_data");
      expect(body.changeFailureRate).toBe("insufficient_data");
      expect(body.mttrHours).toBe("insufficient_data");
    });

    it("should not convert valid numeric values", async () => {
      mockAuthenticated();
      const metricsItem = createMetricsItem({
        deploymentFrequency: 10,
        leadTimeHours: 2.5,
        changeFailureRate: 0,
        mttrHours: 1.5,
      });
      mockSend.mockResolvedValueOnce({ Item: metricsItem });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.deploymentFrequency).toBe(10);
      expect(body.leadTimeHours).toBe(2.5);
      expect(body.changeFailureRate).toBe(0);
      expect(body.mttrHours).toBe(1.5);
    });
  });

  // ─── Response Shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("should return DORAMetrics-shaped response with period and filters", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest(
        "/api/metrics/dora?service=payment-service&team=team-alpha&environment=production"
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Verify shape
      expect(body).toHaveProperty("deploymentFrequency");
      expect(body).toHaveProperty("leadTimeHours");
      expect(body).toHaveProperty("changeFailureRate");
      expect(body).toHaveProperty("mttrHours");
      expect(body).toHaveProperty("unresolvedIncidentCount");
      expect(body).toHaveProperty("period");
      expect(body.period).toHaveProperty("start");
      expect(body.period).toHaveProperty("end");
      expect(body).toHaveProperty("filters");
      expect(body.filters).toEqual({
        team: "team-alpha",
        service: "payment-service",
        environment: "production",
      });
    });

    it("should only include non-empty filters in the response", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.filters).toEqual({ service: "payment-service" });
      expect(body.filters).not.toHaveProperty("team");
      expect(body.filters).not.toHaveProperty("environment");
    });

    it("should return empty filters object when no filters are provided", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: createMetricsItem() });

      const request = createRequest("/api/metrics/dora");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.filters).toEqual({});
    });
  });

  // ─── Error Handling ────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("should return 500 when DynamoDB query fails", async () => {
      mockAuthenticated();
      mockSend.mockRejectedValueOnce(new Error("DynamoDB connection failed"));

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe("Failed to retrieve DORA metrics");
      expect(body.details).toBe("DynamoDB connection failed");
    });

    it("should return 500 when on-the-fly computation fails", async () => {
      mockAuthenticated();
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockComputeAndStoreMetrics.mockRejectedValueOnce(
        new Error("Computation timeout")
      );

      const request = createRequest("/api/metrics/dora?service=payment-service");
      const response = await GET(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe("Failed to retrieve DORA metrics");
    });
  });
});
