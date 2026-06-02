/**
 * Unit tests for the Correlation Engine Lambda Handler.
 *
 * Tests cover:
 * - Correlation window reading (default and custom)
 * - Deployment query within window
 * - Temporal proximity ranking
 * - Incident and event record updates
 * - EventBridge event emission
 * - Zero-correlation (uncorrelated) case
 * - Batch item failure handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SQSEvent, SQSRecord } from "aws-lambda";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// Use vi.hoisted to ensure mock functions are available during vi.mock hoisting
const { mockSend, mockEventBridgeSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockEventBridgeSend: vi.fn().mockResolvedValue({}),
}));

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

// Mock EventBridge - we only need to mock the module so the import doesn't fail
// The actual mock client is injected via setEventBridgeClient
const { MockPutEventsCommand } = vi.hoisted(() => ({
  MockPutEventsCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: vi.fn(),
  PutEventsCommand: MockPutEventsCommand,
}));

// Mock tenant-scope (pass-through)
vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantServiceKey: (tenantId: string, serviceId: string) =>
    `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

// Mock infra eventbridge rules
vi.mock("../../../infra/eventbridge-rules", () => ({
  EVENT_BUS_NAME: "ollinai-events-bus",
  EVENT_SOURCES: { CORRELATOR: "ollinai.correlator" },
  EVENT_DETAIL_TYPES: { CORRELATION_CREATED: "correlation.created" },
}));

import {
  handler,
  getCorrelationWindow,
  queryDeploymentsInWindow,
  rankByTemporalProximity,
  resetClients,
  setEventBridgeClient,
} from "@/lambdas/correlator/handler";
import type { EventItem } from "@/lib/types/dynamo";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createSQSEvent(records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

function createSQSRecord(body: object, messageId = "msg-1"): SQSRecord {
  return {
    messageId,
    receiptHandle: "receipt-1",
    body: JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: "1",
      SentTimestamp: "1234567890",
      SenderId: "sender-1",
      ApproximateFirstReceiveTimestamp: "1234567890",
    },
    messageAttributes: {},
    md5OfBody: "md5",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789:ollinai-incidents",
    awsRegion: "us-east-1",
  };
}

function createIncidentMessage(overrides?: Partial<{
  eventType: string;
  entityId: string;
  tenantId: string;
  metadata: Record<string, string>;
}>) {
  return {
    eventType: "incident.created",
    entityId: "incident-001",
    tenantId: "tenant-123",
    producedAt: "2024-01-15T10:00:00.000Z",
    metadata: {
      serviceId: "payment-service",
      severity: "high",
      detectionTimestamp: "2024-01-15T10:00:00.000Z",
    },
    ...overrides,
  };
}

function createDeploymentItem(overrides?: Partial<EventItem>): EventItem {
  return {
    PK: "TENANT#tenant-123#SVC#payment-service",
    SK: "DEPLOY#2024-01-15T09:30:00.000Z#event-001",
    eventId: "event-001",
    commitShas: ["abc123"],
    author: "dev@example.com",
    services: ["payment-service"],
    environment: "production",
    teamId: "team-alpha",
    createdAt: "2024-01-15T09:30:00.000Z",
    GSI1SK: "TS#2024-01-15T09:30:00.000Z",
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Correlator Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClients();
    mockEventBridgeSend.mockResolvedValue({});
    // Inject mock EventBridge client
    setEventBridgeClient({ send: mockEventBridgeSend } as unknown as import("@aws-sdk/client-eventbridge").EventBridgeClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handler", () => {
    it("should skip non-incident.created events", async () => {
      const message = createIncidentMessage({ eventType: "deployment.created" });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      // Should not attempt any DynamoDB operations
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should return batchItemFailure when record processing fails", async () => {
      const message = createIncidentMessage({
        metadata: { serviceId: "payment-service" },
        // missing detectionTimestamp in metadata
      });
      const record = createSQSRecord(message, "fail-msg-1");
      const event = createSQSEvent([record]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe("fail-msg-1");
    });

    it("should process incident with correlated deployments", async () => {
      const deployment = createDeploymentItem();
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Mock config query (no custom window)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Mock GSI-1 query returning one deployment
      mockSend.mockResolvedValueOnce({ Items: [deployment] });
      // Mock incident update
      mockSend.mockResolvedValueOnce({});
      // Mock deployment update
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      // Should have emitted EventBridge event
      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
    });

    it("should handle zero-correlation case (uncorrelated)", async () => {
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Mock config query (no custom window)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Mock GSI-1 query returning NO deployments
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Mock incident update (marking as uncorrelated)
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      // Should emit EventBridge event even for uncorrelated
      expect(mockEventBridgeSend).toHaveBeenCalledOnce();

      // Verify the update was called with "uncorrelated" status
      const updateCall = mockSend.mock.calls[2][0]; // Third call is incident update
      expect(updateCall.input.ExpressionAttributeValues[":status"]).toBe(
        "uncorrelated"
      );
      expect(
        updateCall.input.ExpressionAttributeValues[":deployments"]
      ).toEqual([]);
    });

    it("should process multiple records independently", async () => {
      const message1 = createIncidentMessage({ entityId: "inc-1" });
      const message2 = createIncidentMessage({
        entityId: "inc-2",
        metadata: {
          serviceId: "auth-service",
          severity: "critical",
          detectionTimestamp: "2024-01-15T11:00:00.000Z",
        },
      });

      const record1 = createSQSRecord(message1, "msg-1");
      const record2 = createSQSRecord(message2, "msg-2");
      const event = createSQSEvent([record1, record2]);

      // First record: success
      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: [] }); // deployments
      mockSend.mockResolvedValueOnce({}); // incident update

      // Second record: success
      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: [] }); // deployments
      mockSend.mockResolvedValueOnce({}); // incident update

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("getCorrelationWindow", () => {
    it("should return default 60 minutes when no config exists", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const window = await getCorrelationWindow("tenant-123");

      expect(window).toBe(60);
    });

    it("should return custom window from config", async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#tenant-123",
            SK: "SETTINGS#correlation_window",
            entityData: { windowMinutes: 120 },
          },
        ],
      });

      const window = await getCorrelationWindow("tenant-123");

      expect(window).toBe(120);
    });

    it("should return default if custom window is out of range (too small)", async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#tenant-123",
            SK: "SETTINGS#correlation_window",
            entityData: { windowMinutes: 2 }, // Below 5 minutes minimum
          },
        ],
      });

      const window = await getCorrelationWindow("tenant-123");

      expect(window).toBe(60);
    });

    it("should return default if custom window is out of range (too large)", async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#tenant-123",
            SK: "SETTINGS#correlation_window",
            entityData: { windowMinutes: 2000 }, // Above 1440 max
          },
        ],
      });

      const window = await getCorrelationWindow("tenant-123");

      expect(window).toBe(60);
    });

    it("should return default on DynamoDB error", async () => {
      mockSend.mockRejectedValueOnce(new Error("DynamoDB timeout"));

      const window = await getCorrelationWindow("tenant-123");

      expect(window).toBe(60);
    });
  });

  describe("queryDeploymentsInWindow", () => {
    it("should query GSI-1 with correct key conditions", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await queryDeploymentsInWindow(
        "tenant-123",
        "payment-service",
        "2024-01-15T10:00:00.000Z",
        60
      );

      expect(mockSend).toHaveBeenCalledOnce();
      const queryInput = mockSend.mock.calls[0][0].input;

      expect(queryInput.TableName).toBe("ollinai-events");
      expect(queryInput.IndexName).toBe("GSI1-CorrelationLookup");
      expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
        "TENANT#tenant-123#SVC#payment-service"
      );
      // Window start: 60 minutes before 10:00 = 09:00
      expect(queryInput.ExpressionAttributeValues[":skStart"]).toBe(
        "TS#2024-01-15T09:00:00.000Z"
      );
      expect(queryInput.ExpressionAttributeValues[":skEnd"]).toBe(
        "TS#2024-01-15T10:00:00.000Z"
      );
      // Most recent first
      expect(queryInput.ScanIndexForward).toBe(false);
    });

    it("should return empty array when no deployments found", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await queryDeploymentsInWindow(
        "tenant-123",
        "payment-service",
        "2024-01-15T10:00:00.000Z",
        60
      );

      expect(result).toEqual([]);
    });

    it("should return deployment items from GSI query", async () => {
      const deployment = createDeploymentItem();
      mockSend.mockResolvedValueOnce({ Items: [deployment] });

      const result = await queryDeploymentsInWindow(
        "tenant-123",
        "payment-service",
        "2024-01-15T10:00:00.000Z",
        60
      );

      expect(result).toHaveLength(1);
      expect(result[0].eventId).toBe("event-001");
    });
  });

  describe("rankByTemporalProximity", () => {
    it("should rank deployments by proximity (most recent first)", () => {
      const deployments: EventItem[] = [
        createDeploymentItem({
          eventId: "event-old",
          GSI1SK: "TS#2024-01-15T08:30:00.000Z",
          createdAt: "2024-01-15T08:30:00.000Z",
        }),
        createDeploymentItem({
          eventId: "event-recent",
          GSI1SK: "TS#2024-01-15T09:45:00.000Z",
          createdAt: "2024-01-15T09:45:00.000Z",
        }),
        createDeploymentItem({
          eventId: "event-mid",
          GSI1SK: "TS#2024-01-15T09:00:00.000Z",
          createdAt: "2024-01-15T09:00:00.000Z",
        }),
      ];

      const result = rankByTemporalProximity(
        deployments,
        "2024-01-15T10:00:00.000Z"
      );

      expect(result).toHaveLength(3);
      // Most recent (smallest gap) should be rank 1
      expect(result[0].eventId).toBe("event-recent");
      expect(result[0].rank).toBe(1);
      expect(result[0].temporalProximityMs).toBe(15 * 60 * 1000); // 15 minutes

      expect(result[1].eventId).toBe("event-mid");
      expect(result[1].rank).toBe(2);
      expect(result[1].temporalProximityMs).toBe(60 * 60 * 1000); // 60 minutes

      expect(result[2].eventId).toBe("event-old");
      expect(result[2].rank).toBe(3);
      expect(result[2].temporalProximityMs).toBe(90 * 60 * 1000); // 90 minutes
    });

    it("should return empty array for no deployments", () => {
      const result = rankByTemporalProximity(
        [],
        "2024-01-15T10:00:00.000Z"
      );

      expect(result).toEqual([]);
    });

    it("should handle single deployment correctly", () => {
      const deployments: EventItem[] = [
        createDeploymentItem({
          eventId: "event-single",
          GSI1SK: "TS#2024-01-15T09:50:00.000Z",
        }),
      ];

      const result = rankByTemporalProximity(
        deployments,
        "2024-01-15T10:00:00.000Z"
      );

      expect(result).toHaveLength(1);
      expect(result[0].eventId).toBe("event-single");
      expect(result[0].rank).toBe(1);
      expect(result[0].temporalProximityMs).toBe(10 * 60 * 1000); // 10 minutes
    });

    it("should handle deployments at the same timestamp", () => {
      const deployments: EventItem[] = [
        createDeploymentItem({
          eventId: "event-a",
          GSI1SK: "TS#2024-01-15T09:30:00.000Z",
        }),
        createDeploymentItem({
          eventId: "event-b",
          GSI1SK: "TS#2024-01-15T09:30:00.000Z",
        }),
      ];

      const result = rankByTemporalProximity(
        deployments,
        "2024-01-15T10:00:00.000Z"
      );

      expect(result).toHaveLength(2);
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
      // Both have same proximity
      expect(result[0].temporalProximityMs).toBe(result[1].temporalProximityMs);
    });
  });

  describe("EventBridge emission", () => {
    it("should emit correlation.created event with correct structure", async () => {
      const deployment = createDeploymentItem();
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Mock config query (no custom window)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Mock GSI-1 query returning one deployment
      mockSend.mockResolvedValueOnce({ Items: [deployment] });
      // Mock incident update
      mockSend.mockResolvedValueOnce({});
      // Mock deployment update
      mockSend.mockResolvedValueOnce({});

      await handler(event);

      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
      // PutEventsCommand is called with the entries object
      expect(MockPutEventsCommand).toHaveBeenCalledOnce();
      const putEventsArg = MockPutEventsCommand.mock.calls[0][0];
      const entry = putEventsArg.Entries[0];

      expect(entry.Source).toBe("ollinai.correlator");
      expect(entry.DetailType).toBe("correlation.created");
      expect(entry.EventBusName).toBe("ollinai-events-bus");

      const detail = JSON.parse(entry.Detail);
      expect(detail.tenantId).toBe("tenant-123");
      expect(detail.serviceId).toBe("payment-service");
      expect(detail.incidentId).toBe("incident-001");
      expect(detail.status).toBe("correlated");
      expect(detail.correlatedDeployments).toHaveLength(1);
      expect(detail.correlatedDeployments[0].eventId).toBe("event-001");
      expect(detail.correlatedDeployments[0].rank).toBe(1);
      expect(detail.correlatedAt).toBeDefined();
    });

    it("should emit event with uncorrelated status when no deployments match", async () => {
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: [] }); // deployments
      mockSend.mockResolvedValueOnce({}); // incident update

      await handler(event);

      expect(MockPutEventsCommand).toHaveBeenCalledOnce();
      const putEventsArg = MockPutEventsCommand.mock.calls[0][0];
      const detail = JSON.parse(putEventsArg.Entries[0].Detail);

      expect(detail.status).toBe("uncorrelated");
      expect(detail.correlatedDeployments).toEqual([]);
    });
  });

  describe("Incident update", () => {
    it("should update incident with correlated deployment IDs", async () => {
      const deployments = [
        createDeploymentItem({ eventId: "event-1", GSI1SK: "TS#2024-01-15T09:50:00.000Z" }),
        createDeploymentItem({ eventId: "event-2", GSI1SK: "TS#2024-01-15T09:30:00.000Z" }),
      ];
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: deployments }); // deployments
      mockSend.mockResolvedValueOnce({}); // incident update
      mockSend.mockResolvedValueOnce({}); // deployment 1 update
      mockSend.mockResolvedValueOnce({}); // deployment 2 update

      await handler(event);

      // Third call is the incident update
      const incidentUpdateCall = mockSend.mock.calls[2][0];
      const updateExpr = incidentUpdateCall.input;

      expect(updateExpr.Key.PK).toBe("TENANT#tenant-123#SVC#payment-service");
      expect(updateExpr.Key.SK).toBe("INC#2024-01-15T10:00:00.000Z#incident-001");
      expect(updateExpr.ExpressionAttributeValues[":status"]).toBe("correlated");
      // Ranked by proximity: event-1 (10 min gap) before event-2 (30 min gap)
      expect(updateExpr.ExpressionAttributeValues[":deployments"]).toEqual([
        "event-1",
        "event-2",
      ]);
    });
  });

  describe("Deployment event updates", () => {
    it("should append incidentId to each correlated deployment", async () => {
      const deployments = [
        createDeploymentItem({ eventId: "event-1", GSI1SK: "TS#2024-01-15T09:50:00.000Z" }),
      ];
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: deployments }); // deployments query
      mockSend.mockResolvedValueOnce({}); // incident update
      mockSend.mockResolvedValueOnce({}); // deployment update

      await handler(event);

      // Fourth call is the deployment update
      const deployUpdateCall = mockSend.mock.calls[3][0];
      const updateExpr = deployUpdateCall.input;

      expect(updateExpr.Key.PK).toBe("TENANT#tenant-123#SVC#payment-service");
      expect(updateExpr.UpdateExpression).toContain("list_append");
      expect(updateExpr.ExpressionAttributeValues[":incidentId"]).toEqual([
        "incident-001",
      ]);
    });

    it("should continue processing other deployments if one update fails", async () => {
      const deployments = [
        createDeploymentItem({
          eventId: "event-1",
          SK: "DEPLOY#2024-01-15T09:50:00.000Z#event-1",
          GSI1SK: "TS#2024-01-15T09:50:00.000Z",
        }),
        createDeploymentItem({
          eventId: "event-2",
          SK: "DEPLOY#2024-01-15T09:30:00.000Z#event-2",
          GSI1SK: "TS#2024-01-15T09:30:00.000Z",
        }),
      ];
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: deployments }); // deployments
      mockSend.mockResolvedValueOnce({}); // incident update
      mockSend.mockRejectedValueOnce(new Error("DDB error")); // first deployment fails
      mockSend.mockResolvedValueOnce({}); // second deployment succeeds

      const result = await handler(event);

      // Handler should still succeed (deployment update errors are non-fatal)
      expect(result.batchItemFailures).toHaveLength(0);
      // Should still emit EventBridge event
      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
    });
  });

  describe("Custom correlation window", () => {
    it("should use custom window when querying deployments", async () => {
      const message = createIncidentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Return custom 30-minute window
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#tenant-123",
            SK: "SETTINGS#correlation_window",
            entityData: { windowMinutes: 30 },
          },
        ],
      });
      // Empty deployments
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Incident update
      mockSend.mockResolvedValueOnce({});

      await handler(event);

      // Verify the GSI query uses the 30-minute window
      const gsiQuery = mockSend.mock.calls[1][0].input;
      // Window start: 30 minutes before 10:00 = 09:30
      expect(gsiQuery.ExpressionAttributeValues[":skStart"]).toBe(
        "TS#2024-01-15T09:30:00.000Z"
      );
    });
  });
});
