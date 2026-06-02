/**
 * Unit tests for the deployment event ingestion webhook endpoint.
 *
 * Tests cover: Zod validation, HMAC verification, deduplication,
 * service auto-creation, team assignment, and response codes.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { computeSignature } from "@/lib/webhooks/hmac";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// Mock DynamoDB client
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

// Mock SQS client
const mockSendMessage = vi.fn().mockResolvedValue("msg-123");
vi.mock("@/lib/sqs/client", () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

// Mock tenant-scope (pass-through)
vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantServiceKey: (tenantId: string, serviceId: string) =>
    `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantDedupKey: (tenantId: string) => `TENANT#${tenantId}#DEDUP`,
  tenantTeamKey: (tenantId: string, teamId: string) =>
    `TENANT#${tenantId}#TEAM#${teamId}`,
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

// Import the handler after mocks
import { POST } from "@/app/api/webhooks/deployments/route";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const TEST_SECRET =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2";
const TEST_TENANT_ID = "tenant-001";
const TEST_INTEGRATION_ID = "int-001";
const INTEGRATION_KEY = `${TEST_TENANT_ID}:${TEST_INTEGRATION_ID}`;

function validPayload() {
  return {
    commitShas: ["abc123def456"],
    author: "developer@company.com",
    services: ["api-service"],
    deploymentTimestamp: "2024-01-15T10:30:00.000Z",
    environment: "production",
  };
}

function createRequest(
  body: unknown,
  options?: { signature?: string; integrationKey?: string }
): NextRequest {
  const bodyStr = JSON.stringify(body);
  const signature =
    options?.signature ?? computeSignature(TEST_SECRET, bodyStr);
  const integrationKey = options?.integrationKey ?? INTEGRATION_KEY;

  return new NextRequest("http://localhost/api/webhooks/deployments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ollinai-signature": signature,
      "x-ollinai-integration": integrationKey,
    },
    body: bodyStr,
  });
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock: integration lookup succeeds
  mockSend.mockImplementation((command: { constructor: { name: string }; input?: { Key?: { SK?: string }; IndexName?: string } }) => {
    const cmdName = command.constructor.name;

    if (cmdName === "GetCommand") {
      const sk = command.input?.Key?.SK as string | undefined;
      if (sk?.startsWith("INTEGRATION#")) {
        // Return integration config
        return Promise.resolve({
          Item: {
            PK: `TENANT#${TEST_TENANT_ID}`,
            SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
            entityData: {
              integrationId: TEST_INTEGRATION_ID,
              secretKeyHash: TEST_SECRET,
            },
          },
        });
      }
      if (sk?.startsWith("SVC#")) {
        // Service not found (triggers auto-creation)
        return Promise.resolve({ Item: undefined });
      }
    }

    if (cmdName === "QueryCommand") {
      // GSI-3 dedup check — no duplicate found
      return Promise.resolve({ Items: [] });
    }

    if (cmdName === "PutCommand") {
      // Successful put
      return Promise.resolve({});
    }

    return Promise.resolve({});
  });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/deployments", () => {
  describe("HMAC signature verification", () => {
    it("should return 401 when signature header is missing", async () => {
      const req = new NextRequest(
        "http://localhost/api/webhooks/deployments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ollinai-integration": INTEGRATION_KEY,
          },
          body: JSON.stringify(validPayload()),
        }
      );

      const response = await POST(req);
      expect(response.status).toBe(401);
    });

    it("should return 401 when integration key header is missing", async () => {
      const req = new NextRequest(
        "http://localhost/api/webhooks/deployments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ollinai-signature": "abc123",
          },
          body: JSON.stringify(validPayload()),
        }
      );

      const response = await POST(req);
      expect(response.status).toBe(401);
    });

    it("should return 401 when integration key is not found", async () => {
      mockSend.mockImplementation((command: { constructor: { name: string } }) => {
        if (command.constructor.name === "GetCommand") {
          return Promise.resolve({ Item: undefined });
        }
        return Promise.resolve({});
      });

      const req = createRequest(validPayload());
      const response = await POST(req);
      expect(response.status).toBe(401);
    });

    it("should return 401 when signature is invalid", async () => {
      const req = createRequest(validPayload(), {
        signature: "0000000000000000000000000000000000000000000000000000000000000000",
      });

      const response = await POST(req);
      expect(response.status).toBe(401);
    });
  });

  describe("Payload validation", () => {
    it("should return 400 when commitShas is empty", async () => {
      const payload = { ...validPayload(), commitShas: [] };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.fields).toHaveProperty("commitShas");
    });

    it("should return 400 when commitShas has more than 50 items", async () => {
      const payload = {
        ...validPayload(),
        commitShas: Array.from({ length: 51 }, (_, i) => `sha-${i}`),
      };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.fields).toHaveProperty("commitShas");
    });

    it("should return 400 when services is empty", async () => {
      const payload = { ...validPayload(), services: [] };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.fields).toHaveProperty("services");
    });

    it("should return 400 when services has more than 20 items", async () => {
      const payload = {
        ...validPayload(),
        services: Array.from({ length: 21 }, (_, i) => `svc-${i}`),
      };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.fields).toHaveProperty("services");
    });

    it("should return 400 when author is empty", async () => {
      const payload = { ...validPayload(), author: "" };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.fields).toHaveProperty("author");
    });

    it("should return 400 when deploymentTimestamp is not valid ISO 8601", async () => {
      const payload = {
        ...validPayload(),
        deploymentTimestamp: "not-a-date",
      };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.fields).toHaveProperty("deploymentTimestamp");
    });

    it("should return 400 when environment is empty", async () => {
      const payload = { ...validPayload(), environment: "" };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.fields).toHaveProperty("environment");
    });

    it("should return 400 when required fields are missing", async () => {
      const payload = { commitShas: ["abc123"] }; // missing author, services, etc.
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.fields).toBeDefined();
    });

    it("should return 400 for invalid JSON body", async () => {
      const bodyStr = "not json at all {{{";
      const signature = computeSignature(TEST_SECRET, bodyStr);

      const req = new NextRequest(
        "http://localhost/api/webhooks/deployments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ollinai-signature": signature,
            "x-ollinai-integration": INTEGRATION_KEY,
          },
          body: bodyStr,
        }
      );

      const response = await POST(req);
      expect(response.status).toBe(400);
    });
  });

  describe("Successful ingestion", () => {
    it("should return 201 with eventId on valid payload", async () => {
      const req = createRequest(validPayload());

      const response = await POST(req);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.eventId).toBeDefined();
      expect(body.status).toBe("created");
    });

    it("should accept payload with optional changeSize", async () => {
      const payload = {
        ...validPayload(),
        changeSize: {
          linesAdded: 150,
          linesRemoved: 30,
          filesChanged: 12,
        },
      };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(201);
    });

    it("should persist event to DynamoDB", async () => {
      const req = createRequest(validPayload());

      await POST(req);

      // Find the PutCommand call for the events table
      const putCalls = mockSend.mock.calls.filter(
        (call: any[]) =>
          call[0].constructor.name === "PutCommand" &&
          call[0].input?.TableName === "ollinai-events"
      );
      expect(putCalls.length).toBe(1);

      const putItem = putCalls[0][0].input.Item;
      expect(putItem.eventId).toBeDefined();
      expect(putItem.commitShas).toEqual(["abc123def456"]);
      expect(putItem.author).toBe("developer@company.com");
      expect(putItem.services).toEqual(["api-service"]);
      expect(putItem.environment).toBe("production");
      expect(putItem.teamId).toBe("UNASSIGNED");
    });

    it("should enqueue event to SQS", async () => {
      const req = createRequest(validPayload());

      await POST(req);

      expect(mockSendMessage).toHaveBeenCalledWith(
        "ollinai-deployment-events",
        expect.objectContaining({
          eventType: "deployment.created",
          tenantId: TEST_TENANT_ID,
          metadata: expect.objectContaining({
            primaryService: "api-service",
            environment: "production",
          }),
        })
      );
    });
  });

  describe("Deduplication", () => {
    it("should return 200 with existing eventId for duplicate", async () => {
      const existingEventId = "existing-event-uuid";

      mockSend.mockImplementation((command: { constructor: { name: string }; input?: { Key?: { SK?: string }; IndexName?: string } }) => {
        const cmdName = command.constructor.name;

        if (cmdName === "GetCommand") {
          const sk = command.input?.Key?.SK as string | undefined;
          if (sk?.startsWith("INTEGRATION#")) {
            return Promise.resolve({
              Item: {
                PK: `TENANT#${TEST_TENANT_ID}`,
                SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
                entityData: {
                  integrationId: TEST_INTEGRATION_ID,
                  secretKeyHash: TEST_SECRET,
                },
              },
            });
          }
          return Promise.resolve({ Item: undefined });
        }

        if (cmdName === "QueryCommand") {
          // GSI-3 dedup check — duplicate found
          return Promise.resolve({
            Items: [{ eventId: existingEventId }],
          });
        }

        return Promise.resolve({});
      });

      const req = createRequest(validPayload());
      const response = await POST(req);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.eventId).toBe(existingEventId);
      expect(body.status).toBe("duplicate");
    });
  });

  describe("Team assignment", () => {
    it("should assign team from service ownership config", async () => {
      mockSend.mockImplementation((command: { constructor: { name: string }; input?: { Key?: { SK?: string }; IndexName?: string; TableName?: string } }) => {
        const cmdName = command.constructor.name;

        if (cmdName === "GetCommand") {
          const sk = command.input?.Key?.SK as string | undefined;
          if (sk?.startsWith("INTEGRATION#")) {
            return Promise.resolve({
              Item: {
                PK: `TENANT#${TEST_TENANT_ID}`,
                SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
                entityData: {
                  integrationId: TEST_INTEGRATION_ID,
                  secretKeyHash: TEST_SECRET,
                },
              },
            });
          }
          if (sk?.startsWith("SVC#")) {
            // Service exists with owning team
            return Promise.resolve({
              Item: {
                PK: `TENANT#${TEST_TENANT_ID}`,
                SK: sk,
                entityData: {
                  serviceId: "api-service",
                  name: "api-service",
                  owningTeamId: "team-backend",
                },
              },
            });
          }
        }

        if (cmdName === "QueryCommand") {
          return Promise.resolve({ Items: [] });
        }

        if (cmdName === "PutCommand") {
          return Promise.resolve({});
        }

        return Promise.resolve({});
      });

      const req = createRequest(validPayload());
      const response = await POST(req);

      expect(response.status).toBe(201);

      // Check the PutCommand for events table has correct teamId
      const putCalls = mockSend.mock.calls.filter(
        (call: any[]) =>
          call[0].constructor.name === "PutCommand" &&
          call[0].input?.TableName === "ollinai-events"
      );
      expect(putCalls.length).toBe(1);
      expect(putCalls[0][0].input.Item.teamId).toBe("team-backend");
    });

    it("should auto-create service as UNASSIGNED when not found", async () => {
      const req = createRequest(validPayload());
      const response = await POST(req);

      expect(response.status).toBe(201);

      // Check that a PutCommand was issued for the config table (auto-creation)
      const configPutCalls = mockSend.mock.calls.filter(
        (call: any[]) =>
          call[0].constructor.name === "PutCommand" &&
          call[0].input?.TableName === "ollinai-config"
      );
      expect(configPutCalls.length).toBeGreaterThan(0);

      const createdService = configPutCalls[0][0].input.Item;
      expect(createdService.entityData.owningTeamId).toBe("UNASSIGNED");
      expect(createdService.entityData.serviceId).toBe("api-service");
    });
  });

  describe("Payload boundary validation", () => {
    it("should accept exactly 50 commit SHAs", async () => {
      const payload = {
        ...validPayload(),
        commitShas: Array.from({ length: 50 }, (_, i) => `sha-${i}`),
      };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(201);
    });

    it("should accept exactly 20 services", async () => {
      const payload = {
        ...validPayload(),
        services: Array.from({ length: 20 }, (_, i) => `svc-${i}`),
      };
      const req = createRequest(payload);

      const response = await POST(req);
      expect(response.status).toBe(201);
    });

    it("should accept exactly 1 commit SHA", async () => {
      const req = createRequest(validPayload());
      const response = await POST(req);
      expect(response.status).toBe(201);
    });
  });
});
