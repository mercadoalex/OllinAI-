/**
 * Unit tests for the Collector API endpoint (POST /api/collector/telemetry).
 *
 * Tests cover:
 * - Authentication validation (agent token/integration key)
 * - Telemetry batch validation (max 500 events, required fields)
 * - Build_Attestation document acceptance
 * - SQS queue persistence
 * - DynamoDB attestation persistence
 * - Error handling
 *
 * Requirements: 13.9, 13.6, 13.7
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSend, mockSendMessage } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockSendMessage: vi.fn().mockResolvedValue("msg-id-123"),
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

vi.mock("@/lib/sqs/client", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantServiceKey: (tenantId: string, serviceId: string) =>
    `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

vi.mock("uuid", () => ({
  v4: () => "test-uuid-1234",
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomUUID: () => "test-uuid-1234",
  };
});

import {
  POST,
} from "@/app/api/collector/telemetry/route";
import { validateAgentToken } from "@/lib/collector/auth";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createRequest(
  body: unknown,
  authHeader?: string
): NextRequest {
  const request = new NextRequest("http://localhost/api/collector/telemetry", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
  return request;
}

function createValidBatch(overrides?: Record<string, unknown>) {
  return {
    batch_id: "batch-001",
    tenant_id: "tenant-123",
    service_id: "payment-service",
    pipeline_id: "pipeline-abc",
    events: [
      { type: "process_tree", pid: 1, ppid: 0, comm: "bash" },
      { type: "network_connect", pid: 2, dest_addr: "10.0.0.1", dest_port: 443 },
    ],
    dropped_event_count: 0,
    agent_version: "0.1.0",
    kernel_version: "5.15.0",
    arch: "x86_64",
    degraded_mode: false,
    created_at_ns: 1700000000000000000,
    ...overrides,
  };
}

function createValidAttestation() {
  return {
    attestation_json: JSON.stringify({
      _type: "https://in-toto.io/Statement/v1",
      pipeline_id: "pipeline-abc",
      tenant_id: "tenant-123",
      service_id: "payment-service",
      process_ancestry: { processes: { "1": {}, "2": {} } },
      network_connections: [{ pid: 2, dest_port: 443 }],
      sensitive_file_writes: [],
      telemetry_digest: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      agent_version: "0.1.0",
    }),
    signature: "dGVzdC1zaWduYXR1cmU=",
    public_key: "dGVzdC1wdWJsaWMta2V5",
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Collector API - POST /api/collector/telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("should reject request without Authorization header", async () => {
      const request = createRequest({ telemetry_batch: createValidBatch() });
      const response = await POST(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should reject request with malformed Authorization header", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "InvalidFormat"
      );
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it("should reject request with unsupported auth scheme", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "Basic dXNlcjpwYXNz"
      );
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it("should accept Bearer token with valid format", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "Bearer tenant-123.secret-key-value"
      );
      const response = await POST(request);

      expect(response.status).toBe(202);
    });

    it("should accept AgentKey token with valid format", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "AgentKey tenant-123.integration-key-value"
      );
      const response = await POST(request);

      expect(response.status).toBe(202);
    });

    it("should reject token with invalid format (no tenant)", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "Bearer invalidtoken"
      );
      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe("validateAgentToken", () => {
    it("should return valid=true with tenantId for Bearer token", () => {
      const request = new NextRequest("http://localhost/test", {
        headers: { Authorization: "Bearer tenant-xyz.secret123" },
      });
      const result = validateAgentToken(request);
      expect(result.valid).toBe(true);
      expect(result.tenantId).toBe("tenant-xyz");
    });

    it("should return valid=true with tenantId for AgentKey token", () => {
      const request = new NextRequest("http://localhost/test", {
        headers: { Authorization: "AgentKey my-tenant.key-value" },
      });
      const result = validateAgentToken(request);
      expect(result.valid).toBe(true);
      expect(result.tenantId).toBe("my-tenant");
    });

    it("should return valid=false when no auth header", () => {
      const request = new NextRequest("http://localhost/test");
      const result = validateAgentToken(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Request Validation", () => {
    it("should reject request with no telemetry_batch or build_attestation", async () => {
      const request = createRequest(
        {},
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Validation failed");
    });

    it("should reject telemetry batch with more than 500 events", async () => {
      const events = Array.from({ length: 501 }, (_, i) => ({
        type: "process_tree",
        pid: i,
      }));
      const request = createRequest(
        { telemetry_batch: createValidBatch({ events }) },
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("should reject batch with missing required fields", async () => {
      const request = createRequest(
        { telemetry_batch: { batch_id: "x" } }, // missing fields
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("should reject when tenant_id in batch doesn't match token", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch({ tenant_id: "other-tenant" }) },
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("mismatch");
    });

    it("should accept valid telemetry batch", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.status).toBe("accepted");
      expect(body.batch_id).toBe("batch-001");
    });

    it("should accept valid build attestation", async () => {
      const request = createRequest(
        { build_attestation: createValidAttestation() },
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.status).toBe("accepted");
      expect(body.attestation).toBe("test-uuid-1234");
    });

    it("should accept both telemetry batch and attestation together", async () => {
      const request = createRequest(
        {
          telemetry_batch: createValidBatch(),
          build_attestation: createValidAttestation(),
        },
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.telemetry).toBe("msg-id-123");
      expect(body.attestation).toBe("test-uuid-1234");
    });

    it("should reject invalid JSON body", async () => {
      const request = new NextRequest("http://localhost/api/collector/telemetry", {
        method: "POST",
        body: "not json {{{",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer tenant-123.key",
        },
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid JSON body");
    });
  });

  describe("Telemetry Batch Persistence", () => {
    it("should send telemetry batch to SQS agent-telemetry queue", async () => {
      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "Bearer tenant-123.key"
      );
      await POST(request);

      expect(mockSendMessage).toHaveBeenCalledOnce();
      const [queueName, message] = mockSendMessage.mock.calls[0];
      expect(queueName).toBe("agent-telemetry");
      expect(message.eventType).toBe("telemetry.batch");
      expect(message.entityId).toBe("batch-001");
      expect(message.tenantId).toBe("tenant-123");
      expect(message.metadata?.serviceId).toBe("payment-service");
      expect(message.metadata?.eventCount).toBe("2");
    });
  });

  describe("Build Attestation Persistence", () => {
    it("should store attestation in DynamoDB attestations table", async () => {
      const request = createRequest(
        {
          telemetry_batch: createValidBatch(),
          build_attestation: createValidAttestation(),
        },
        "Bearer tenant-123.key"
      );
      await POST(request);

      expect(mockSend).toHaveBeenCalledOnce();
      const putInput = mockSend.mock.calls[0][0].input;
      expect(putInput.TableName).toBe("ollinai-attestations");
      expect(putInput.Item.attestationId).toBe("test-uuid-1234");
      expect(putInput.Item.tenantId).toBe("tenant-123");
      expect(putInput.Item.serviceId).toBe("payment-service");
      expect(putInput.Item.PK).toBe("TENANT#tenant-123#SVC#payment-service");
      expect(putInput.Item.SK).toMatch(/^ATTEST#/);
      expect(putInput.Item.signature).toBe("dGVzdC1zaWduYXR1cmU=");
      expect(putInput.Item.signaturePublicKey).toBe("dGVzdC1wdWJsaWMta2V5");
    });

    it("should extract process count from attestation JSON", async () => {
      const request = createRequest(
        {
          telemetry_batch: createValidBatch(),
          build_attestation: createValidAttestation(),
        },
        "Bearer tenant-123.key"
      );
      await POST(request);

      const putInput = mockSend.mock.calls[0][0].input;
      expect(putInput.Item.processCount).toBe(2); // 2 processes in mock
      expect(putInput.Item.networkConnectionCount).toBe(1);
      expect(putInput.Item.sensitiveFileWriteCount).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should return 500 on SQS send failure", async () => {
      mockSendMessage.mockRejectedValueOnce(new Error("SQS unavailable"));

      const request = createRequest(
        { telemetry_batch: createValidBatch() },
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(500);
    });

    it("should return 500 on DynamoDB failure for attestation", async () => {
      mockSend.mockRejectedValueOnce(new Error("DDB unavailable"));

      const request = createRequest(
        { build_attestation: createValidAttestation() },
        "Bearer tenant-123.key"
      );
      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });
});
