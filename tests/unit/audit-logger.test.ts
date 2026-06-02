/**
 * Unit tests for audit logging service.
 *
 * Tests cover:
 * - Enterprise tier gate: only record when tenant has Enterprise subscription (12.1, 12.6)
 * - Required fields: actor, action, target resource, timestamp (ms), source IP, outcome (12.2)
 * - Append-only write to ollinai-audit table (12.5)
 * - Skips silently for non-Enterprise tiers without throwing (12.6)
 * - Generates unique auditId (UUID) per event
 * - Correct DynamoDB key format (PK=TENANT#{tenantId}, SK=AUDIT#{timestamp}#{auditId})
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DynamoDB client module
vi.mock("@/lib/dynamo/client", () => ({
  getDocumentClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  TableNames: {
    EVENTS: "ollinai-events",
    INCIDENTS: "ollinai-incidents",
    METRICS: "ollinai-metrics",
    CONFIG: "ollinai-config",
    AUDIT: "ollinai-audit",
  },
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  GetCommand: vi.fn().mockImplementation((input) => ({ input })),
  PutCommand: vi.fn().mockImplementation((input) => ({ input })),
  QueryCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  DeleteCommand: vi.fn(),
}));

// Mock tier-gate to control subscription tier in tests
vi.mock("@/lib/middleware/tier-gate", () => ({
  getTenantSubscription: vi.fn(),
}));

import { getDocumentClient } from "@/lib/dynamo/client";
import { getTenantSubscription } from "@/lib/middleware/tier-gate";
import { logAuditEvent, type AuditEventParams } from "@/lib/audit/logger";

const mockSend = vi.fn();
const mockGetTenantSubscription = getTenantSubscription as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
    send: mockSend,
  });
  mockSend.mockResolvedValue({});
});

// ─── Helper ────────────────────────────────────────────────────────────────────

function makeAuditParams(overrides?: Partial<AuditEventParams>): AuditEventParams {
  return {
    tenantId: "tenant-1",
    actor: "user-123",
    action: "team.create",
    targetResource: "TEAM#team-456",
    sourceIp: "192.168.1.1",
    outcome: "success",
    ...overrides,
  };
}

// ─── Enterprise Tier Gate ──────────────────────────────────────────────────────

describe("logAuditEvent — tier gating", () => {
  it("records audit event when tenant is on Enterprise tier", async () => {
    mockGetTenantSubscription.mockResolvedValue("enterprise");

    const result = await logAuditEvent(makeAuditParams());

    expect(result.recorded).toBe(true);
    expect(result.auditId).toBeDefined();
    expect(result.reason).toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("skips recording when tenant is on Starter tier", async () => {
    mockGetTenantSubscription.mockResolvedValue("starter");

    const result = await logAuditEvent(makeAuditParams());

    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("not_enterprise_tier");
    expect(result.auditId).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips recording when tenant is on Pro tier", async () => {
    mockGetTenantSubscription.mockResolvedValue("pro");

    const result = await logAuditEvent(makeAuditParams());

    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("not_enterprise_tier");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not throw when tier is not enterprise", async () => {
    mockGetTenantSubscription.mockResolvedValue("starter");

    await expect(logAuditEvent(makeAuditParams())).resolves.not.toThrow();
  });
});

// ─── DynamoDB Write Correctness ────────────────────────────────────────────────

describe("logAuditEvent — DynamoDB write", () => {
  beforeEach(() => {
    mockGetTenantSubscription.mockResolvedValue("enterprise");
  });

  it("writes to the ollinai-audit table", async () => {
    await logAuditEvent(makeAuditParams());

    const command = mockSend.mock.calls[0][0];
    expect(command.input.TableName).toBe("ollinai-audit");
  });

  it("uses correct partition key format TENANT#{tenantId}", async () => {
    await logAuditEvent(makeAuditParams({ tenantId: "tenant-xyz" }));

    const command = mockSend.mock.calls[0][0];
    expect(command.input.Item.PK).toBe("TENANT#tenant-xyz");
  });

  it("uses correct sort key format AUDIT#{timestamp}#{auditId}", async () => {
    await logAuditEvent(makeAuditParams());

    const command = mockSend.mock.calls[0][0];
    const sk = command.input.Item.SK as string;
    expect(sk).toMatch(/^AUDIT#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[0-9a-f-]{36}$/);
  });

  it("includes all required fields in the audit item", async () => {
    const params = makeAuditParams({
      actor: "user-abc",
      action: "service.update",
      targetResource: "SVC#svc-789",
      sourceIp: "10.0.0.1",
      outcome: "failure",
    });

    await logAuditEvent(params);

    const command = mockSend.mock.calls[0][0];
    const item = command.input.Item;
    expect(item.actor).toBe("user-abc");
    expect(item.action).toBe("service.update");
    expect(item.targetResource).toBe("SVC#svc-789");
    expect(item.sourceIp).toBe("10.0.0.1");
    expect(item.outcome).toBe("failure");
  });

  it("records timestamp in ISO 8601 with millisecond precision", async () => {
    await logAuditEvent(makeAuditParams());

    const command = mockSend.mock.calls[0][0];
    const timestamp = command.input.Item.timestamp as string;
    // ISO 8601 with ms: e.g., 2024-01-15T10:30:45.123Z
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("generates a unique UUID for auditId", async () => {
    await logAuditEvent(makeAuditParams());
    await logAuditEvent(makeAuditParams());

    const firstCommand = mockSend.mock.calls[0][0];
    const secondCommand = mockSend.mock.calls[1][0];
    const firstSK = firstCommand.input.Item.SK as string;
    const secondSK = secondCommand.input.Item.SK as string;

    // Extract auditId from SK (last segment after the second #)
    const firstAuditId = firstSK.split("#").slice(2).join("#");
    const secondAuditId = secondSK.split("#").slice(2).join("#");
    expect(firstAuditId).not.toBe(secondAuditId);
  });

  it("returns the generated auditId in the result", async () => {
    const result = await logAuditEvent(makeAuditParams());

    expect(result.auditId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ─── Append-Only Semantics ─────────────────────────────────────────────────────

describe("logAuditEvent — append-only semantics", () => {
  beforeEach(() => {
    mockGetTenantSubscription.mockResolvedValue("enterprise");
  });

  it("uses PutCommand (not UpdateCommand or DeleteCommand) for writes", async () => {
    const { PutCommand } = await import("@aws-sdk/lib-dynamodb");

    await logAuditEvent(makeAuditParams());

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });

  it("does not expose any update operation", async () => {
    // The module itself only exports logAuditEvent — no updateAuditEvent or deleteAuditEvent
    const auditModule = await import("@/lib/audit/logger");
    const exportedKeys = Object.keys(auditModule);
    expect(exportedKeys).not.toContain("updateAuditEvent");
    expect(exportedKeys).not.toContain("deleteAuditEvent");
    expect(exportedKeys).not.toContain("removeAuditEvent");
  });
});

// ─── Different Action Types ────────────────────────────────────────────────────

describe("logAuditEvent — various actions", () => {
  beforeEach(() => {
    mockGetTenantSubscription.mockResolvedValue("enterprise");
  });

  it("logs team.create action", async () => {
    await logAuditEvent(makeAuditParams({ action: "team.create" }));
    const item = mockSend.mock.calls[0][0].input.Item;
    expect(item.action).toBe("team.create");
  });

  it("logs integration.rotate_key action", async () => {
    await logAuditEvent(makeAuditParams({ action: "integration.rotate_key" }));
    const item = mockSend.mock.calls[0][0].input.Item;
    expect(item.action).toBe("integration.rotate_key");
  });

  it("logs api.export action", async () => {
    await logAuditEvent(makeAuditParams({ action: "api.export" }));
    const item = mockSend.mock.calls[0][0].input.Item;
    expect(item.action).toBe("api.export");
  });

  it("logs subscription.downgrade action", async () => {
    await logAuditEvent(makeAuditParams({ action: "subscription.downgrade" }));
    const item = mockSend.mock.calls[0][0].input.Item;
    expect(item.action).toBe("subscription.downgrade");
  });
});
