/**
 * Unit tests for the Test Event Builder
 *
 * Tests cover:
 * - buildTestEventPayload() — returns valid payload with expected placeholder values
 * - signPayload() — produces correct HMAC-SHA256 signatures
 * - sendTestEvent() — orchestrates payload construction, signing, and HTTP request
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTestEventPayload, signPayload, sendTestEvent } from "./test-event";
import { computeSignature, verifySignature } from "@/lib/webhooks/hmac";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// Mock DynamoDB client
const mockSend = vi.fn();
vi.mock("@/lib/dynamo/client", () => ({
  getDocumentClient: () => ({ send: mockSend }),
  TableNames: { CONFIG: "ollinai-config", EVENTS: "ollinai-events" },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Constants ─────────────────────────────────────────────────────────────────

const TEST_TENANT_ID = "tenant-test-001";
const TEST_INTEGRATION_ID = "integration-test-001";
const TEST_SECRET_KEY = "a".repeat(64); // Valid 32-byte hex key

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("buildTestEventPayload", () => {
  it("returns a payload with the expected placeholder commit SHA", () => {
    const payload = buildTestEventPayload();
    expect(payload.commitShas).toEqual(["test-commit-sha-onboarding"]);
  });

  it("returns a payload with the expected placeholder service name", () => {
    const payload = buildTestEventPayload();
    expect(payload.services).toEqual(["onboarding-test-service"]);
  });

  it("returns a payload with the expected placeholder environment", () => {
    const payload = buildTestEventPayload();
    expect(payload.environment).toBe("staging");
  });

  it("returns a payload with the expected placeholder author", () => {
    const payload = buildTestEventPayload();
    expect(payload.author).toBe("onboarding@ollinai.com");
  });

  it("returns a valid ISO-8601 deployment timestamp", () => {
    const payload = buildTestEventPayload();
    const parsed = Date.parse(payload.deploymentTimestamp);
    expect(isNaN(parsed)).toBe(false);
  });

  it("returns a timestamp that is not in the future", () => {
    const payload = buildTestEventPayload();
    const payloadTime = new Date(payload.deploymentTimestamp).getTime();
    const now = Date.now();
    // Allow 1 second tolerance for test execution
    expect(payloadTime).toBeLessThanOrEqual(now + 1000);
  });

  it("includes all required DeploymentEventPayload fields", () => {
    const payload = buildTestEventPayload();
    expect(payload).toHaveProperty("commitShas");
    expect(payload).toHaveProperty("author");
    expect(payload).toHaveProperty("services");
    expect(payload).toHaveProperty("deploymentTimestamp");
    expect(payload).toHaveProperty("environment");
  });

  it("commitShas is a non-empty array of non-empty strings", () => {
    const payload = buildTestEventPayload();
    expect(Array.isArray(payload.commitShas)).toBe(true);
    expect(payload.commitShas.length).toBeGreaterThan(0);
    payload.commitShas.forEach((sha) => {
      expect(sha.length).toBeGreaterThan(0);
    });
  });

  it("services is a non-empty array of non-empty strings", () => {
    const payload = buildTestEventPayload();
    expect(Array.isArray(payload.services)).toBe(true);
    expect(payload.services.length).toBeGreaterThan(0);
    payload.services.forEach((svc) => {
      expect(svc.length).toBeGreaterThan(0);
    });
  });
});

describe("signPayload", () => {
  it("returns a hex string", () => {
    const signature = signPayload('{"test":"data"}', TEST_SECRET_KEY);
    expect(/^[0-9a-f]+$/.test(signature)).toBe(true);
  });

  it("produces a 64-character hex string (SHA-256 = 32 bytes)", () => {
    const signature = signPayload('{"test":"data"}', TEST_SECRET_KEY);
    expect(signature.length).toBe(64);
  });

  it("produces the same signature as computeSignature for the same inputs", () => {
    const payload = '{"commitShas":["abc123"],"author":"test"}';
    const signResult = signPayload(payload, TEST_SECRET_KEY);
    const directResult = computeSignature(TEST_SECRET_KEY, payload);
    expect(signResult).toBe(directResult);
  });

  it("produces a signature that verifies correctly with verifySignature", () => {
    const payload = JSON.stringify(buildTestEventPayload());
    const signature = signPayload(payload, TEST_SECRET_KEY);
    const isValid = verifySignature(TEST_SECRET_KEY, payload, signature);
    expect(isValid).toBe(true);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signPayload('{"a":1}', TEST_SECRET_KEY);
    const sig2 = signPayload('{"a":2}', TEST_SECRET_KEY);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different keys", () => {
    const payload = '{"test":"data"}';
    const key1 = "a".repeat(64);
    const key2 = "b".repeat(64);
    const sig1 = signPayload(payload, key1);
    const sig2 = signPayload(payload, key2);
    expect(sig1).not.toBe(sig2);
  });
});

describe("sendTestEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_URL = "http://localhost:3000";
  });

  it("returns success with eventId when webhook returns 201", async () => {
    // Mock DynamoDB: integration lookup returns valid secret key
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    // Mock fetch: webhook returns 201
    mockFetch.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ eventId: "evt-123", status: "created" }),
    });

    const result = await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    expect(result.success).toBe(true);
    expect(result.eventId).toBe("evt-123");
    expect(result.error).toBeUndefined();
  });

  it("sends the correct headers to the webhook", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ eventId: "evt-456", status: "created" }),
    });

    await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/webhooks/deployments");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["X-OllinAI-Integration"]).toBe(
      `${TEST_TENANT_ID}:${TEST_INTEGRATION_ID}`
    );
    // Signature should be a valid hex string
    expect(/^[0-9a-f]{64}$/.test(options.headers["X-OllinAI-Signature"])).toBe(
      true
    );
  });

  it("sends a valid payload body to the webhook", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ eventId: "evt-789", status: "created" }),
    });

    await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.commitShas).toEqual(["test-commit-sha-onboarding"]);
    expect(body.services).toEqual(["onboarding-test-service"]);
    expect(body.environment).toBe("staging");
    expect(body.author).toBe("onboarding@ollinai.com");
    expect(body.deploymentTimestamp).toBeDefined();
  });

  it("returns success for duplicate events (status 200)", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ eventId: "evt-existing", status: "duplicate" }),
    });

    const result = await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    expect(result.success).toBe(true);
    expect(result.eventId).toBe("evt-existing");
  });

  it("returns error when integration is not found in DynamoDB", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await sendTestEvent(TEST_TENANT_ID, "nonexistent-id");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Integration not found or missing secret key");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns error when webhook returns validation error (400)", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockResolvedValueOnce({
      status: 400,
      json: async () => ({ error: "Validation failed" }),
    });

    const result = await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Validation failed");
  });

  it("returns error when webhook returns auth error (401)", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockResolvedValueOnce({
      status: 401,
      json: async () => ({ error: "Invalid webhook signature" }),
    });

    const result = await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid webhook signature");
  });

  it("returns error when fetch throws a network error", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("returns error when DynamoDB throws an error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB timeout"));

    const result = await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("DynamoDB timeout");
  });

  it("uses NEXTAUTH_URL environment variable for the base URL", async () => {
    process.env.NEXTAUTH_URL = "https://app.ollinai.com";

    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ eventId: "evt-prod", status: "created" }),
    });

    await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://app.ollinai.com/api/webhooks/deployments");
  });

  it("computes a signature that verifies against the payload", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TEST_TENANT_ID}`,
        SK: `INTEGRATION#${TEST_INTEGRATION_ID}`,
        entityData: {
          integrationId: TEST_INTEGRATION_ID,
          secretKeyHash: TEST_SECRET_KEY,
          name: "test-integration",
          type: "github_actions",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    mockFetch.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ eventId: "evt-sig", status: "created" }),
    });

    await sendTestEvent(TEST_TENANT_ID, TEST_INTEGRATION_ID);

    const [, options] = mockFetch.mock.calls[0];
    const signature = options.headers["X-OllinAI-Signature"];
    const body = options.body;

    // Verify the signature is correct for the payload
    const isValid = verifySignature(TEST_SECRET_KEY, body, signature);
    expect(isValid).toBe(true);
  });
});
