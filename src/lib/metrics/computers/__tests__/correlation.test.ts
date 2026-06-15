import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeCorrelationMetrics } from "../correlation";
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
    from: new Date("2024-01-08T00:00:00.000Z"),
    to: new Date("2024-01-15T00:00:00.000Z"),
    ...overrides,
  };
}

function makeIncident(
  id: string,
  correlationStatus: "correlated" | "uncorrelated" | "pending",
  detectionTimestamp: string,
  resolutionTimestamp?: string
) {
  return {
    PK: `TENANT#tenant-1#SVC#svc-1`,
    SK: `INC#${detectionTimestamp}#${id}`,
    incidentId: id,
    externalId: `ext-${id}`,
    severity: "high" as const,
    detectionTimestamp,
    resolutionTimestamp,
    correlationStatus,
    correlatedDeployments: correlationStatus === "correlated" ? ["deploy-1"] : undefined,
    GSI1PK: "TENANT#tenant-1",
    GSI1SK: `INC#${detectionTimestamp}`,
  };
}

describe("computeCorrelationMetrics", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
      send: mockSend,
    });
  });

  it("returns zero values and note when no incidents exist", async () => {
    // Current period - no incidents
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeCorrelationMetrics(makeContext());

    expect(result.correlationRate).toBe(0);
    expect(result.averageTimeToCorrelation).toBe(0);
    expect(result.uncorrelatedCount).toBe(0);
    expect(result.note).toBe("No incidents in selected period");
    expect(result.correlationRateTrend.direction).toBe("stable");
    expect(result.uncorrelatedTrend.direction).toBe("stable");
  });

  it("computes correlation rate correctly", async () => {
    // Current period: 3 correlated, 1 uncorrelated, 1 pending = 3/5 = 60%
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "correlated", "2024-01-09T10:00:00.000Z"),
        makeIncident("inc-2", "correlated", "2024-01-10T10:00:00.000Z"),
        makeIncident("inc-3", "correlated", "2024-01-11T10:00:00.000Z"),
        makeIncident("inc-4", "uncorrelated", "2024-01-12T10:00:00.000Z"),
        makeIncident("inc-5", "pending", "2024-01-13T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });
    // Previous period - empty for trend
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeCorrelationMetrics(makeContext());

    expect(result.correlationRate).toBe(60);
  });

  it("computes uncorrelated count correctly", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "correlated", "2024-01-09T10:00:00.000Z"),
        makeIncident("inc-2", "uncorrelated", "2024-01-10T10:00:00.000Z"),
        makeIncident("inc-3", "uncorrelated", "2024-01-11T10:00:00.000Z"),
        makeIncident("inc-4", "pending", "2024-01-12T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeCorrelationMetrics(makeContext());

    expect(result.uncorrelatedCount).toBe(2);
  });

  it("returns 30 seconds as average time-to-correlation placeholder", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "correlated", "2024-01-09T10:00:00.000Z"),
        makeIncident("inc-2", "correlated", "2024-01-10T10:00:00.000Z"),
        makeIncident("inc-3", "uncorrelated", "2024-01-11T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeCorrelationMetrics(makeContext());

    expect(result.averageTimeToCorrelation).toBe(30);
  });

  it("returns 0 for average time-to-correlation when no incidents are correlated", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "uncorrelated", "2024-01-09T10:00:00.000Z"),
        makeIncident("inc-2", "uncorrelated", "2024-01-10T10:00:00.000Z"),
        makeIncident("inc-3", "pending", "2024-01-11T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeCorrelationMetrics(makeContext());

    expect(result.averageTimeToCorrelation).toBe(0);
  });

  it("computes trend indicators comparing current to previous period", async () => {
    // Current period: 4 total, 3 correlated, 1 uncorrelated → 75% rate
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "correlated", "2024-01-09T10:00:00.000Z"),
        makeIncident("inc-2", "correlated", "2024-01-10T10:00:00.000Z"),
        makeIncident("inc-3", "correlated", "2024-01-11T10:00:00.000Z"),
        makeIncident("inc-4", "uncorrelated", "2024-01-12T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });
    // Previous period: 4 total, 1 correlated, 3 uncorrelated → 25% rate
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-a", "correlated", "2024-01-02T10:00:00.000Z"),
        makeIncident("inc-b", "uncorrelated", "2024-01-03T10:00:00.000Z"),
        makeIncident("inc-c", "uncorrelated", "2024-01-04T10:00:00.000Z"),
        makeIncident("inc-d", "uncorrelated", "2024-01-05T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeCorrelationMetrics(makeContext());

    // Correlation rate: 75% vs 25% → >10% improvement → "improving"
    expect(result.correlationRateTrend.direction).toBe("improving");
    // Uncorrelated: 1 vs 3 → >10% decrease → "improving" (lower is better)
    expect(result.uncorrelatedTrend.direction).toBe("improving");
  });

  it("uses correct GSI1-TimeRange query pattern", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    await computeCorrelationMetrics(makeContext());

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.TableName).toBe("ollinai-incidents");
    expect(queryInput.IndexName).toBe("GSI1-TimeRange");
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe("TENANT#tenant-1");
    expect(queryInput.ExpressionAttributeValues[":skFrom"]).toBe(
      "INC#2024-01-08T00:00:00.000Z"
    );
    expect(queryInput.ExpressionAttributeValues[":skTo"]).toBe(
      "INC#2024-01-15T00:00:00.000Z"
    );
  });

  it("queries previous period with same duration as current period", async () => {
    // Current period: Jan 8 - Jan 15 (7 days)
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "correlated", "2024-01-09T10:00:00.000Z"),
        makeIncident("inc-2", "uncorrelated", "2024-01-10T10:00:00.000Z"),
        makeIncident("inc-3", "pending", "2024-01-11T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });
    // Previous period query
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    await computeCorrelationMetrics(makeContext());

    // Previous period should be Jan 1 - Jan 8 (same 7-day duration)
    const previousQueryInput = mockSend.mock.calls[1][0].input;
    expect(previousQueryInput.ExpressionAttributeValues[":skFrom"]).toBe(
      "INC#2024-01-01T00:00:00.000Z"
    );
    expect(previousQueryInput.ExpressionAttributeValues[":skTo"]).toBe(
      "INC#2024-01-08T00:00:00.000Z"
    );
  });

  it("includes period and filters in response", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "correlated", "2024-01-09T10:00:00.000Z"),
        makeIncident("inc-2", "correlated", "2024-01-10T10:00:00.000Z"),
        makeIncident("inc-3", "correlated", "2024-01-11T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const context = makeContext({ teamId: "team-alpha", serviceId: "svc-x" });
    const result = await computeCorrelationMetrics(context);

    expect(result.period.start).toBe("2024-01-08T00:00:00.000Z");
    expect(result.period.end).toBe("2024-01-15T00:00:00.000Z");
    expect(result.filters.team).toBe("team-alpha");
    expect(result.filters.service).toBe("svc-x");
  });

  it("handles pagination with LastEvaluatedKey", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeIncident("inc-1", "correlated", "2024-01-09T10:00:00.000Z"),
        ],
        LastEvaluatedKey: { PK: "test", SK: "test" },
      })
      .mockResolvedValueOnce({
        Items: [
          makeIncident("inc-2", "correlated", "2024-01-10T10:00:00.000Z"),
          makeIncident("inc-3", "uncorrelated", "2024-01-11T10:00:00.000Z"),
        ],
        LastEvaluatedKey: undefined,
      })
      // Previous period
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeCorrelationMetrics(makeContext());

    // Should have processed all 3 incidents across pages
    expect(result.correlationRate).toBeCloseTo(66.67, 1);
    expect(result.uncorrelatedCount).toBe(1);
  });
});
