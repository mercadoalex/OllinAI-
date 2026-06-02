/**
 * Unit tests for the DORA Metrics Computer Lambda Handler.
 *
 * Tests cover:
 * - Deployment Frequency computation
 * - Lead Time computation
 * - Change Failure Rate computation
 * - MTTR computation (including unresolved incident exclusion)
 * - Insufficient data handling (< 3 data points → sentinel)
 * - Metrics write to DynamoDB
 * - EventBridge trigger processing for all event types
 * - Scope-based queries (TEAM vs SERVICE)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventBridgeEvent } from "aws-lambda";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
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
  tenantServiceKey: (tenantId: string, serviceId: string) =>
    `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantTeamKey: (tenantId: string, teamId: string) =>
    `TENANT#${tenantId}#TEAM#${teamId}`,
  tenantMetricsScopeKey: (
    tenantId: string,
    scopeType: string,
    scopeId: string
  ) => `TENANT#${tenantId}#SCOPE#${scopeType}#${scopeId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

import {
  handler,
  computeDeploymentFrequency,
  computeLeadTime,
  computeChangeFailureRate,
  computeMTTR,
  computeAndStoreMetrics,
  queryDeployments,
  queryIncidents,
  writeMetrics,
  INSUFFICIENT_DATA_SENTINEL,
} from "@/lambdas/dora-computer/handler";
import type { EventItem, IncidentItem, MetricsItem } from "@/lib/types/dynamo";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createDeploymentItem(overrides?: Partial<EventItem>): EventItem {
  return {
    PK: "TENANT#tenant-123#SVC#payment-service",
    SK: "DEPLOY#2024-01-15T09:30:00.000Z#event-001",
    eventId: "event-001",
    commitShas: ["abc123", "def456"],
    author: "dev@example.com",
    services: ["payment-service"],
    environment: "production",
    teamId: "team-alpha",
    createdAt: "2024-01-15T09:30:00.000Z",
    ...overrides,
  };
}

function createIncidentItem(overrides?: Partial<IncidentItem>): IncidentItem {
  return {
    PK: "TENANT#tenant-123#SVC#payment-service",
    SK: "INC#2024-01-15T10:00:00.000Z#incident-001",
    incidentId: "incident-001",
    externalId: "ext-001",
    severity: "high",
    detectionTimestamp: "2024-01-15T10:00:00.000Z",
    resolutionTimestamp: "2024-01-15T12:00:00.000Z",
    correlationStatus: "correlated",
    ...overrides,
  };
}

function createEventBridgeEvent(
  detailType: string,
  detail: Record<string, unknown>
): EventBridgeEvent<string, Record<string, unknown>> {
  return {
    version: "0",
    id: "event-123",
    source: "ollinai.ingestion",
    account: "123456789",
    time: "2024-01-15T10:00:00.000Z",
    region: "us-east-1",
    resources: [],
    "detail-type": detailType,
    detail,
  } as unknown as EventBridgeEvent<string, Record<string, unknown>>;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("DORA Computer Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── computeDeploymentFrequency ────────────────────────────────────────────

  describe("computeDeploymentFrequency", () => {
    it("should return deployment count when >= 3 deployments", () => {
      const deployments = [
        createDeploymentItem({ eventId: "e1" }),
        createDeploymentItem({ eventId: "e2" }),
        createDeploymentItem({ eventId: "e3" }),
        createDeploymentItem({ eventId: "e4" }),
      ];

      const result = computeDeploymentFrequency(deployments);

      expect(result).toBe(4);
    });

    it("should return INSUFFICIENT_DATA_SENTINEL when < 3 deployments", () => {
      const deployments = [
        createDeploymentItem({ eventId: "e1" }),
        createDeploymentItem({ eventId: "e2" }),
      ];

      const result = computeDeploymentFrequency(deployments);

      expect(result).toBe(INSUFFICIENT_DATA_SENTINEL);
    });

    it("should return INSUFFICIENT_DATA_SENTINEL for empty array", () => {
      const result = computeDeploymentFrequency([]);

      expect(result).toBe(INSUFFICIENT_DATA_SENTINEL);
    });

    it("should return exactly 3 for minimum valid input", () => {
      const deployments = [
        createDeploymentItem({ eventId: "e1" }),
        createDeploymentItem({ eventId: "e2" }),
        createDeploymentItem({ eventId: "e3" }),
      ];

      const result = computeDeploymentFrequency(deployments);

      expect(result).toBe(3);
    });
  });

  // ─── computeLeadTime ──────────────────────────────────────────────────────

  describe("computeLeadTime", () => {
    it("should return INSUFFICIENT_DATA_SENTINEL when < 3 deployments", () => {
      const deployments = [createDeploymentItem()];

      const result = computeLeadTime(deployments);

      expect(result).toBe(INSUFFICIENT_DATA_SENTINEL);
    });

    it("should compute lead time based on commit count heuristic", () => {
      const deployments = [
        createDeploymentItem({
          eventId: "e1",
          commitShas: ["a", "b", "c"],
          SK: "DEPLOY#2024-01-15T09:00:00.000Z#e1",
        }),
        createDeploymentItem({
          eventId: "e2",
          commitShas: ["d", "e"],
          SK: "DEPLOY#2024-01-15T10:00:00.000Z#e2",
        }),
        createDeploymentItem({
          eventId: "e3",
          commitShas: ["f"],
          SK: "DEPLOY#2024-01-15T11:00:00.000Z#e3",
        }),
      ];

      const result = computeLeadTime(deployments);

      // Average: (3*0.5 + 2*0.5 + 1*0.5) / 3 = (1.5 + 1.0 + 0.5) / 3 = 1.0
      expect(result).toBe(1);
    });

    it("should handle deployments with single commit", () => {
      const deployments = [
        createDeploymentItem({
          eventId: "e1",
          commitShas: ["a"],
          SK: "DEPLOY#2024-01-15T09:00:00.000Z#e1",
        }),
        createDeploymentItem({
          eventId: "e2",
          commitShas: ["b"],
          SK: "DEPLOY#2024-01-15T10:00:00.000Z#e2",
        }),
        createDeploymentItem({
          eventId: "e3",
          commitShas: ["c"],
          SK: "DEPLOY#2024-01-15T11:00:00.000Z#e3",
        }),
      ];

      const result = computeLeadTime(deployments);

      // Average: (1*0.5 + 1*0.5 + 1*0.5) / 3 = 0.5
      expect(result).toBe(0.5);
    });
  });

  // ─── computeChangeFailureRate ──────────────────────────────────────────────

  describe("computeChangeFailureRate", () => {
    it("should return INSUFFICIENT_DATA_SENTINEL when < 3 deployments", () => {
      const deployments = [createDeploymentItem(), createDeploymentItem()];

      const result = computeChangeFailureRate(deployments);

      expect(result).toBe(INSUFFICIENT_DATA_SENTINEL);
    });

    it("should return 0 when no deployments have correlated incidents", () => {
      const deployments = [
        createDeploymentItem({ eventId: "e1", correlatedIncidents: [] }),
        createDeploymentItem({ eventId: "e2", correlatedIncidents: undefined }),
        createDeploymentItem({ eventId: "e3" }),
      ];

      const result = computeChangeFailureRate(deployments);

      expect(result).toBe(0);
    });

    it("should compute correct percentage when some deployments have incidents", () => {
      const deployments = [
        createDeploymentItem({ eventId: "e1", correlatedIncidents: ["inc-1"] }),
        createDeploymentItem({ eventId: "e2", correlatedIncidents: [] }),
        createDeploymentItem({ eventId: "e3" }),
        createDeploymentItem({ eventId: "e4", correlatedIncidents: ["inc-2"] }),
      ];

      const result = computeChangeFailureRate(deployments);

      // 2 out of 4 = 50%
      expect(result).toBe(50);
    });

    it("should return 100 when all deployments have incidents", () => {
      const deployments = [
        createDeploymentItem({
          eventId: "e1",
          correlatedIncidents: ["inc-1"],
        }),
        createDeploymentItem({
          eventId: "e2",
          correlatedIncidents: ["inc-2"],
        }),
        createDeploymentItem({
          eventId: "e3",
          correlatedIncidents: ["inc-3"],
        }),
      ];

      const result = computeChangeFailureRate(deployments);

      expect(result).toBe(100);
    });

    it("should handle fractional percentages with rounding", () => {
      const deployments = [
        createDeploymentItem({
          eventId: "e1",
          correlatedIncidents: ["inc-1"],
        }),
        createDeploymentItem({ eventId: "e2" }),
        createDeploymentItem({ eventId: "e3" }),
      ];

      const result = computeChangeFailureRate(deployments);

      // 1 out of 3 = 33.33%
      expect(result).toBe(33.33);
    });
  });

  // ─── computeMTTR ──────────────────────────────────────────────────────────

  describe("computeMTTR", () => {
    it("should return INSUFFICIENT_DATA_SENTINEL when < 3 resolved incidents", () => {
      const incidents = [
        createIncidentItem({
          incidentId: "i1",
          detectionTimestamp: "2024-01-15T10:00:00.000Z",
          resolutionTimestamp: "2024-01-15T12:00:00.000Z",
        }),
        createIncidentItem({
          incidentId: "i2",
          detectionTimestamp: "2024-01-15T11:00:00.000Z",
          resolutionTimestamp: "2024-01-15T13:00:00.000Z",
        }),
      ];

      const result = computeMTTR(incidents);

      expect(result.mttrHours).toBe(INSUFFICIENT_DATA_SENTINEL);
      expect(result.unresolvedCount).toBe(0);
    });

    it("should exclude unresolved incidents from MTTR and count them separately", () => {
      const incidents = [
        createIncidentItem({
          incidentId: "i1",
          detectionTimestamp: "2024-01-15T10:00:00.000Z",
          resolutionTimestamp: "2024-01-15T12:00:00.000Z",
        }),
        createIncidentItem({
          incidentId: "i2",
          detectionTimestamp: "2024-01-15T11:00:00.000Z",
          resolutionTimestamp: "2024-01-15T14:00:00.000Z",
        }),
        createIncidentItem({
          incidentId: "i3",
          detectionTimestamp: "2024-01-15T12:00:00.000Z",
          resolutionTimestamp: "2024-01-15T13:00:00.000Z",
        }),
        createIncidentItem({
          incidentId: "i4",
          detectionTimestamp: "2024-01-15T13:00:00.000Z",
          resolutionTimestamp: undefined,
        }),
        createIncidentItem({
          incidentId: "i5",
          detectionTimestamp: "2024-01-15T14:00:00.000Z",
          resolutionTimestamp: undefined,
        }),
      ];

      const result = computeMTTR(incidents);

      // Resolved incidents: i1=2h, i2=3h, i3=1h → average = (2+3+1)/3 = 2.0h
      expect(result.mttrHours).toBe(2);
      expect(result.unresolvedCount).toBe(2);
    });

    it("should return INSUFFICIENT_DATA_SENTINEL when all incidents are unresolved", () => {
      const incidents = [
        createIncidentItem({
          incidentId: "i1",
          resolutionTimestamp: undefined,
        }),
        createIncidentItem({
          incidentId: "i2",
          resolutionTimestamp: undefined,
        }),
        createIncidentItem({
          incidentId: "i3",
          resolutionTimestamp: undefined,
        }),
      ];

      const result = computeMTTR(incidents);

      expect(result.mttrHours).toBe(INSUFFICIENT_DATA_SENTINEL);
      expect(result.unresolvedCount).toBe(3);
    });

    it("should compute MTTR correctly for all resolved incidents", () => {
      const incidents = [
        createIncidentItem({
          incidentId: "i1",
          detectionTimestamp: "2024-01-15T10:00:00.000Z",
          resolutionTimestamp: "2024-01-15T10:30:00.000Z",
        }),
        createIncidentItem({
          incidentId: "i2",
          detectionTimestamp: "2024-01-15T11:00:00.000Z",
          resolutionTimestamp: "2024-01-15T12:00:00.000Z",
        }),
        createIncidentItem({
          incidentId: "i3",
          detectionTimestamp: "2024-01-15T12:00:00.000Z",
          resolutionTimestamp: "2024-01-15T14:30:00.000Z",
        }),
      ];

      const result = computeMTTR(incidents);

      // i1=0.5h, i2=1.0h, i3=2.5h → average = (0.5+1.0+2.5)/3 = 1.33h
      expect(result.mttrHours).toBe(1.33);
      expect(result.unresolvedCount).toBe(0);
    });

    it("should return correct result for empty incidents array", () => {
      const result = computeMTTR([]);

      expect(result.mttrHours).toBe(INSUFFICIENT_DATA_SENTINEL);
      expect(result.unresolvedCount).toBe(0);
    });
  });

  // ─── queryDeployments ──────────────────────────────────────────────────────

  describe("queryDeployments", () => {
    it("should query GSI-2 for TEAM scope", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await queryDeployments(
        "tenant-123",
        "TEAM",
        "team-alpha",
        "payment-service",
        "team-alpha",
        "2024-01-01T00:00:00.000Z",
        "2024-01-31T23:59:59.999Z"
      );

      expect(mockSend).toHaveBeenCalledOnce();
      const queryInput = mockSend.mock.calls[0][0].input;

      expect(queryInput.TableName).toBe("ollinai-events");
      expect(queryInput.IndexName).toBe("GSI2-TeamView");
      expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
        "TENANT#tenant-123#TEAM#team-alpha"
      );
      expect(queryInput.ExpressionAttributeValues[":skStart"]).toBe(
        "DEPLOY#2024-01-01T00:00:00.000Z"
      );
      expect(queryInput.ExpressionAttributeValues[":skEnd"]).toBe(
        "DEPLOY#2024-01-31T23:59:59.999Z"
      );
    });

    it("should query primary table for SERVICE scope", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await queryDeployments(
        "tenant-123",
        "SERVICE",
        "payment-service",
        "payment-service",
        undefined,
        "2024-01-01T00:00:00.000Z",
        "2024-01-31T23:59:59.999Z"
      );

      expect(mockSend).toHaveBeenCalledOnce();
      const queryInput = mockSend.mock.calls[0][0].input;

      expect(queryInput.TableName).toBe("ollinai-events");
      expect(queryInput.IndexName).toBeUndefined();
      expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
        "TENANT#tenant-123#SVC#payment-service"
      );
    });

    it("should return items from query result", async () => {
      const deployment = createDeploymentItem();
      mockSend.mockResolvedValueOnce({ Items: [deployment] });

      const result = await queryDeployments(
        "tenant-123",
        "SERVICE",
        "payment-service",
        "payment-service",
        undefined,
        "2024-01-01T00:00:00.000Z",
        "2024-01-31T23:59:59.999Z"
      );

      expect(result).toHaveLength(1);
      expect(result[0].eventId).toBe("event-001");
    });
  });

  // ─── queryIncidents ────────────────────────────────────────────────────────

  describe("queryIncidents", () => {
    it("should query incidents table with correct key conditions", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await queryIncidents(
        "tenant-123",
        "payment-service",
        "2024-01-01T00:00:00.000Z",
        "2024-01-31T23:59:59.999Z"
      );

      expect(mockSend).toHaveBeenCalledOnce();
      const queryInput = mockSend.mock.calls[0][0].input;

      expect(queryInput.TableName).toBe("ollinai-incidents");
      expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
        "TENANT#tenant-123#SVC#payment-service"
      );
      expect(queryInput.ExpressionAttributeValues[":skStart"]).toBe(
        "INC#2024-01-01T00:00:00.000Z"
      );
      expect(queryInput.ExpressionAttributeValues[":skEnd"]).toBe(
        "INC#2024-01-31T23:59:59.999Z"
      );
    });

    it("should return incident items from query", async () => {
      const incident = createIncidentItem();
      mockSend.mockResolvedValueOnce({ Items: [incident] });

      const result = await queryIncidents(
        "tenant-123",
        "payment-service",
        "2024-01-01T00:00:00.000Z",
        "2024-01-31T23:59:59.999Z"
      );

      expect(result).toHaveLength(1);
      expect(result[0].incidentId).toBe("incident-001");
    });
  });

  // ─── writeMetrics ──────────────────────────────────────────────────────────

  describe("writeMetrics", () => {
    it("should write metrics item to DynamoDB metrics table", async () => {
      mockSend.mockResolvedValueOnce({});

      const metricsItem: MetricsItem = {
        PK: "TENANT#tenant-123#SCOPE#SERVICE#payment-service",
        SK: "PERIOD#2024-01-01T00:00:00.000Z#2024-01-31T23:59:59.999Z",
        deploymentFrequency: 10,
        leadTimeHours: 2.5,
        changeFailureRate: 15,
        mttrHours: 1.5,
        unresolvedCount: 2,
        dataPoints: 10,
        computedAt: "2024-01-31T12:00:00.000Z",
      };

      await writeMetrics("tenant-123", metricsItem);

      expect(mockSend).toHaveBeenCalledOnce();
      const putInput = mockSend.mock.calls[0][0].input;

      expect(putInput.TableName).toBe("ollinai-metrics");
      expect(putInput.Item.PK).toBe(
        "TENANT#tenant-123#SCOPE#SERVICE#payment-service"
      );
      expect(putInput.Item.deploymentFrequency).toBe(10);
      expect(putInput.Item.mttrHours).toBe(1.5);
      expect(putInput.Item.unresolvedCount).toBe(2);
    });
  });

  // ─── computeAndStoreMetrics ────────────────────────────────────────────────

  describe("computeAndStoreMetrics", () => {
    it("should compute all metrics and write to DynamoDB", async () => {
      const deployments = [
        createDeploymentItem({
          eventId: "e1",
          commitShas: ["a", "b"],
          correlatedIncidents: ["inc-1"],
          SK: "DEPLOY#2024-01-10T09:00:00.000Z#e1",
        }),
        createDeploymentItem({
          eventId: "e2",
          commitShas: ["c"],
          SK: "DEPLOY#2024-01-12T10:00:00.000Z#e2",
        }),
        createDeploymentItem({
          eventId: "e3",
          commitShas: ["d", "e", "f"],
          correlatedIncidents: ["inc-2"],
          SK: "DEPLOY#2024-01-14T11:00:00.000Z#e3",
        }),
        createDeploymentItem({
          eventId: "e4",
          commitShas: ["g"],
          SK: "DEPLOY#2024-01-15T09:00:00.000Z#e4",
        }),
      ];

      const incidents = [
        createIncidentItem({
          incidentId: "inc-1",
          detectionTimestamp: "2024-01-10T10:00:00.000Z",
          resolutionTimestamp: "2024-01-10T12:00:00.000Z",
        }),
        createIncidentItem({
          incidentId: "inc-2",
          detectionTimestamp: "2024-01-14T12:00:00.000Z",
          resolutionTimestamp: "2024-01-14T15:00:00.000Z",
        }),
        createIncidentItem({
          incidentId: "inc-3",
          detectionTimestamp: "2024-01-15T08:00:00.000Z",
          resolutionTimestamp: "2024-01-15T09:00:00.000Z",
        }),
      ];

      // Mock: query deployments
      mockSend.mockResolvedValueOnce({ Items: deployments });
      // Mock: query incidents
      mockSend.mockResolvedValueOnce({ Items: incidents });
      // Mock: put metrics
      mockSend.mockResolvedValueOnce({});

      const result = await computeAndStoreMetrics(
        "tenant-123",
        "SERVICE",
        "payment-service",
        "payment-service",
        "team-alpha",
        "2024-01-01T00:00:00.000Z",
        "2024-01-31T23:59:59.999Z"
      );

      expect(result.deploymentFrequency).toBe(4);
      // Lead time: (2*0.5 + 1*0.5 + 3*0.5 + 1*0.5) / 4 = (1+0.5+1.5+0.5)/4 = 0.875 → 0.88
      expect(result.leadTimeHours).toBe(0.88);
      // CFR: 2 out of 4 = 50%
      expect(result.changeFailureRate).toBe(50);
      // MTTR: (2 + 3 + 1) / 3 = 2.0
      expect(result.mttrHours).toBe(2);
      expect(result.unresolvedCount).toBe(0);
      expect(result.dataPoints).toBe(4);
      expect(result.PK).toBe("TENANT#tenant-123#SCOPE#SERVICE#payment-service");
      expect(result.SK).toBe(
        "PERIOD#2024-01-01T00:00:00.000Z#2024-01-31T23:59:59.999Z"
      );

      // Should have written to DynamoDB
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("should handle insufficient data scenario", async () => {
      const deployments = [createDeploymentItem({ eventId: "e1" })];
      const incidents: IncidentItem[] = [];

      mockSend.mockResolvedValueOnce({ Items: deployments });
      mockSend.mockResolvedValueOnce({ Items: incidents });
      mockSend.mockResolvedValueOnce({});

      const result = await computeAndStoreMetrics(
        "tenant-123",
        "SERVICE",
        "payment-service",
        "payment-service",
        "team-alpha",
        "2024-01-01T00:00:00.000Z",
        "2024-01-31T23:59:59.999Z"
      );

      expect(result.deploymentFrequency).toBe(INSUFFICIENT_DATA_SENTINEL);
      expect(result.leadTimeHours).toBe(INSUFFICIENT_DATA_SENTINEL);
      expect(result.changeFailureRate).toBe(INSUFFICIENT_DATA_SENTINEL);
      expect(result.mttrHours).toBe(INSUFFICIENT_DATA_SENTINEL);
      expect(result.unresolvedCount).toBe(0);
      expect(result.dataPoints).toBe(1);
    });
  });

  // ─── handler ───────────────────────────────────────────────────────────────

  describe("handler", () => {
    it("should process deployment.ingested event and compute metrics for SERVICE and TEAM scopes", async () => {
      const event = createEventBridgeEvent("deployment.ingested", {
        tenantId: "tenant-123",
        serviceId: "payment-service",
        teamId: "team-alpha",
        eventId: "event-001",
        deploymentTimestamp: "2024-01-15T09:30:00.000Z",
        commitShas: ["abc123"],
      });

      // SERVICE scope: query deployments, query incidents, write metrics
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});
      // TEAM scope: query deployments, query incidents, write metrics
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      await handler(event as unknown as Parameters<typeof handler>[0]);

      // Should have made 6 calls: 2 scopes × 3 operations
      expect(mockSend).toHaveBeenCalledTimes(6);
    });

    it("should process correlation.created event", async () => {
      const event = createEventBridgeEvent("correlation.created", {
        tenantId: "tenant-123",
        serviceId: "auth-service",
        incidentId: "inc-001",
        correlatedDeployments: [{ eventId: "e1", temporalProximityMs: 5000, rank: 1 }],
        status: "correlated",
        correlatedAt: "2024-01-15T10:01:00.000Z",
      });

      // SERVICE scope only (no teamId in correlation.created)
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      await handler(event as unknown as Parameters<typeof handler>[0]);

      // Only SERVICE scope (no team info available)
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("should process incident.ingested event", async () => {
      const event = createEventBridgeEvent("incident.ingested", {
        tenantId: "tenant-123",
        serviceId: "order-service",
        incidentId: "inc-002",
        detectionTimestamp: "2024-01-15T12:00:00.000Z",
        resolutionTimestamp: "2024-01-15T14:00:00.000Z",
      });

      // SERVICE scope only
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      await handler(event as unknown as Parameters<typeof handler>[0]);

      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("should skip TEAM scope when teamId is UNASSIGNED", async () => {
      const event = createEventBridgeEvent("deployment.ingested", {
        tenantId: "tenant-123",
        serviceId: "new-service",
        teamId: "UNASSIGNED",
        eventId: "event-002",
        deploymentTimestamp: "2024-01-15T09:30:00.000Z",
        commitShas: ["xyz789"],
      });

      // Only SERVICE scope
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      await handler(event as unknown as Parameters<typeof handler>[0]);

      // Only 3 calls (SERVICE scope only, no TEAM scope)
      expect(mockSend).toHaveBeenCalledTimes(3);
    });
  });

  // ─── INSUFFICIENT_DATA_SENTINEL ────────────────────────────────────────────

  describe("INSUFFICIENT_DATA_SENTINEL", () => {
    it("should be -1", () => {
      expect(INSUFFICIENT_DATA_SENTINEL).toBe(-1);
    });
  });
});
