import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeRiskMetrics } from "../risk";
import type { MetricComputeContext } from "../types";

// Mock the DynamoDB client
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

import { getDocumentClient } from "@/lib/dynamo/client";

function makeContext(overrides?: Partial<MetricComputeContext>): MetricComputeContext {
  return {
    tenantId: "tenant-1",
    from: new Date("2024-01-01T00:00:00.000Z"),
    to: new Date("2024-01-07T00:00:00.000Z"),
    ...overrides,
  };
}

function makeEvent(
  id: string,
  riskScore: "low" | "medium" | "high" | "critical" | "indeterminate" | undefined,
  createdAt: string,
  services: string[] = ["svc-1"],
  teamId: string = "UNASSIGNED"
) {
  return {
    PK: `TENANT#tenant-1#SVC#${services[0]}`,
    SK: `DEPLOY#${createdAt}#${id}`,
    eventId: id,
    commitShas: ["sha1"],
    author: "dev1",
    services,
    environment: "production",
    teamId,
    riskScore,
    createdAt,
    GSI2PK: `TENANT#tenant-1#TEAM#${teamId}`,
    GSI2SK: `DEPLOY#${createdAt}`,
  };
}

describe("computeRiskMetrics", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
      send: mockSend,
    });
  });

  it("returns empty results when fewer than 3 events exist (insufficient data)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "low", "2024-01-02T10:00:00.000Z"),
        makeEvent("e2", "high", "2024-01-03T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeRiskMetrics(makeContext());

    expect(result.distribution).toEqual({ low: 0, medium: 0, high: 0, critical: 0 });
    expect(result.trend).toEqual([]);
    expect(result.averageByService).toEqual([]);
    expect(result.period.start).toBe("2024-01-01T00:00:00.000Z");
    expect(result.period.end).toBe("2024-01-07T00:00:00.000Z");
  });

  it("computes risk distribution correctly", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "low", "2024-01-02T10:00:00.000Z"),
        makeEvent("e2", "low", "2024-01-02T11:00:00.000Z"),
        makeEvent("e3", "medium", "2024-01-03T10:00:00.000Z"),
        makeEvent("e4", "high", "2024-01-04T10:00:00.000Z"),
        makeEvent("e5", "critical", "2024-01-05T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeRiskMetrics(makeContext());

    expect(result.distribution).toEqual({ low: 2, medium: 1, high: 1, critical: 1 });
  });

  it("computes high/critical trend by day", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "high", "2024-01-01T10:00:00.000Z"),
        makeEvent("e2", "critical", "2024-01-01T12:00:00.000Z"),
        makeEvent("e3", "low", "2024-01-02T10:00:00.000Z"),
        makeEvent("e4", "high", "2024-01-03T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    const context = makeContext({
      from: new Date("2024-01-01T00:00:00.000Z"),
      to: new Date("2024-01-03T23:59:59.000Z"),
    });

    const result = await computeRiskMetrics(context);

    // Should have all days from Jan 1 to Jan 3
    expect(result.trend.length).toBe(3);
    expect(result.trend[0]).toEqual({ date: "2024-01-01", highCriticalCount: 2 });
    expect(result.trend[1]).toEqual({ date: "2024-01-02", highCriticalCount: 0 });
    expect(result.trend[2]).toEqual({ date: "2024-01-03", highCriticalCount: 1 });
  });

  it("computes average by service sorted descending and limited to 10", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "critical", "2024-01-02T10:00:00.000Z", ["svc-a"]),
        makeEvent("e2", "critical", "2024-01-02T11:00:00.000Z", ["svc-a"]),
        makeEvent("e3", "low", "2024-01-03T10:00:00.000Z", ["svc-b"]),
        makeEvent("e4", "low", "2024-01-04T10:00:00.000Z", ["svc-b"]),
        makeEvent("e5", "medium", "2024-01-05T10:00:00.000Z", ["svc-c"]),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeRiskMetrics(makeContext());

    // svc-a: critical(4) + critical(4) / 2 = 4
    // svc-c: medium(2) / 1 = 2
    // svc-b: low(1) + low(1) / 2 = 1
    expect(result.averageByService[0].serviceId).toBe("svc-a");
    expect(result.averageByService[0].averageScore).toBe(4);
    expect(result.averageByService[1].serviceId).toBe("svc-c");
    expect(result.averageByService[1].averageScore).toBe(2);
    expect(result.averageByService[2].serviceId).toBe("svc-b");
    expect(result.averageByService[2].averageScore).toBe(1);
  });

  it("uses service PK pattern when serviceId filter is provided", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "high", "2024-01-02T10:00:00.000Z", ["svc-x"]),
        makeEvent("e2", "medium", "2024-01-03T10:00:00.000Z", ["svc-x"]),
        makeEvent("e3", "low", "2024-01-04T10:00:00.000Z", ["svc-x"]),
      ],
      LastEvaluatedKey: undefined,
    });

    const context = makeContext({ serviceId: "svc-x" });
    const result = await computeRiskMetrics(context);

    // Verify query used the primary key pattern (not GSI2)
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBeUndefined();
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
      "TENANT#tenant-1#SVC#svc-x"
    );
    expect(result.filters.service).toBe("svc-x");
  });

  it("uses GSI2-TeamView when no serviceId filter is provided", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "low", "2024-01-02T10:00:00.000Z"),
        makeEvent("e2", "medium", "2024-01-03T10:00:00.000Z"),
        makeEvent("e3", "high", "2024-01-04T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    await computeRiskMetrics(makeContext());

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe("GSI2-TeamView");
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
      "TENANT#tenant-1#TEAM#UNASSIGNED"
    );
  });

  it("handles pagination with LastEvaluatedKey", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", "low", "2024-01-02T10:00:00.000Z"),
          makeEvent("e2", "medium", "2024-01-03T10:00:00.000Z"),
        ],
        LastEvaluatedKey: { PK: "test", SK: "test" },
      })
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e3", "high", "2024-01-04T10:00:00.000Z"),
        ],
        LastEvaluatedKey: undefined,
      });

    const result = await computeRiskMetrics(makeContext());

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result.distribution).toEqual({ low: 1, medium: 1, high: 1, critical: 0 });
  });

  it("uses team filter in GSI2 key when teamId is provided", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "low", "2024-01-02T10:00:00.000Z", ["svc-1"], "team-alpha"),
        makeEvent("e2", "medium", "2024-01-03T10:00:00.000Z", ["svc-1"], "team-alpha"),
        makeEvent("e3", "high", "2024-01-04T10:00:00.000Z", ["svc-1"], "team-alpha"),
      ],
      LastEvaluatedKey: undefined,
    });

    const context = makeContext({ teamId: "team-alpha" });
    await computeRiskMetrics(context);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
      "TENANT#tenant-1#TEAM#team-alpha"
    );
  });

  it("skips indeterminate risk scores in distribution count", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "low", "2024-01-02T10:00:00.000Z"),
        makeEvent("e2", "indeterminate", "2024-01-03T10:00:00.000Z"),
        makeEvent("e3", undefined, "2024-01-04T10:00:00.000Z"),
        makeEvent("e4", "high", "2024-01-05T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeRiskMetrics(makeContext());

    expect(result.distribution).toEqual({ low: 1, medium: 0, high: 1, critical: 0 });
  });
});
