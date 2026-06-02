/**
 * Unit tests for the incident ingestion webhook endpoint.
 *
 * Tests cover:
 * - HMAC signature verification (401 on failure)
 * - Zod payload validation (400 on invalid fields)
 * - Successful incident creation (201)
 * - Resolution timestamp updates for existing incidents (200)
 * - Missing headers (400/401)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { computeSignature } from "@/lib/webhooks/hmac";

// Mock DynamoDB tenant-scope module
vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantServiceKey: (tenantId: string, serviceId: string) =>
    `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantPrefix: (tenantId: string) => `TENANT#${tenantId}`,
  tenantQuery: vi.fn(),
  tenantPut: vi.fn(),
  tenantUpdate: vi.fn(),
}));

// Mock SQS client
vi.mock("@/lib/sqs/client", () => ({
  sendMessage: vi.fn().mockResolvedValue("mock-message-id"),
}));

// Mock DynamoDB client
vi.mock("@/lib/dynamo/client", () => ({
  TableNames: {
    EVENTS: "ollinai-events",
    INCIDENTS: "ollinai-incidents",
    METRICS: "ollinai-metrics",
    CONFIG: "ollinai-config",
    AUDIT: "ollinai-audit",
  },
}));

import { POST } from "@/app/api/webhooks/incidents/route";
import { tenantQuery, tenantPut, tenantUpdate } from "@/lib/dynamo/tenant-scope";
import { sendMessage } from "@/lib/sqs/client";

const TEST_SECRET = "a".repeat(64); // 32 bytes hex-encoded
const TEST_TENANT_ID = "tenant-123";

function createRequest(
  body: unknown,
  options?: {
    signature?: string;
    tenantId?: string;
    secret?: string;
    omitSignature?: boolean;
    omitTenant?: boolean;
    omitSecret?: boolean;
  }
): NextRequest {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const sig = options?.signature ?? computeSignature(TEST_SECRET, rawBody);

  const headers: Record<string, string> = {};
  if (!options?.omitTenant) headers["x-ollinai-tenant-id"] = options?.tenantId ?? TEST_TENANT_ID;
  if (!options?.omitSignature) headers["x-ollinai-signature"] = sig;
  if (!options?.omitSecret) headers["x-ollinai-integration-secret"] = options?.secret ?? TEST_SECRET;

  return new NextRequest("http://localhost:3000/api/webhooks/incidents", {
    method: "POST",
    body: rawBody,
    headers,
  });
}

function validPayload(overrides?: Record<string, unknown>) {
  return {
    externalId: "ext-incident-001",
    severity: "high",
    affectedService: "payment-service",
    detectionTimestamp: "2024-01-15T10:30:00Z",
    ...overrides,
  };
}

describe("POST /api/webhooks/incidents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing incident
    (tenantQuery as ReturnType<typeof vi.fn>).mockResolvedValue({ Items: [] });
    (tenantPut as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (tenantUpdate as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  describe("HMAC signature verification", () => {
    it("should return 401 when signature is missing", async () => {
      const req = createRequest(validPayload(), { omitSignature: true });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("authentication");
    });

    it("should return 401 when integration secret is missing", async () => {
      const req = createRequest(validPayload(), { omitSecret: true });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("should return 401 when signature is invalid", async () => {
      const req = createRequest(validPayload(), { signature: "invalid-signature" });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("signature");
    });
  });

  describe("missing headers", () => {
    it("should return 400 when tenant-id header is missing", async () => {
      const req = createRequest(validPayload(), { omitTenant: true });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("tenant-id");
    });
  });

  describe("payload validation", () => {
    it("should return 400 when externalId is empty", async () => {
      const req = createRequest(validPayload({ externalId: "" }));
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "externalId" }),
        ])
      );
    });

    it("should return 400 when severity is invalid", async () => {
      const req = createRequest(validPayload({ severity: "extreme" }));
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "severity" }),
        ])
      );
    });

    it("should return 400 when affectedService is empty", async () => {
      const req = createRequest(validPayload({ affectedService: "" }));
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "affectedService" }),
        ])
      );
    });

    it("should return 400 when detectionTimestamp is invalid", async () => {
      const req = createRequest(validPayload({ detectionTimestamp: "not-a-date" }));
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "detectionTimestamp" }),
        ])
      );
    });

    it("should return 400 when resolutionTimestamp is invalid ISO 8601", async () => {
      const req = createRequest(validPayload({ resolutionTimestamp: "2024-13-40" }));
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "resolutionTimestamp" }),
        ])
      );
    });

    it("should return 400 on invalid JSON body", async () => {
      const req = createRequest("not valid json {{{");
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("should return 400 when required fields are missing", async () => {
      const req = createRequest({});
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields.length).toBeGreaterThan(0);
    });
  });

  describe("successful incident creation", () => {
    it("should return 201 with incidentId on valid payload", async () => {
      const req = createRequest(validPayload());
      const res = await POST(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.incidentId).toBeDefined();
      expect(body.status).toBe("created");
    });

    it("should persist the incident to DynamoDB", async () => {
      const payload = validPayload();
      const req = createRequest(payload);
      await POST(req);

      expect(tenantPut).toHaveBeenCalledWith(
        TEST_TENANT_ID,
        expect.objectContaining({
          TableName: "ollinai-incidents",
          Item: expect.objectContaining({
            PK: `TENANT#${TEST_TENANT_ID}#SVC#${payload.affectedService}`,
            externalId: payload.externalId,
            severity: payload.severity,
            detectionTimestamp: payload.detectionTimestamp,
            correlationStatus: "pending",
            GSI1PK: `TENANT#${TEST_TENANT_ID}`,
            GSI1SK: `INC#${payload.detectionTimestamp}`,
          }),
        })
      );
    });

    it("should enqueue incident to SQS with eventType incident.created", async () => {
      const payload = validPayload();
      const req = createRequest(payload);
      await POST(req);

      expect(sendMessage).toHaveBeenCalledWith(
        "ollinai-incidents",
        expect.objectContaining({
          eventType: "incident.created",
          tenantId: TEST_TENANT_ID,
          metadata: expect.objectContaining({
            serviceId: payload.affectedService,
            severity: payload.severity,
          }),
        })
      );
    });

    it("should accept optional resolutionTimestamp on creation", async () => {
      const payload = validPayload({ resolutionTimestamp: "2024-01-15T11:00:00Z" });
      const req = createRequest(payload);
      const res = await POST(req);
      expect(res.status).toBe(201);

      expect(tenantPut).toHaveBeenCalledWith(
        TEST_TENANT_ID,
        expect.objectContaining({
          Item: expect.objectContaining({
            resolutionTimestamp: "2024-01-15T11:00:00Z",
          }),
        })
      );
    });
  });

  describe("resolution timestamp updates for existing incidents", () => {
    it("should update resolutionTimestamp when incident already exists", async () => {
      const existingItem = {
        PK: `TENANT#${TEST_TENANT_ID}#SVC#payment-service`,
        SK: "INC#2024-01-15T10:30:00Z#existing-id",
        incidentId: "existing-id",
        externalId: "ext-incident-001",
        severity: "high",
        detectionTimestamp: "2024-01-15T10:30:00Z",
        correlationStatus: "pending",
      };

      (tenantQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        Items: [existingItem],
      });

      const payload = validPayload({ resolutionTimestamp: "2024-01-15T12:00:00Z" });
      const req = createRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.incidentId).toBe("existing-id");
      expect(body.status).toBe("updated");

      expect(tenantUpdate).toHaveBeenCalledWith(
        TEST_TENANT_ID,
        expect.objectContaining({
          TableName: "ollinai-incidents",
          Key: {
            PK: existingItem.PK,
            SK: existingItem.SK,
          },
          UpdateExpression: "SET resolutionTimestamp = :rt",
          ExpressionAttributeValues: {
            ":rt": "2024-01-15T12:00:00Z",
          },
        })
      );
    });

    it("should enqueue incident.updated event when resolution timestamp is set", async () => {
      const existingItem = {
        PK: `TENANT#${TEST_TENANT_ID}#SVC#payment-service`,
        SK: "INC#2024-01-15T10:30:00Z#existing-id",
        incidentId: "existing-id",
        externalId: "ext-incident-001",
        severity: "high",
        detectionTimestamp: "2024-01-15T10:30:00Z",
        correlationStatus: "pending",
      };

      (tenantQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        Items: [existingItem],
      });

      const payload = validPayload({ resolutionTimestamp: "2024-01-15T12:00:00Z" });
      const req = createRequest(payload);
      await POST(req);

      expect(sendMessage).toHaveBeenCalledWith(
        "ollinai-incidents",
        expect.objectContaining({
          eventType: "incident.updated",
          entityId: "existing-id",
          tenantId: TEST_TENANT_ID,
        })
      );
    });

    it("should return existing incident without update when no resolution timestamp provided", async () => {
      const existingItem = {
        PK: `TENANT#${TEST_TENANT_ID}#SVC#payment-service`,
        SK: "INC#2024-01-15T10:30:00Z#existing-id",
        incidentId: "existing-id",
        externalId: "ext-incident-001",
        severity: "high",
        detectionTimestamp: "2024-01-15T10:30:00Z",
        correlationStatus: "pending",
      };

      (tenantQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        Items: [existingItem],
      });

      const payload = validPayload(); // no resolutionTimestamp
      const req = createRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.incidentId).toBe("existing-id");
      expect(body.status).toBe("existing");
      expect(tenantUpdate).not.toHaveBeenCalled();
    });
  });

  describe("key structure", () => {
    it("should use correct PK and SK format for incident items", async () => {
      const payload = validPayload();
      const req = createRequest(payload);
      await POST(req);

      const putCall = (tenantPut as ReturnType<typeof vi.fn>).mock.calls[0];
      const item = putCall[1].Item;

      expect(item.PK).toBe(`TENANT#${TEST_TENANT_ID}#SVC#payment-service`);
      expect(item.SK).toMatch(/^INC#2024-01-15T10:30:00Z#[a-f0-9-]+$/);
    });

    it("should set GSI-1 attributes for time range queries", async () => {
      const payload = validPayload();
      const req = createRequest(payload);
      await POST(req);

      const putCall = (tenantPut as ReturnType<typeof vi.fn>).mock.calls[0];
      const item = putCall[1].Item;

      expect(item.GSI1PK).toBe(`TENANT#${TEST_TENANT_ID}`);
      expect(item.GSI1SK).toBe(`INC#${payload.detectionTimestamp}`);
    });
  });
});
