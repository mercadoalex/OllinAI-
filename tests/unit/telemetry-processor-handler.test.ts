/**
 * Unit tests for the Telemetry Processing Lambda Handler.
 *
 * Tests cover:
 * - Anomaly signal extraction from telemetry metadata
 * - Canary result extraction
 * - Risk score escalation/reduction logic
 * - Incorporation of eBPF signals as Risk_Factors
 * - Canary healthy result (reduce risk by one level)
 * - Canary early warning (escalate to critical)
 * - Deployment event lookup
 * - Handler batch processing
 *
 * Requirements: 13.11, 14.4, 14.5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SQSEvent, SQSRecord } from "aws-lambda";

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
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

import {
  handler,
  extractAnomalySignals,
  extractCanaryResult,
  reduceRiskByOneLevel,
  escalateToCritical,
  parseRiskLevel,
  findRecentDeployment,
  incorporateAnomalySignals,
  handleCanaryResult,
  type RiskLevel,
} from "@/lambdas/telemetry-processor/handler";
import type { SqsEventMessage } from "@/lib/sqs/client";

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
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789:agent-telemetry",
    awsRegion: "us-east-1",
  };
}

function createTelemetryMessage(
  overrides?: Partial<SqsEventMessage>
): SqsEventMessage {
  return {
    eventType: "telemetry.batch",
    entityId: "batch-001",
    tenantId: "tenant-123",
    producedAt: "2024-01-15T10:00:00.000Z",
    metadata: {
      serviceId: "payment-service",
      pipelineId: "pipeline-abc",
      eventCount: "10",
      droppedCount: "0",
      agentVersion: "0.1.0",
      degradedMode: "false",
    },
    ...overrides,
  };
}

function createDeploymentRecord() {
  return {
    PK: "TENANT#tenant-123#SVC#payment-service",
    SK: "DEPLOY#2024-01-15T09:50:00.000Z#event-001",
    eventId: "event-001",
    riskScore: "high",
    riskFactors: {
      changeFailureRate: 0.4,
      changeSize: 0.3,
      deploymentTiming: 0.2,
      authorFailureRate: 0.1,
    },
    createdAt: "2024-01-15T09:50:00.000Z",
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Telemetry Processor Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Risk Level Utilities", () => {
    describe("reduceRiskByOneLevel", () => {
      it("should reduce critical to high", () => {
        expect(reduceRiskByOneLevel("critical")).toBe("high");
      });

      it("should reduce high to medium", () => {
        expect(reduceRiskByOneLevel("high")).toBe("medium");
      });

      it("should reduce medium to low", () => {
        expect(reduceRiskByOneLevel("medium")).toBe("low");
      });

      it("should keep low as low (minimum)", () => {
        expect(reduceRiskByOneLevel("low")).toBe("low");
      });
    });

    describe("escalateToCritical", () => {
      it("should always return critical", () => {
        expect(escalateToCritical()).toBe("critical");
      });
    });

    describe("parseRiskLevel", () => {
      it("should parse valid risk levels", () => {
        expect(parseRiskLevel("low")).toBe("low");
        expect(parseRiskLevel("medium")).toBe("medium");
        expect(parseRiskLevel("high")).toBe("high");
        expect(parseRiskLevel("critical")).toBe("critical");
      });

      it("should default to medium for invalid values", () => {
        expect(parseRiskLevel(undefined)).toBe("medium");
        expect(parseRiskLevel("invalid")).toBe("medium");
        expect(parseRiskLevel("")).toBe("medium");
      });
    });
  });

  describe("extractAnomalySignals", () => {
    it("should return empty array when no anomaly flags", () => {
      const message = createTelemetryMessage();
      const signals = extractAnomalySignals(message);
      expect(signals).toHaveLength(0);
    });

    it("should detect supply chain anomaly", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "svc",
          supplyChainAnomaly: "true",
        },
      });
      const signals = extractAnomalySignals(message);
      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe("supply_chain");
      expect(signals[0].severity).toBe("critical");
    });

    it("should detect resource anomaly", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "svc",
          resourceAnomaly: "true",
        },
      });
      const signals = extractAnomalySignals(message);
      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe("resource");
      expect(signals[0].severity).toBe("high");
    });

    it("should detect network anomaly", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "svc",
          networkAnomaly: "true",
        },
      });
      const signals = extractAnomalySignals(message);
      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe("network");
      expect(signals[0].severity).toBe("high");
    });

    it("should detect kernel error", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "svc",
          kernelError: "true",
          kernelErrorType: "oom_kill",
        },
      });
      const signals = extractAnomalySignals(message);
      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe("kernel_error");
      expect(signals[0].severity).toBe("critical");
    });

    it("should detect multiple anomalies simultaneously", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "svc",
          supplyChainAnomaly: "true",
          resourceAnomaly: "true",
          networkAnomaly: "true",
        },
      });
      const signals = extractAnomalySignals(message);
      expect(signals).toHaveLength(3);
    });
  });

  describe("extractCanaryResult", () => {
    it("should return null when no canary result", () => {
      const message = createTelemetryMessage();
      const result = extractCanaryResult(message);
      expect(result).toBeNull();
    });

    it("should extract healthy canary result", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "payment-service",
          canaryResult: "healthy",
        },
      });
      const result = extractCanaryResult(message);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("canary_healthy");
    });

    it("should extract deviation canary result", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "payment-service",
          canaryResult: "deviation",
          deviationPercent: "45.2",
        },
      });
      const result = extractCanaryResult(message);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("canary_deviation");
      expect(result!.deviation_percent).toBeCloseTo(45.2);
    });

    it("should extract early warning canary result", () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "payment-service",
          canaryResult: "early_warning",
        },
      });
      const result = extractCanaryResult(message);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("canary_early_warning");
    });
  });

  describe("handler", () => {
    it("should skip non-telemetry.batch events", async () => {
      const message = createTelemetryMessage({ eventType: "deployment.created" });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should report batch failure when serviceId is missing", async () => {
      const message = createTelemetryMessage({
        metadata: {}, // no serviceId
      });
      const record = createSQSRecord(message, "fail-msg");
      const event = createSQSEvent([record]);

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe("fail-msg");
    });

    it("should process successfully when no recent deployment found", async () => {
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "new-service",
          supplyChainAnomaly: "true",
        },
      });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // No recent deployment found
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);
    });

    it("should incorporate anomaly signals into deployment risk score", async () => {
      const deployment = createDeploymentRecord();
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "payment-service",
          supplyChainAnomaly: "true",
        },
      });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Return deployment
      mockSend.mockResolvedValueOnce({ Items: [deployment] });
      // Update command
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);

      // Verify the update was called to escalate risk
      expect(mockSend).toHaveBeenCalledTimes(2);
      const updateInput = mockSend.mock.calls[1][0].input;
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("critical");
      expect(updateInput.ExpressionAttributeValues[":supplyChain"]).toBe(1.0);
    });

    it("should apply healthy canary result (reduce risk by one level)", async () => {
      const deployment = createDeploymentRecord(); // riskScore: "high"
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "payment-service",
          canaryResult: "healthy",
        },
      });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Return deployment
      mockSend.mockResolvedValueOnce({ Items: [deployment] });
      // Update command
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);

      // Verify risk was reduced from "high" to "medium"
      const updateInput = mockSend.mock.calls[1][0].input;
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("medium");
      expect(updateInput.ExpressionAttributeValues[":canaryResult"]).toBe("canary_healthy");
    });

    it("should escalate risk to critical on early warning", async () => {
      const deployment = createDeploymentRecord(); // riskScore: "high"
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "payment-service",
          canaryResult: "early_warning",
        },
      });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Return deployment
      mockSend.mockResolvedValueOnce({ Items: [deployment] });
      // Update command
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);

      // Verify risk was escalated to critical
      const updateInput = mockSend.mock.calls[1][0].input;
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("critical");
    });

    it("should handle both anomalies and canary result in same batch", async () => {
      const deployment = createDeploymentRecord();
      const message = createTelemetryMessage({
        metadata: {
          serviceId: "payment-service",
          resourceAnomaly: "true",
          canaryResult: "early_warning",
        },
      });
      const record = createSQSRecord(message);
      const event = createSQSEvent([record]);

      // Return deployment
      mockSend.mockResolvedValueOnce({ Items: [deployment] });
      // Anomaly update
      mockSend.mockResolvedValueOnce({});
      // Canary update
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);
      // Two updates: one for anomaly signals, one for canary result
      expect(mockSend).toHaveBeenCalledTimes(3);
    });
  });

  describe("findRecentDeployment", () => {
    it("should return null when no deployments exist", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await findRecentDeployment("tenant-123", "new-service");
      expect(result).toBeNull();
    });

    it("should return the most recent deployment", async () => {
      const deployment = createDeploymentRecord();
      mockSend.mockResolvedValueOnce({ Items: [deployment] });

      const result = await findRecentDeployment("tenant-123", "payment-service");
      expect(result).not.toBeNull();
      expect(result!.eventId).toBe("event-001");
    });

    it("should query with correct partition key and sort direction", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await findRecentDeployment("tenant-123", "payment-service");

      const queryInput = mockSend.mock.calls[0][0].input;
      expect(queryInput.KeyConditionExpression).toContain("PK = :pk");
      expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
        "TENANT#tenant-123#SVC#payment-service"
      );
      expect(queryInput.ScanIndexForward).toBe(false); // Most recent first
      expect(queryInput.Limit).toBe(1);
    });
  });

  describe("incorporateAnomalySignals", () => {
    it("should update deployment with supply chain anomaly factor", async () => {
      const deployment = createDeploymentRecord();
      mockSend.mockResolvedValueOnce({});

      await incorporateAnomalySignals(
        "tenant-123",
        "payment-service",
        deployment,
        [{ type: "supply_chain", severity: "critical", detail: {} }]
      );

      const updateInput = mockSend.mock.calls[0][0].input;
      expect(updateInput.ExpressionAttributeValues[":supplyChain"]).toBe(1.0);
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("critical");
    });

    it("should not escalate to critical for non-critical anomalies", async () => {
      const deployment = createDeploymentRecord();
      mockSend.mockResolvedValueOnce({});

      await incorporateAnomalySignals(
        "tenant-123",
        "payment-service",
        deployment,
        [{ type: "resource", severity: "high", detail: {} }]
      );

      const updateInput = mockSend.mock.calls[0][0].input;
      // Should keep existing risk score (high) since anomaly is not critical
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("high");
      expect(updateInput.ExpressionAttributeValues[":resource"]).toBe(0.8);
    });
  });

  describe("handleCanaryResult", () => {
    it("should reduce risk by one level on healthy canary", async () => {
      const deployment = createDeploymentRecord(); // high
      mockSend.mockResolvedValueOnce({});

      await handleCanaryResult(
        "tenant-123",
        "payment-service",
        deployment,
        { type: "canary_healthy", service_id: "payment-service" }
      );

      const updateInput = mockSend.mock.calls[0][0].input;
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("medium");
    });

    it("should escalate to critical on early warning", async () => {
      const deployment = { ...createDeploymentRecord(), riskScore: "low" };
      mockSend.mockResolvedValueOnce({});

      await handleCanaryResult(
        "tenant-123",
        "payment-service",
        deployment,
        { type: "canary_early_warning", service_id: "payment-service" }
      );

      const updateInput = mockSend.mock.calls[0][0].input;
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("critical");
    });

    it("should keep current risk on deviation (no automatic escalation)", async () => {
      const deployment = createDeploymentRecord(); // high
      mockSend.mockResolvedValueOnce({});

      await handleCanaryResult(
        "tenant-123",
        "payment-service",
        deployment,
        { type: "canary_deviation", service_id: "payment-service", deviation_percent: 45 }
      );

      const updateInput = mockSend.mock.calls[0][0].input;
      expect(updateInput.ExpressionAttributeValues[":riskScore"]).toBe("high");
    });
  });
});
