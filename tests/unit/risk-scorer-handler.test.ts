/**
 * Unit tests for the Risk Scoring Engine Lambda Handler.
 *
 * Tests cover:
 * - Risk weight reading (default and custom)
 * - Weight validation
 * - Risk factor computation (CFR, change size, timing, author rate)
 * - Weighted score computation
 * - Risk classification
 * - Org-wide baseline fallback (<10 historical deployments)
 * - Indeterminate risk on computation failure
 * - EventBridge event emission
 * - Batch item failure handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SQSEvent, SQSRecord } from "aws-lambda";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

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

// Mock EventBridge
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
  EVENT_SOURCES: { RISK_SCORER: "ollinai.risk-scorer" },
  EVENT_DETAIL_TYPES: { RISK_SCORE_COMPUTED: "risk-score.computed" },
}));

import {
  handler,
  getRiskWeights,
  isValidWeights,
  computeChangeFailureRate,
  computeChangeSizeFactor,
  computeDeploymentTimingFactor,
  computeAuthorFailureRate,
  computeWeightedScore,
  classifyRisk,
  normalizeWithThreshold,
  queryHistoricalDeployments,
  DEFAULT_WEIGHTS,
  resetClients,
  setEventBridgeClient,
} from "@/lambdas/risk-scorer/handler";
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
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789:ollinai-deployment-events",
    awsRegion: "us-east-1",
  };
}

function createDeploymentMessage(overrides?: Partial<{
  eventType: string;
  entityId: string;
  tenantId: string;
  metadata: Record<string, string>;
}>) {
  return {
    eventType: "deployment.created",
    entityId: "event-001",
    tenantId: "tenant-123",
    producedAt: "2024-01-15T10:00:00.000Z",
    metadata: {
      serviceId: "payment-service",
      author: "dev@example.com",
      deploymentTimestamp: "2024-01-15T10:00:00.000Z",
      filesChanged: "10",
      linesAdded: "200",
      linesRemoved: "50",
    },
    ...overrides,
  };
}

function createHistoricalDeployment(overrides?: Partial<EventItem>): EventItem {
  return {
    PK: "TENANT#tenant-123#SVC#payment-service",
    SK: "DEPLOY#2024-01-10T09:00:00.000Z#event-hist-001",
    eventId: "event-hist-001",
    commitShas: ["abc123"],
    author: "dev@example.com",
    services: ["payment-service"],
    environment: "production",
    teamId: "team-alpha",
    createdAt: "2024-01-10T09:00:00.000Z",
    ...overrides,
  };
}

function createHistoricalDeployments(count: number, withIncidents = 0): EventItem[] {
  const deployments: EventItem[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date("2024-01-01T10:00:00.000Z");
    date.setDate(date.getDate() + i);
    deployments.push(
      createHistoricalDeployment({
        eventId: `event-hist-${i}`,
        SK: `DEPLOY#${date.toISOString()}#event-hist-${i}`,
        createdAt: date.toISOString(),
        correlatedIncidents: i < withIncidents ? [`inc-${i}`] : undefined,
      })
    );
  }
  return deployments;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Risk Scorer Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClients();
    mockEventBridgeSend.mockResolvedValue({});
    setEventBridgeClient({
      send: mockEventBridgeSend,
    } as unknown as import("@aws-sdk/client-eventbridge").EventBridgeClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handler", () => {
    it("should skip non-deployment.created events", async () => {
      const message = createDeploymentMessage({ eventType: "incident.created" });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should return batchItemFailure when missing metadata", async () => {
      const message = createDeploymentMessage({
        metadata: { serviceId: "payment-service" },
        // missing author and deploymentTimestamp
      });
      const record = createSQSRecord(message, "fail-msg-1");
      const event = createSQSEvent([record]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe("fail-msg-1");
    });

    it("should process deployment and compute risk score", async () => {
      const historicalDeployments = createHistoricalDeployments(15, 3);
      const message = createDeploymentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Mock config query (no custom weights)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Mock historical deployments query (service has 15 deployments)
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments });
      // Mock update event with risk score
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
    });

    it("should mark as indeterminate on computation failure and emit failure event", async () => {
      const message = createDeploymentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Mock config query (no custom weights)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Mock historical query failure
      mockSend.mockRejectedValueOnce(new Error("DynamoDB timeout"));
      // Mock update event with indeterminate score
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);

      // Should not be in batchItemFailures - we handle the error gracefully
      expect(result.batchItemFailures).toHaveLength(0);
      // Should have called update with "indeterminate"
      const updateCall = mockSend.mock.calls[2][0];
      expect(updateCall.input.ExpressionAttributeValues[":riskScore"]).toBe(
        "indeterminate"
      );
      // Should emit failure event
      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
    });

    it("should fall back to org-wide baseline when <10 historical deployments", async () => {
      const fewDeployments = createHistoricalDeployments(5);
      const orgWideDeployments = createHistoricalDeployments(20, 4);
      const message = createDeploymentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Mock config query (no custom weights)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Mock service historical query (only 5 deployments)
      mockSend.mockResolvedValueOnce({ Items: fewDeployments });
      // Mock org-wide baseline query
      mockSend.mockResolvedValueOnce({ Items: orgWideDeployments });
      // Mock update event
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      // Should have made 4 DynamoDB calls: config, service history, org-wide, update
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it("should process multiple records independently", async () => {
      const historicalDeployments = createHistoricalDeployments(15);
      const message1 = createDeploymentMessage({ entityId: "event-1" });
      const message2 = createDeploymentMessage({ entityId: "event-2" });

      const record1 = createSQSRecord(message1, "msg-1");
      const record2 = createSQSRecord(message2, "msg-2");
      const event = createSQSEvent([record1, record2]);

      // First record
      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments }); // history
      mockSend.mockResolvedValueOnce({}); // update

      // Second record
      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments }); // history
      mockSend.mockResolvedValueOnce({}); // update

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("getRiskWeights", () => {
    it("should return default weights when no config exists", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const weights = await getRiskWeights("tenant-123");

      expect(weights).toEqual(DEFAULT_WEIGHTS);
    });

    it("should return custom weights from config", async () => {
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

      const weights = await getRiskWeights("tenant-123");

      expect(weights.changeFailureRate).toBe(0.4);
      expect(weights.changeSize).toBe(0.3);
      expect(weights.deploymentTiming).toBe(0.15);
      expect(weights.authorFailureRate).toBe(0.15);
    });

    it("should return defaults if custom weights are invalid (don't sum to 1)", async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#tenant-123",
            SK: "SETTINGS#risk_weights",
            entityData: {
              changeFailureRate: 0.5,
              changeSize: 0.5,
              deploymentTiming: 0.5,
              authorFailureRate: 0.5,
            },
          },
        ],
      });

      const weights = await getRiskWeights("tenant-123");

      expect(weights).toEqual(DEFAULT_WEIGHTS);
    });

    it("should return defaults on DynamoDB error", async () => {
      mockSend.mockRejectedValueOnce(new Error("DynamoDB timeout"));

      const weights = await getRiskWeights("tenant-123");

      expect(weights).toEqual(DEFAULT_WEIGHTS);
    });
  });

  describe("isValidWeights", () => {
    it("should return true for valid weights summing to 1.0", () => {
      expect(
        isValidWeights({
          changeFailureRate: 0.35,
          changeSize: 0.25,
          deploymentTiming: 0.2,
          authorFailureRate: 0.2,
        })
      ).toBe(true);
    });

    it("should return false when weights don't sum to 1.0", () => {
      expect(
        isValidWeights({
          changeFailureRate: 0.5,
          changeSize: 0.3,
          deploymentTiming: 0.3,
          authorFailureRate: 0.2,
        })
      ).toBe(false);
    });

    it("should return false when any weight is negative", () => {
      expect(
        isValidWeights({
          changeFailureRate: -0.1,
          changeSize: 0.5,
          deploymentTiming: 0.3,
          authorFailureRate: 0.3,
        })
      ).toBe(false);
    });

    it("should return false when any weight exceeds 1", () => {
      expect(
        isValidWeights({
          changeFailureRate: 1.5,
          changeSize: -0.2,
          deploymentTiming: -0.2,
          authorFailureRate: -0.1,
        })
      ).toBe(false);
    });

    it("should return false when missing fields", () => {
      expect(
        isValidWeights({
          changeFailureRate: 0.5,
          changeSize: 0.5,
        })
      ).toBe(false);
    });

    it("should allow floating point tolerance", () => {
      expect(
        isValidWeights({
          changeFailureRate: 0.333,
          changeSize: 0.333,
          deploymentTiming: 0.167,
          authorFailureRate: 0.167,
        })
      ).toBe(true);
    });
  });

  describe("computeChangeFailureRate", () => {
    it("should return 0 for empty deployments", () => {
      expect(computeChangeFailureRate([])).toBe(0);
    });

    it("should return 0 when no deployments have incidents", () => {
      const deployments = createHistoricalDeployments(10, 0);
      expect(computeChangeFailureRate(deployments)).toBe(0);
    });

    it("should correctly compute CFR", () => {
      const deployments = createHistoricalDeployments(10, 3);
      expect(computeChangeFailureRate(deployments)).toBe(0.3);
    });

    it("should return 1.0 when all deployments have incidents", () => {
      const deployments = createHistoricalDeployments(5, 5);
      expect(computeChangeFailureRate(deployments)).toBe(1.0);
    });
  });

  describe("computeChangeSizeFactor", () => {
    it("should return 0 for zero changes", () => {
      expect(
        computeChangeSizeFactor({ filesChanged: 0, linesAdded: 0, linesRemoved: 0 })
      ).toBe(0);
    });

    it("should return low score for small changes", () => {
      const score = computeChangeSizeFactor({
        filesChanged: 2,
        linesAdded: 20,
        linesRemoved: 5,
      });
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.3);
    });

    it("should return medium score for moderate changes", () => {
      const score = computeChangeSizeFactor({
        filesChanged: 15,
        linesAdded: 200,
        linesRemoved: 100,
      });
      expect(score).toBeGreaterThan(0.3);
      expect(score).toBeLessThan(0.8);
    });

    it("should return high score for large changes", () => {
      const score = computeChangeSizeFactor({
        filesChanged: 100,
        linesAdded: 2000,
        linesRemoved: 500,
      });
      expect(score).toBeGreaterThan(0.7);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it("should not exceed 1.0", () => {
      const score = computeChangeSizeFactor({
        filesChanged: 1000,
        linesAdded: 100000,
        linesRemoved: 50000,
      });
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe("normalizeWithThreshold", () => {
    it("should return 0 for zero or negative value", () => {
      expect(normalizeWithThreshold(0, 5, 50)).toBe(0);
      expect(normalizeWithThreshold(-1, 5, 50)).toBe(0);
    });

    it("should return low values for inputs below low threshold", () => {
      const result = normalizeWithThreshold(3, 5, 50);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(0.3);
    });

    it("should return values in [0.3, 0.8] for inputs between thresholds", () => {
      const result = normalizeWithThreshold(25, 5, 50);
      expect(result).toBeGreaterThanOrEqual(0.3);
      expect(result).toBeLessThanOrEqual(0.8);
    });

    it("should return high values for inputs above high threshold", () => {
      const result = normalizeWithThreshold(100, 5, 50);
      expect(result).toBeGreaterThan(0.8);
      expect(result).toBeLessThanOrEqual(1.0);
    });
  });

  describe("computeDeploymentTimingFactor", () => {
    it("should return 0.5 (neutral) for empty history", () => {
      expect(computeDeploymentTimingFactor([], "2024-01-15T10:00:00.000Z")).toBe(
        0.5
      );
    });

    it("should return 0 when no historical failures at deploy time", () => {
      // All deployments at hour 10 with no incidents
      const deployments = createHistoricalDeployments(5, 0).map((d, i) => ({
        ...d,
        createdAt: `2024-01-${10 + i}T10:00:00.000Z`, // same hour (10), different days
      }));

      const result = computeDeploymentTimingFactor(
        deployments,
        "2024-01-15T10:00:00.000Z" // deploying at hour 10
      );
      expect(result).toBe(0);
    });

    it("should return high score when deploying at historically risky time", () => {
      // Create deployments at hour 14, all with incidents
      const deployments: EventItem[] = [];
      for (let i = 0; i < 5; i++) {
        deployments.push(
          createHistoricalDeployment({
            eventId: `evt-${i}`,
            createdAt: `2024-01-${10 + i}T14:00:00.000Z`,
            correlatedIncidents: [`inc-${i}`],
          })
        );
      }

      const result = computeDeploymentTimingFactor(
        deployments,
        "2024-01-15T14:00:00.000Z" // deploying at risky hour 14
      );
      expect(result).toBeGreaterThan(0);
    });

    it("should not exceed 1.0", () => {
      // All deployments at same time with incidents
      const deployments: EventItem[] = [];
      for (let i = 0; i < 10; i++) {
        deployments.push(
          createHistoricalDeployment({
            eventId: `evt-${i}`,
            createdAt: "2024-01-15T14:00:00.000Z",
            correlatedIncidents: [`inc-${i}`],
          })
        );
      }

      const result = computeDeploymentTimingFactor(
        deployments,
        "2024-01-15T14:00:00.000Z"
      );
      expect(result).toBeLessThanOrEqual(1.0);
    });
  });

  describe("computeAuthorFailureRate", () => {
    it("should return 0 when author has no deployments in history", () => {
      const deployments = createHistoricalDeployments(10, 5).map((d) => ({
        ...d,
        author: "other@example.com",
      }));

      expect(computeAuthorFailureRate(deployments, "dev@example.com")).toBe(0);
    });

    it("should return 0 when author has no failures", () => {
      const deployments = createHistoricalDeployments(5, 0);

      expect(computeAuthorFailureRate(deployments, "dev@example.com")).toBe(0);
    });

    it("should correctly compute author failure rate", () => {
      const deployments: EventItem[] = [
        createHistoricalDeployment({
          eventId: "e1",
          author: "dev@example.com",
          correlatedIncidents: ["inc-1"],
        }),
        createHistoricalDeployment({
          eventId: "e2",
          author: "dev@example.com",
          correlatedIncidents: undefined,
        }),
        createHistoricalDeployment({
          eventId: "e3",
          author: "dev@example.com",
          correlatedIncidents: undefined,
        }),
        createHistoricalDeployment({
          eventId: "e4",
          author: "other@example.com",
          correlatedIncidents: ["inc-2"],
        }),
      ];

      // dev@example.com: 1 failure out of 3 = 0.333...
      const rate = computeAuthorFailureRate(deployments, "dev@example.com");
      expect(rate).toBeCloseTo(1 / 3, 5);
    });

    it("should return 1.0 when all author deployments have failures", () => {
      const deployments: EventItem[] = [
        createHistoricalDeployment({
          eventId: "e1",
          author: "dev@example.com",
          correlatedIncidents: ["inc-1"],
        }),
        createHistoricalDeployment({
          eventId: "e2",
          author: "dev@example.com",
          correlatedIncidents: ["inc-2"],
        }),
      ];

      expect(computeAuthorFailureRate(deployments, "dev@example.com")).toBe(1.0);
    });
  });

  describe("computeWeightedScore", () => {
    it("should compute correct weighted sum", () => {
      const factors = {
        changeFailureRate: 0.5,
        changeSize: 0.3,
        deploymentTiming: 0.2,
        authorFailureRate: 0.4,
      };
      const weights = DEFAULT_WEIGHTS;

      // 0.5*0.35 + 0.3*0.25 + 0.2*0.20 + 0.4*0.20
      // = 0.175 + 0.075 + 0.04 + 0.08 = 0.37
      const score = computeWeightedScore(factors, weights);
      expect(score).toBeCloseTo(0.37, 5);
    });

    it("should clamp score to [0, 1]", () => {
      const factors = {
        changeFailureRate: 1.0,
        changeSize: 1.0,
        deploymentTiming: 1.0,
        authorFailureRate: 1.0,
      };

      const score = computeWeightedScore(factors, DEFAULT_WEIGHTS);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it("should return 0 when all factors are 0", () => {
      const factors = {
        changeFailureRate: 0,
        changeSize: 0,
        deploymentTiming: 0,
        authorFailureRate: 0,
      };

      expect(computeWeightedScore(factors, DEFAULT_WEIGHTS)).toBe(0);
    });

    it("should respect custom weights", () => {
      const factors = {
        changeFailureRate: 1.0,
        changeSize: 0,
        deploymentTiming: 0,
        authorFailureRate: 0,
      };

      const customWeights = {
        changeFailureRate: 0.6,
        changeSize: 0.2,
        deploymentTiming: 0.1,
        authorFailureRate: 0.1,
      };

      const score = computeWeightedScore(factors, customWeights);
      expect(score).toBeCloseTo(0.6, 5);
    });
  });

  describe("classifyRisk", () => {
    it("should classify 0 as low", () => {
      expect(classifyRisk(0)).toBe("low");
    });

    it("should classify 0.29 as low", () => {
      expect(classifyRisk(0.29)).toBe("low");
    });

    it("should classify 0.3 as medium", () => {
      expect(classifyRisk(0.3)).toBe("medium");
    });

    it("should classify 0.54 as medium", () => {
      expect(classifyRisk(0.54)).toBe("medium");
    });

    it("should classify 0.55 as high", () => {
      expect(classifyRisk(0.55)).toBe("high");
    });

    it("should classify 0.79 as high", () => {
      expect(classifyRisk(0.79)).toBe("high");
    });

    it("should classify 0.8 as critical", () => {
      expect(classifyRisk(0.8)).toBe("critical");
    });

    it("should classify 1.0 as critical", () => {
      expect(classifyRisk(1.0)).toBe("critical");
    });
  });

  describe("queryHistoricalDeployments", () => {
    it("should query with correct key conditions and 90-day lookback", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await queryHistoricalDeployments(
        "tenant-123",
        "payment-service",
        "2023-10-17T10:00:00.000Z",
        "2024-01-15T10:00:00.000Z"
      );

      expect(mockSend).toHaveBeenCalledOnce();
      const queryInput = mockSend.mock.calls[0][0].input;

      expect(queryInput.TableName).toBe("ollinai-events");
      expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
        "TENANT#tenant-123#SVC#payment-service"
      );
      expect(queryInput.ExpressionAttributeValues[":skStart"]).toBe(
        "DEPLOY#2023-10-17T10:00:00.000Z"
      );
      expect(queryInput.ExpressionAttributeValues[":skEnd"]).toBe(
        "DEPLOY#2024-01-15T10:00:00.000Z"
      );
    });

    it("should return empty array when no deployments found", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await queryHistoricalDeployments(
        "tenant-123",
        "payment-service",
        "2023-10-17T10:00:00.000Z",
        "2024-01-15T10:00:00.000Z"
      );

      expect(result).toEqual([]);
    });
  });

  describe("EventBridge emission", () => {
    it("should emit risk-score.computed event with correct structure", async () => {
      const historicalDeployments = createHistoricalDeployments(15, 3);
      const message = createDeploymentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments }); // history
      mockSend.mockResolvedValueOnce({}); // update

      await handler(event);

      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
      expect(MockPutEventsCommand).toHaveBeenCalledOnce();
      const putEventsArg = MockPutEventsCommand.mock.calls[0][0];
      const entry = putEventsArg.Entries[0];

      expect(entry.Source).toBe("ollinai.risk-scorer");
      expect(entry.DetailType).toBe("risk-score.computed");
      expect(entry.EventBusName).toBe("ollinai-events-bus");

      const detail = JSON.parse(entry.Detail);
      expect(detail.tenantId).toBe("tenant-123");
      expect(detail.serviceId).toBe("payment-service");
      expect(detail.eventId).toBe("event-001");
      expect(detail.riskScore).toBeDefined();
      expect(detail.factors).toBeDefined();
      expect(detail.weights).toBeDefined();
      expect(detail.computedAt).toBeDefined();
    });

    it("should emit failure event when computation fails", async () => {
      const message = createDeploymentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockRejectedValueOnce(new Error("DDB error")); // history fails
      mockSend.mockResolvedValueOnce({}); // update indeterminate

      await handler(event);

      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
      const putEventsArg = MockPutEventsCommand.mock.calls[0][0];
      const entry = putEventsArg.Entries[0];
      expect(entry.DetailType).toBe("risk-score.computation-failed");

      const detail = JSON.parse(entry.Detail);
      expect(detail.error).toBe("DDB error");
    });
  });

  describe("DynamoDB update", () => {
    it("should update event record with risk score and factors", async () => {
      const historicalDeployments = createHistoricalDeployments(15, 3);
      const message = createDeploymentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockResolvedValueOnce({ Items: historicalDeployments }); // history
      mockSend.mockResolvedValueOnce({}); // update

      await handler(event);

      // Third DynamoDB call is the update
      const updateCall = mockSend.mock.calls[2][0];
      const updateInput = updateCall.input;

      expect(updateInput.TableName).toBe("ollinai-events");
      expect(updateInput.Key.PK).toBe("TENANT#tenant-123#SVC#payment-service");
      expect(updateInput.Key.SK).toBe(
        "DEPLOY#2024-01-15T10:00:00.000Z#event-001"
      );
      expect(updateInput.UpdateExpression).toContain("riskScore");
      expect(updateInput.UpdateExpression).toContain("riskFactors");
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBeDefined();
      expect(updateInput.ExpressionAttributeValues[":riskFactors"]).toBeDefined();
    });

    it("should update with indeterminate and no factors on failure", async () => {
      const message = createDeploymentMessage();
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      mockSend.mockResolvedValueOnce({ Items: [] }); // config
      mockSend.mockRejectedValueOnce(new Error("DDB error")); // history fails
      mockSend.mockResolvedValueOnce({}); // update indeterminate

      await handler(event);

      const updateCall = mockSend.mock.calls[2][0];
      const updateInput = updateCall.input;

      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe(
        "indeterminate"
      );
      expect(updateInput.UpdateExpression).not.toContain("riskFactors");
    });
  });
});
