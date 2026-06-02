/**
 * Unit tests for the Pre-Deployment Risk Assessment API.
 *
 * POST /api/risk/assess
 *
 * Tests cover:
 * - Authentication enforcement (401 on missing/invalid token)
 * - Tier gate enforcement (403 on Starter tier)
 * - Request validation (400 on missing/invalid fields)
 * - Successful risk assessment computation
 * - Response structure (score, factors, weights, numericScore, source)
 * - No data persistence (read-only operation)
 * - Error handling for computation failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockSend = vi.hoisted(() => vi.fn());

// Mock DynamoDB client
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

// Mock tenant-scope (pass-through)
vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantServiceKey: (tenantId: string, serviceId: string) =>
    `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

// Mock infra eventbridge rules (needed by risk-scorer handler)
vi.mock("../../../infra/eventbridge-rules", () => ({
  EVENT_BUS_NAME: "ollinai-events-bus",
  EVENT_SOURCES: { RISK_SCORER: "ollinai.risk-scorer" },
  EVENT_DETAIL_TYPES: { RISK_SCORE_COMPUTED: "risk-score.computed" },
}));

// Mock EventBridge client (needed by risk-scorer handler)
vi.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: vi.fn(),
  PutEventsCommand: vi.fn(),
}));

// Mock authorization
const mockWithAuthorization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/middleware/authorize", () => ({
  withAuthorization: mockWithAuthorization,
}));

// Mock tier gate
const mockWithTierGate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/middleware/tier-gate", () => ({
  withTierGate: mockWithTierGate,
}));

import { POST } from "@/app/api/risk/assess/route";
import { NextResponse } from "next/server";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/risk/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockAuthenticated(tenantId = "tenant-123", role = "team_lead") {
  mockWithAuthorization.mockResolvedValue({
    session: {
      userId: "user-001",
      tenantId,
      role,
      teamIds: ["team-alpha"],
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
}

function mockUnauthenticated() {
  mockWithAuthorization.mockResolvedValue(
    NextResponse.json(
      { error: "Authentication required", code: "MISSING_TOKEN" },
      { status: 401 }
    )
  );
}

function mockTierAllowed() {
  mockWithTierGate.mockResolvedValue({ tier: "pro" });
}

function mockTierBlocked() {
  mockWithTierGate.mockResolvedValue(
    NextResponse.json(
      {
        error: "Deployment Risk Scoring is not available on the Starter tier.",
        code: "FEATURE_NOT_AVAILABLE",
        currentTier: "starter",
        requiredAction: "upgrade",
      },
      { status: 403 }
    )
  );
}

function validRequestBody() {
  return {
    service: "payment-service",
    author: "dev@example.com",
    changeSize: {
      filesChanged: 10,
      linesAdded: 200,
      linesRemoved: 50,
    },
    plannedTimestamp: "2024-01-15T10:00:00.000Z",
  };
}

function createHistoricalDeployments(count: number, withIncidents = 0) {
  const deployments = [];
  for (let i = 0; i < count; i++) {
    const date = new Date("2024-01-01T10:00:00.000Z");
    date.setDate(date.getDate() + i);
    deployments.push({
      PK: "TENANT#tenant-123#SVC#payment-service",
      SK: `DEPLOY#${date.toISOString()}#event-hist-${i}`,
      eventId: `event-hist-${i}`,
      commitShas: ["abc123"],
      author: "dev@example.com",
      services: ["payment-service"],
      environment: "production",
      teamId: "team-alpha",
      createdAt: date.toISOString(),
      correlatedIncidents: i < withIncidents ? [`inc-${i}`] : undefined,
    });
  }
  return deployments;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/risk/assess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("should return 401 when not authenticated", async () => {
      mockUnauthenticated();
      const request = createRequest(validRequestBody());

      const response = await POST(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });

  describe("Tier Gate", () => {
    it("should return 403 when on Starter tier", async () => {
      mockAuthenticated();
      mockTierBlocked();
      const request = createRequest(validRequestBody());

      const response = await POST(request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.code).toBe("FEATURE_NOT_AVAILABLE");
      expect(body.requiredAction).toBe("upgrade");
    });

    it("should call withTierGate with risk_score feature", async () => {
      mockAuthenticated();
      mockTierAllowed();
      // Mock DynamoDB calls for risk computation
      mockSend.mockResolvedValueOnce({ Items: [] }); // config (weights)
      mockSend.mockResolvedValueOnce({ Items: createHistoricalDeployments(15) }); // history

      const request = createRequest(validRequestBody());
      await POST(request);

      expect(mockWithTierGate).toHaveBeenCalledWith("tenant-123", "risk_score");
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      mockAuthenticated();
      mockTierAllowed();
    });

    it("should return 400 for invalid JSON body", async () => {
      const request = new NextRequest("http://localhost:3000/api/risk/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid JSON body");
    });

    it("should return 400 when service is missing", async () => {
      const request = createRequest({
        author: "dev@example.com",
        changeSize: { filesChanged: 10, linesAdded: 200, linesRemoved: 50 },
        plannedTimestamp: "2024-01-15T10:00:00.000Z",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.fields.service).toBeDefined();
    });

    it("should return 400 when author is missing", async () => {
      const request = createRequest({
        service: "payment-service",
        changeSize: { filesChanged: 10, linesAdded: 200, linesRemoved: 50 },
        plannedTimestamp: "2024-01-15T10:00:00.000Z",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.fields.author).toBeDefined();
    });

    it("should return 400 when changeSize is missing", async () => {
      const request = createRequest({
        service: "payment-service",
        author: "dev@example.com",
        plannedTimestamp: "2024-01-15T10:00:00.000Z",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.fields.changeSize).toBeDefined();
    });

    it("should return 400 when plannedTimestamp is missing", async () => {
      const request = createRequest({
        service: "payment-service",
        author: "dev@example.com",
        changeSize: { filesChanged: 10, linesAdded: 200, linesRemoved: 50 },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.fields.plannedTimestamp).toBeDefined();
    });

    it("should return 400 for invalid plannedTimestamp", async () => {
      const request = createRequest({
        ...validRequestBody(),
        plannedTimestamp: "not-a-date",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.fields.plannedTimestamp).toBeDefined();
    });

    it("should return 400 for negative filesChanged", async () => {
      const request = createRequest({
        ...validRequestBody(),
        changeSize: { filesChanged: -1, linesAdded: 0, linesRemoved: 0 },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
    });

    it("should return 400 for empty service name", async () => {
      const request = createRequest({
        ...validRequestBody(),
        service: "",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
    });
  });

  describe("Successful Risk Assessment", () => {
    beforeEach(() => {
      mockAuthenticated();
      mockTierAllowed();
    });

    it("should compute and return a risk assessment", async () => {
      const historicalDeployments = createHistoricalDeployments(15, 3);

      // Mock DynamoDB calls
      mockSend.mockResolvedValueOnce({ Items: [] }); // config (no custom weights)
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments }); // historical deployments

      const request = createRequest(validRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Verify response structure
      expect(body.score).toMatch(/^(low|medium|high|critical)$/);
      expect(body.factors).toBeDefined();
      expect(body.factors.changeFailureRate).toBeTypeOf("number");
      expect(body.factors.changeSize).toBeTypeOf("number");
      expect(body.factors.deploymentTiming).toBeTypeOf("number");
      expect(body.factors.authorFailureRate).toBeTypeOf("number");
      expect(body.weights).toBeDefined();
      expect(body.numericScore).toBeTypeOf("number");
      expect(body.numericScore).toBeGreaterThanOrEqual(0);
      expect(body.numericScore).toBeLessThanOrEqual(1);
      expect(body.source).toBe("rule_engine");
    });

    it("should use default weights when no custom weights configured", async () => {
      const historicalDeployments = createHistoricalDeployments(15);

      mockSend.mockResolvedValueOnce({ Items: [] }); // no custom weights
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments });

      const request = createRequest(validRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.weights.changeFailureRate).toBe(0.35);
      expect(body.weights.changeSize).toBe(0.25);
      expect(body.weights.deploymentTiming).toBe(0.2);
      expect(body.weights.authorFailureRate).toBe(0.2);
    });

    it("should use custom weights when configured", async () => {
      const historicalDeployments = createHistoricalDeployments(15);

      // Custom weights from config
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#tenant-123",
            SK: "SETTINGS#risk_weights",
            entityData: {
              changeFailureRate: 0.4,
              changeSize: 0.3,
              deploymentTiming: 0.15,
              authorFailureRate: 0.15,
            },
          },
        ],
      });
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments });

      const request = createRequest(validRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.weights.changeFailureRate).toBe(0.4);
      expect(body.weights.changeSize).toBe(0.3);
      expect(body.weights.deploymentTiming).toBe(0.15);
      expect(body.weights.authorFailureRate).toBe(0.15);
    });

    it("should fall back to org-wide baseline when <10 service deployments", async () => {
      const fewDeployments = createHistoricalDeployments(5);
      const orgWideDeployments = createHistoricalDeployments(20, 4);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: fewDeployments }); // service history (<10)
      mockSend.mockResolvedValueOnce({ Items: orgWideDeployments }); // org-wide baseline

      const request = createRequest(validRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.score).toMatch(/^(low|medium|high|critical)$/);

      // Should have made 3 DynamoDB calls: config, service, org-wide
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("should NOT persist any data (read-only)", async () => {
      const historicalDeployments = createHistoricalDeployments(15);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments }); // history

      const request = createRequest(validRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Only 2 DynamoDB calls: reading config and querying history
      // No PutCommand or UpdateCommand calls
      expect(mockSend).toHaveBeenCalledTimes(2);

      // Verify no write operations were sent
      for (const call of mockSend.mock.calls) {
        const input = call[0]?.input;
        // Should only be QueryCommands (reads)
        expect(input).not.toHaveProperty("UpdateExpression");
        expect(input).not.toHaveProperty("Item");
      }
    });

    it("should allow any role to access the endpoint", async () => {
      mockAuthenticated("tenant-123", "viewer");
      mockTierAllowed();

      const historicalDeployments = createHistoricalDeployments(15);
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments });

      const request = createRequest(validRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      mockAuthenticated();
      mockTierAllowed();
    });

    it("should return 500 when risk computation fails", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockRejectedValueOnce(new Error("DynamoDB timeout")); // history query fails

      const request = createRequest(validRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe("Risk assessment computation failed");
      expect(body.details).toBeDefined();
    });
  });
});
