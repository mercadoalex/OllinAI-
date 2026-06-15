import { describe, it, expect, vi, beforeEach } from "vitest";
import { computePredictions } from "../predictions";
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
    correlatedIncidents?: string[];
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
    correlatedIncidents: opts.correlatedIncidents,
    createdAt,
    GSI2PK: `TENANT#tenant-1#TEAM#${teamId}`,
    GSI2SK: `DEPLOY#${createdAt}`,
  };
}

describe("computePredictions", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
      send: mockSend,
    });
  });

  it("returns ml_inactive when no events have predictionScore", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", { predictionScore: undefined }),
        makeEvent("e2", { predictionScore: undefined }),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computePredictions(makeContext());

    expect(result.predictionAccuracy).toBe("ml_inactive");
    expect(result.falsePositiveRate).toBe("ml_inactive");
    expect(result.blockedCount).toBe(0);
    expect(result.warnedCount).toBe(0);
    expect(result.earlyWarningCount).toBe(0);
    expect(result.note).toContain("ML model inactive");
  });

  it("returns ml_inactive when all events have no prediction score (empty list)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computePredictions(makeContext());

    expect(result.predictionAccuracy).toBe("ml_inactive");
    expect(result.falsePositiveRate).toBe("ml_inactive");
  });

  it("computes prediction accuracy correctly (true positives + true negatives)", async () => {
    // 4 events with predictions:
    // e1: score=0.9 (predicted incident), has correlatedIncidents → TP
    // e2: score=0.7 (predicted incident), NO correlatedIncidents → FP
    // e3: score=0.3 (predicted no incident), NO correlatedIncidents → TN
    // e4: score=0.2 (predicted no incident), has correlatedIncidents → FN
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", {
            predictionScore: 0.9,
            correlatedIncidents: ["inc-1"],
          }),
          makeEvent("e2", {
            predictionScore: 0.7,
            correlatedIncidents: [],
          }),
          makeEvent("e3", {
            predictionScore: 0.3,
            correlatedIncidents: undefined,
          }),
          makeEvent("e4", {
            predictionScore: 0.2,
            correlatedIncidents: ["inc-2"],
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      // Previous period query (for trend)
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    // TP=1, TN=1, FP=1, FN=1 → accuracy = (1+1)/4 × 100 = 50%
    expect(result.predictionAccuracy).toBe(50);
  });

  it("computes false positive rate correctly", async () => {
    // Events above threshold (>= 0.5):
    // e1: score=0.9, has correlatedIncidents → NOT FP
    // e2: score=0.7, NO correlatedIncidents → FP
    // e3: score=0.6, NO correlatedIncidents → FP
    // Events below threshold:
    // e4: score=0.3, no incidents → not counted
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", {
            predictionScore: 0.9,
            correlatedIncidents: ["inc-1"],
          }),
          makeEvent("e2", {
            predictionScore: 0.7,
            correlatedIncidents: [],
          }),
          makeEvent("e3", {
            predictionScore: 0.6,
            correlatedIncidents: undefined,
          }),
          makeEvent("e4", {
            predictionScore: 0.3,
            correlatedIncidents: undefined,
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    // 3 events above threshold, 2 of them are false positives
    // FPR = 2/3 × 100 ≈ 66.67%
    expect(result.falsePositiveRate).toBeCloseTo(66.67, 1);
  });

  it("computes blocked count (predictionScore > 0.8)", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", { predictionScore: 0.9 }),
          makeEvent("e2", { predictionScore: 0.85 }),
          makeEvent("e3", { predictionScore: 0.8 }), // NOT blocked (not > 0.8)
          makeEvent("e4", { predictionScore: 0.5 }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    expect(result.blockedCount).toBe(2);
  });

  it("computes warned count (predictionScore between 0.5 and 0.8 inclusive)", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", { predictionScore: 0.9 }), // blocked, not warned
          makeEvent("e2", { predictionScore: 0.8 }), // warned (0.5 <= x <= 0.8)
          makeEvent("e3", { predictionScore: 0.6 }), // warned
          makeEvent("e4", { predictionScore: 0.5 }), // warned
          makeEvent("e5", { predictionScore: 0.4 }), // below threshold
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    expect(result.warnedCount).toBe(3);
  });

  it("computes early warning count (predictionScore > 0.6)", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", { predictionScore: 0.9 }),
          makeEvent("e2", { predictionScore: 0.7 }),
          makeEvent("e3", { predictionScore: 0.6 }), // NOT > 0.6
          makeEvent("e4", { predictionScore: 0.3 }),
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    expect(result.earlyWarningCount).toBe(2);
  });

  it("computes trend indicators when previous period has data", async () => {
    // Current period: accuracy=80%, FPR=20%
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", {
            predictionScore: 0.9,
            correlatedIncidents: ["inc-1"],
          }),
          makeEvent("e2", {
            predictionScore: 0.7,
            correlatedIncidents: ["inc-2"],
          }),
          makeEvent("e3", {
            predictionScore: 0.3,
            correlatedIncidents: undefined,
          }),
          makeEvent("e4", {
            predictionScore: 0.2,
            correlatedIncidents: undefined,
          }),
          makeEvent("e5", {
            predictionScore: 0.8,
            correlatedIncidents: undefined,
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      // Previous period: accuracy=40%, FPR=75%
      .mockResolvedValueOnce({
        Items: [
          makeEvent("p1", {
            predictionScore: 0.9,
            correlatedIncidents: undefined,
          }),
          makeEvent("p2", {
            predictionScore: 0.7,
            correlatedIncidents: undefined,
          }),
          makeEvent("p3", {
            predictionScore: 0.3,
            correlatedIncidents: ["inc-3"],
          }),
          makeEvent("p4", {
            predictionScore: 0.2,
            correlatedIncidents: undefined,
          }),
        ],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    // Accuracy improved (higher is better) → should be "improving"
    expect(result.predictionAccuracyTrend).toBeDefined();
    expect(result.predictionAccuracyTrend!.direction).toBe("improving");

    // FPR decreased (lower is better) → should be "improving"
    expect(result.falsePositiveRateTrend).toBeDefined();
    expect(result.falsePositiveRateTrend!.direction).toBe("improving");
  });

  it("does not include trend indicators when previous period has no predictions", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", {
            predictionScore: 0.9,
            correlatedIncidents: ["inc-1"],
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      // Previous period: no events with predictions
      .mockResolvedValueOnce({
        Items: [makeEvent("p1", { predictionScore: undefined })],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    expect(result.predictionAccuracyTrend).toBeUndefined();
    expect(result.falsePositiveRateTrend).toBeUndefined();
  });

  it("uses team filter in GSI2 key when teamId is provided", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    await computePredictions(makeContext({ teamId: "team-alpha" }));

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(
      "TENANT#tenant-1#TEAM#team-alpha"
    );
  });

  it("includes period and filters in response", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", { predictionScore: 0.5 }),
      ],
      LastEvaluatedKey: undefined,
    }).mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computePredictions(
      makeContext({ teamId: "team-x", serviceId: "svc-y" })
    );

    expect(result.period.start).toBe("2024-01-01T00:00:00.000Z");
    expect(result.period.end).toBe("2024-01-07T00:00:00.000Z");
    expect(result.filters.team).toBe("team-x");
    expect(result.filters.service).toBe("svc-y");
  });

  it("handles pagination with LastEvaluatedKey", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", {
            predictionScore: 0.9,
            correlatedIncidents: ["inc-1"],
          }),
        ],
        LastEvaluatedKey: { PK: "test", SK: "test" },
      })
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e2", {
            predictionScore: 0.3,
            correlatedIncidents: undefined,
          }),
        ],
        LastEvaluatedKey: undefined,
      })
      // Previous period
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

    const result = await computePredictions(makeContext());

    // Both paginated items should be included
    // e1: TP, e2: TN → accuracy = 100%
    expect(result.predictionAccuracy).toBe(100);
  });
});
