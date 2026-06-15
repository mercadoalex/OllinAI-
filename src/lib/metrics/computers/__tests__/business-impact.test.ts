import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeBusinessImpact } from "../business-impact";
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

function makeContext(
  overrides?: Partial<MetricComputeContext>
): MetricComputeContext {
  return {
    tenantId: "tenant-1",
    from: new Date("2024-01-01T00:00:00.000Z"),
    to: new Date("2024-01-07T00:00:00.000Z"),
    ...overrides,
  };
}

function makeEvent(
  id: string,
  opts: {
    predictionScore?: number;
    riskScore?: "low" | "medium" | "high" | "critical";
    createdAt?: string;
    teamId?: string;
  } = {}
) {
  const createdAt = opts.createdAt || "2024-01-03T10:00:00.000Z";
  const teamId = opts.teamId || "UNASSIGNED";
  return {
    PK: `TENANT#tenant-1#SVC#svc-1`,
    SK: `DEPLOY#${createdAt}#${id}`,
    eventId: id,
    commitShas: ["sha1"],
    author: "dev1",
    services: ["svc-1"],
    environment: "production",
    teamId,
    riskScore: opts.riskScore || "medium",
    predictionScore: opts.predictionScore,
    createdAt,
    GSI2PK: `TENANT#tenant-1#TEAM#${teamId}`,
    GSI2SK: `DEPLOY#${createdAt}`,
  };
}

function makeIncident(
  id: string,
  opts: {
    severity?: "low" | "medium" | "high" | "critical";
    detectionTimestamp?: string;
    resolutionTimestamp?: string;
  } = {}
) {
  const detection =
    opts.detectionTimestamp || "2024-01-03T10:00:00.000Z";
  return {
    PK: `TENANT#tenant-1#SVC#svc-1`,
    SK: `INC#${detection}#${id}`,
    incidentId: id,
    externalId: `ext-${id}`,
    severity: opts.severity || "critical",
    detectionTimestamp: detection,
    resolutionTimestamp: opts.resolutionTimestamp,
    correlationStatus: "correlated" as const,
    GSI1PK: `TENANT#tenant-1`,
    GSI1SK: `INC#${detection}`,
  };
}

function makeMetricsItem(mttrHours: number) {
  return {
    PK: "TENANT#tenant-1#SCOPE#ALL#ALL",
    SK: "PERIOD#2024-01-01#2024-01-07",
    deploymentFrequency: 10,
    leadTimeHours: 2,
    changeFailureRate: 15,
    mttrHours,
    unresolvedCount: 0,
    dataPoints: 10,
    computedAt: "2024-01-07T00:00:00.000Z",
  };
}

describe("computeBusinessImpact", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
      send: mockSend,
    });
  });

  it("returns zero downtime avoided when no blocked high-risk deploys exist", async () => {
    // Events query (current period)
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", { predictionScore: 0.5, riskScore: "low" }),
          makeEvent("e2", { predictionScore: 0.3, riskScore: "high" }),
        ],
        LastEvaluatedKey: undefined,
      })
      // Incidents query (current period)
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      // MTTR query
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(3)],
        LastEvaluatedKey: undefined,
      })
      // Previous incidents query
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    expect(result.estimatedDowntimeAvoided).toBe(0);
    expect(result.notes?.downtimeAvoided).toBe(
      "No deployments blocked in this period"
    );
  });

  it("computes downtime avoided = blocked high-risk deploys × average MTTR", async () => {
    // 2 events with predictionScore > 0.8 AND riskScore high/critical
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", { predictionScore: 0.9, riskScore: "critical" }),
          makeEvent("e2", { predictionScore: 0.85, riskScore: "high" }),
          makeEvent("e3", { predictionScore: 0.9, riskScore: "low" }), // blocked but low risk
          makeEvent("e4", { predictionScore: 0.5, riskScore: "critical" }), // not blocked
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      // MTTR = 3 hours
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(3)],
        LastEvaluatedKey: undefined,
      })
      // Previous incidents
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // 2 blocked high-risk × 3 hours = 6 hours
    expect(result.estimatedDowntimeAvoided).toBe(6);
  });

  it("uses default MTTR of 2 hours when no metrics data available", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", { predictionScore: 0.9, riskScore: "high" }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      // No metrics available
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // 1 blocked high-risk × 2 hours (default) = 2 hours
    expect(result.estimatedDowntimeAvoided).toBe(2);
  });

  it("returns 100% SLA compliance when no critical incidents exist", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      // No incidents
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(2)],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    expect(result.slaCompliancePercentage).toBe(100);
    expect(result.notes?.slaCompliance).toContain("No critical incidents");
  });

  it("computes SLA compliance correctly with a single resolved critical incident", async () => {
    // Period: Jan 1 to Jan 7 = 6 days = 8640 minutes
    // Critical incident: Jan 3 10:00 to Jan 3 12:00 = 120 minutes downtime
    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [
          makeIncident("inc-1", {
            severity: "critical",
            detectionTimestamp: "2024-01-03T10:00:00.000Z",
            resolutionTimestamp: "2024-01-03T12:00:00.000Z",
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(2)],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // Total period = 6 days = 8640 min; downtime = 120 min
    // SLA = (8640 - 120) / 8640 × 100 ≈ 98.61%
    expect(result.slaCompliancePercentage).toBeCloseTo(98.61, 1);
  });

  it("caps unresolved incidents at period end for SLA calculation", async () => {
    // Period: Jan 1 to Jan 7
    // Unresolved critical incident detected Jan 5
    // Should cap at Jan 7 → 2 days downtime = 2880 min
    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [
          makeIncident("inc-1", {
            severity: "critical",
            detectionTimestamp: "2024-01-05T00:00:00.000Z",
            resolutionTimestamp: undefined,
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(2)],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // Total = 8640 min; downtime = 2 days = 2880 min
    // SLA = (8640 - 2880) / 8640 × 100 ≈ 66.67%
    expect(result.slaCompliancePercentage).toBeCloseTo(66.67, 1);
  });

  it("merges overlapping critical incident windows for SLA calculation", async () => {
    // Period: Jan 1 to Jan 7
    // Inc-1: Jan 3 10:00 - Jan 3 14:00 (4 hours)
    // Inc-2: Jan 3 12:00 - Jan 3 16:00 (4 hours, overlaps with inc-1)
    // Merged: Jan 3 10:00 - Jan 3 16:00 (6 hours = 360 min)
    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [
          makeIncident("inc-1", {
            severity: "critical",
            detectionTimestamp: "2024-01-03T10:00:00.000Z",
            resolutionTimestamp: "2024-01-03T14:00:00.000Z",
          }),
          makeIncident("inc-2", {
            severity: "critical",
            detectionTimestamp: "2024-01-03T12:00:00.000Z",
            resolutionTimestamp: "2024-01-03T16:00:00.000Z",
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(2)],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // Total = 8640 min; downtime = 360 min (6 hours merged)
    // SLA = (8640 - 360) / 8640 × 100 ≈ 95.83%
    expect(result.slaCompliancePercentage).toBeCloseTo(95.83, 1);
  });

  it("ignores non-critical incidents in SLA calculation", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [
          makeIncident("inc-1", {
            severity: "high",
            detectionTimestamp: "2024-01-03T10:00:00.000Z",
            resolutionTimestamp: "2024-01-03T22:00:00.000Z",
          }),
          makeIncident("inc-2", {
            severity: "medium",
            detectionTimestamp: "2024-01-04T10:00:00.000Z",
            resolutionTimestamp: "2024-01-04T22:00:00.000Z",
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(2)],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // No critical incidents → 100% SLA
    expect(result.slaCompliancePercentage).toBe(100);
  });

  it("computes incident trend (lower is better)", async () => {
    // Current period: 3 incidents
    // Previous period: 6 incidents → >10% decrease → improving
    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [
          makeIncident("inc-1"),
          makeIncident("inc-2", {
            detectionTimestamp: "2024-01-04T10:00:00.000Z",
          }),
          makeIncident("inc-3", {
            detectionTimestamp: "2024-01-05T10:00:00.000Z",
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(2)],
        LastEvaluatedKey: undefined,
      })
      // Previous period: 6 incidents
      .mockResolvedValueOnce({
        Items: [
          makeIncident("p1"),
          makeIncident("p2"),
          makeIncident("p3"),
          makeIncident("p4"),
          makeIncident("p5"),
          makeIncident("p6"),
        ],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // 3 vs 6 → -50% change → lower is better → "improving"
    expect(result.incidentTrend.direction).toBe("improving");
  });

  it("computes incident trend degrading when incidents increase", async () => {
    // Current period: 8 incidents
    // Previous period: 3 incidents → increase > 10% → degrading
    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: Array.from({ length: 8 }, (_, i) =>
          makeIncident(`inc-${i}`, {
            detectionTimestamp: `2024-01-0${(i % 6) + 1}T10:00:00.000Z`,
          })
        ),
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeMetricsItem(2)],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeIncident("p1"), makeIncident("p2"), makeIncident("p3")],
        LastEvaluatedKey: undefined,
      });

    const result = await computeBusinessImpact(makeContext());

    // 8 vs 3 → >10% increase → lower is better → "degrading"
    expect(result.incidentTrend.direction).toBe("degrading");
  });

  it("includes period and filters in response", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await computeBusinessImpact(
      makeContext({ teamId: "team-x", serviceId: "svc-y" })
    );

    expect(result.period.start).toBe("2024-01-01T00:00:00.000Z");
    expect(result.period.end).toBe("2024-01-07T00:00:00.000Z");
    expect(result.filters.team).toBe("team-x");
    expect(result.filters.service).toBe("svc-y");
  });

  it("uses team filter in GSI2 key when teamId is provided", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await computeBusinessImpact(makeContext({ teamId: "team-alpha" }));

    // First call is the events query with GSI2
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
      "TENANT#tenant-1#TEAM#team-alpha"
    );
  });
});
