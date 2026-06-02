/**
 * Unit tests for the retention archiver Lambda handler.
 *
 * Tests cover:
 * - Discovering tenant subscriptions via scan
 * - Skipping tenants with unlimited retention (enterprise)
 * - Archiving events and incidents older than retention period
 * - Handling errors gracefully per tenant
 * - Correct cutoff calculation based on tier retention days
 *
 * Requirements: 8.6, 8.8
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

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

vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  ScanCommand: vi.fn().mockImplementation((input) => ({ input, type: "scan" })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ input, type: "query" })),
  DeleteCommand: vi.fn().mockImplementation((input) => ({ input, type: "delete" })),
}));

import {
  handler,
  getAllTenantSubscriptions,
  archiveTenantData,
} from "@/lambdas/retention-archiver/handler";
import type { ScheduledEvent } from "aws-lambda";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createScheduledEvent(): ScheduledEvent {
  return {
    version: "0",
    id: "test-event-id",
    "detail-type": "Scheduled Event",
    source: "aws.events",
    account: "123456789012",
    time: "2024-06-01T00:00:00Z",
    region: "us-east-1",
    resources: [],
    detail: {},
  };
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests: getAllTenantSubscriptions ───────────────────────────────────────────

describe("getAllTenantSubscriptions", () => {
  it("returns empty array when no tenants exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getAllTenantSubscriptions();
    expect(result).toEqual([]);
  });

  it("discovers tenants from config table scan", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "TENANT#tenant-001",
          SK: "SUBSCRIPTION#current",
          entityData: { tier: "starter", activatedAt: "2024-01-01T00:00:00Z" },
        },
        {
          PK: "TENANT#tenant-002",
          SK: "SUBSCRIPTION#current",
          entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
        },
        {
          PK: "TENANT#tenant-003",
          SK: "SUBSCRIPTION#current",
          entityData: { tier: "enterprise", activatedAt: "2024-01-01T00:00:00Z" },
        },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await getAllTenantSubscriptions();
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ tenantId: "tenant-001", tier: "starter" });
    expect(result[1]).toEqual({ tenantId: "tenant-002", tier: "pro" });
    expect(result[2]).toEqual({ tenantId: "tenant-003", tier: "enterprise" });
  });

  it("paginates through multiple scan pages", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#t1",
            SK: "SUBSCRIPTION#current",
            entityData: { tier: "starter", activatedAt: "2024-01-01T00:00:00Z" },
          },
        ],
        LastEvaluatedKey: { PK: "TENANT#t1", SK: "SUBSCRIPTION#current" },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            PK: "TENANT#t2",
            SK: "SUBSCRIPTION#current",
            entityData: { tier: "pro", activatedAt: "2024-01-01T00:00:00Z" },
          },
        ],
        LastEvaluatedKey: undefined,
      });

    const result = await getAllTenantSubscriptions();
    expect(result).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

// ─── Tests: archiveTenantData ──────────────────────────────────────────────────

describe("archiveTenantData", () => {
  it("skips enterprise tenants with unlimited retention", async () => {
    const result = await archiveTenantData("tenant-003", "enterprise");

    expect(result.skipped).toBe(true);
    expect(result.retentionDays).toBeNull();
    expect(result.eventsArchived).toBe(0);
    expect(result.incidentsArchived).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("archives starter tier data (30-day retention)", async () => {
    // Scan for events returns some old items
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: "TENANT#t1#SVC#svc1", SK: "DEPLOY#2024-01-01T00:00:00Z#ev1", createdAt: "2024-01-01T00:00:00Z" },
        { PK: "TENANT#t1#SVC#svc1", SK: "DEPLOY#2024-01-02T00:00:00Z#ev2", createdAt: "2024-01-02T00:00:00Z" },
      ],
      LastEvaluatedKey: undefined,
    });
    // Delete calls for the 2 events
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    // Scan for incidents returns one old item
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: "TENANT#t1#SVC#svc1", SK: "INC#2024-01-05T00:00:00Z#inc1", detectionTimestamp: "2024-01-05T00:00:00Z" },
      ],
      LastEvaluatedKey: undefined,
    });
    // Delete call for the 1 incident
    mockSend.mockResolvedValueOnce({});

    const result = await archiveTenantData("t1", "starter");

    expect(result.skipped).toBe(false);
    expect(result.retentionDays).toBe(30);
    expect(result.eventsArchived).toBe(2);
    expect(result.incidentsArchived).toBe(1);
    expect(result.tier).toBe("starter");
  });

  it("archives pro tier data (90-day retention)", async () => {
    // No old events
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // No old incidents
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await archiveTenantData("t2", "pro");

    expect(result.skipped).toBe(false);
    expect(result.retentionDays).toBe(90);
    expect(result.eventsArchived).toBe(0);
    expect(result.incidentsArchived).toBe(0);
  });
});

// ─── Tests: handler ────────────────────────────────────────────────────────────

describe("handler", () => {
  it("processes all tenants and returns summary", async () => {
    // Scan for tenant subscriptions
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "TENANT#t1",
          SK: "SUBSCRIPTION#current",
          entityData: { tier: "starter", activatedAt: "2024-01-01T00:00:00Z" },
        },
        {
          PK: "TENANT#t2",
          SK: "SUBSCRIPTION#current",
          entityData: { tier: "enterprise", activatedAt: "2024-01-01T00:00:00Z" },
        },
      ],
      LastEvaluatedKey: undefined,
    });
    // Scan events for t1 (starter)
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // Scan incidents for t1 (starter)
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await handler(createScheduledEvent());

    expect(result.tenantsProcessed).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].tenantId).toBe("t1");
    expect(result.results[0].skipped).toBe(false);
    expect(result.results[1].tenantId).toBe("t2");
    expect(result.results[1].skipped).toBe(true);
    expect(result.executedAt).toBeDefined();
  });

  it("handles individual tenant failures gracefully", async () => {
    // Scan for tenant subscriptions
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "TENANT#t1",
          SK: "SUBSCRIPTION#current",
          entityData: { tier: "starter", activatedAt: "2024-01-01T00:00:00Z" },
        },
      ],
      LastEvaluatedKey: undefined,
    });
    // Scan events fails for t1
    mockSend.mockRejectedValueOnce(new Error("DynamoDB timeout"));

    const result = await handler(createScheduledEvent());

    expect(result.tenantsProcessed).toBe(1);
    expect(result.results[0].error).toBe("DynamoDB timeout");
    expect(result.results[0].eventsArchived).toBe(0);
  });

  it("returns zero totals when no tenants found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await handler(createScheduledEvent());

    expect(result.tenantsProcessed).toBe(0);
    expect(result.totalEventsArchived).toBe(0);
    expect(result.totalIncidentsArchived).toBe(0);
    expect(result.results).toEqual([]);
  });
});
