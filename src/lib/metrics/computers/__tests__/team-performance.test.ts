import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeTeamPerformance } from "../team-performance";
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
    to: new Date("2024-01-15T00:00:00.000Z"),
    ...overrides,
  };
}

function makeTeamConfig(teamId: string, name: string) {
  return {
    PK: "TENANT#tenant-1",
    SK: `TEAM#${teamId}`,
    entityData: {
      teamId,
      name,
      members: ["user-1"],
      archived: false,
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-06-01T00:00:00.000Z",
    },
  };
}

function makeEvent(
  id: string,
  teamId: string,
  createdAt: string,
  riskScore: "low" | "medium" | "high" | "critical" | "indeterminate" | undefined = "low",
  correlatedIncidents?: string[]
) {
  return {
    PK: `TENANT#tenant-1#SVC#svc-1`,
    SK: `DEPLOY#${createdAt}#${id}`,
    eventId: id,
    commitShas: ["sha1"],
    author: "dev1",
    services: ["svc-1"],
    environment: "production",
    teamId,
    riskScore,
    correlatedIncidents,
    createdAt,
    GSI2PK: `TENANT#tenant-1#TEAM#${teamId}`,
    GSI2SK: `DEPLOY#${createdAt}`,
  };
}

describe("computeTeamPerformance", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
      send: mockSend,
    });
  });

  it("returns empty teams when no teams exist", async () => {
    // Query teams - returns empty
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    expect(result.teams).toEqual([]);
    expect(result.orgAverages).toEqual({
      changeFailureRate: 0,
      deploymentFrequency: 0,
    });
    expect(result.sortBy).toBe("changeFailureRate");
    expect(result.sortOrder).toBe("desc");
  });

  it("computes change failure rate per team correctly", async () => {
    // Query teams
    mockSend.mockResolvedValueOnce({
      Items: [
        makeTeamConfig("team-alpha", "Team Alpha"),
        makeTeamConfig("team-beta", "Team Beta"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Alpha events: 2 out of 4 have correlated incidents = 50% CFR
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "high", ["inc-1"]),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z", "medium", ["inc-2"]),
        makeEvent("e4", "team-alpha", "2024-01-05T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Beta events: 1 out of 3 has correlated incidents ≈ 33.33% CFR
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e5", "team-beta", "2024-01-02T10:00:00.000Z", "low", ["inc-3"]),
        makeEvent("e6", "team-beta", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e7", "team-beta", "2024-01-04T10:00:00.000Z", "medium"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    expect(result.teams).toHaveLength(2);
    // Sorted by CFR descending
    expect(result.teams[0].teamId).toBe("team-alpha");
    expect(result.teams[0].changeFailureRate).toBe(50);
    expect(result.teams[1].teamId).toBe("team-beta");
    expect(result.teams[1].changeFailureRate).toBeCloseTo(33.33, 1);
  });

  it("computes deployment frequency per team", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeTeamConfig("team-alpha", "Team Alpha"),
        makeTeamConfig("team-beta", "Team Beta"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Alpha: 5 events
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z"),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z"),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z"),
        makeEvent("e4", "team-alpha", "2024-01-05T10:00:00.000Z"),
        makeEvent("e5", "team-alpha", "2024-01-06T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Beta: 3 events
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e6", "team-beta", "2024-01-02T10:00:00.000Z"),
        makeEvent("e7", "team-beta", "2024-01-03T10:00:00.000Z"),
        makeEvent("e8", "team-beta", "2024-01-04T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    const teamAlpha = result.teams.find((t) => t.teamId === "team-alpha");
    const teamBeta = result.teams.find((t) => t.teamId === "team-beta");

    expect(teamAlpha?.deploymentFrequency).toBe(5);
    expect(teamBeta?.deploymentFrequency).toBe(3);
  });

  it("computes risk profile per team", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeTeamConfig("team-alpha", "Team Alpha")],
      LastEvaluatedKey: undefined,
    });

    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "low"),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z", "medium"),
        makeEvent("e4", "team-alpha", "2024-01-05T10:00:00.000Z", "high"),
        makeEvent("e5", "team-alpha", "2024-01-06T10:00:00.000Z", "critical"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    expect(result.teams[0].riskProfile).toEqual({
      low: 2,
      medium: 1,
      high: 1,
      critical: 1,
    });
  });

  it("marks teams with insufficient data (< 3 events)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeTeamConfig("team-alpha", "Team Alpha"),
        makeTeamConfig("team-beta", "Team Beta"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Alpha: 2 events (insufficient)
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "high", ["inc-1"]),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Beta: 4 events (sufficient)
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e3", "team-beta", "2024-01-02T10:00:00.000Z", "low"),
        makeEvent("e4", "team-beta", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e5", "team-beta", "2024-01-04T10:00:00.000Z", "medium"),
        makeEvent("e6", "team-beta", "2024-01-05T10:00:00.000Z", "high", ["inc-2"]),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    const teamAlpha = result.teams.find((t) => t.teamId === "team-alpha");
    const teamBeta = result.teams.find((t) => t.teamId === "team-beta");

    expect(teamAlpha?.insufficientData).toBe(true);
    expect(teamAlpha?.changeFailureRate).toBe(0); // CFR is 0 when insufficient
    expect(teamBeta?.insufficientData).toBe(false);
    expect(teamBeta?.changeFailureRate).toBe(25); // 1/4 = 25%
  });

  it("sorts teams by changeFailureRate descending by default", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeTeamConfig("team-alpha", "Team Alpha"),
        makeTeamConfig("team-beta", "Team Beta"),
        makeTeamConfig("team-gamma", "Team Gamma"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Alpha: 1/3 = 33.3% CFR
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "low", ["inc-1"]),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Beta: 3/4 = 75% CFR
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e4", "team-beta", "2024-01-02T10:00:00.000Z", "high", ["inc-2"]),
        makeEvent("e5", "team-beta", "2024-01-03T10:00:00.000Z", "high", ["inc-3"]),
        makeEvent("e6", "team-beta", "2024-01-04T10:00:00.000Z", "medium", ["inc-4"]),
        makeEvent("e7", "team-beta", "2024-01-05T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Gamma: 0/3 = 0% CFR
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e8", "team-gamma", "2024-01-02T10:00:00.000Z", "low"),
        makeEvent("e9", "team-gamma", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e10", "team-gamma", "2024-01-04T10:00:00.000Z", "medium"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    expect(result.teams[0].teamId).toBe("team-beta"); // 75%
    expect(result.teams[1].teamId).toBe("team-alpha"); // 33.3%
    expect(result.teams[2].teamId).toBe("team-gamma"); // 0%
  });

  it("computes org averages when no team filter is active", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeTeamConfig("team-alpha", "Team Alpha"),
        makeTeamConfig("team-beta", "Team Beta"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Alpha: 1/4 = 25% CFR, 4 deploys
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "high", ["inc-1"]),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z", "low"),
        makeEvent("e4", "team-alpha", "2024-01-05T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Beta: 1/3 ≈ 33.33% CFR, 3 deploys
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e5", "team-beta", "2024-01-02T10:00:00.000Z", "medium", ["inc-2"]),
        makeEvent("e6", "team-beta", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e7", "team-beta", "2024-01-04T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    expect(result.orgAverages).toBeDefined();
    // Avg CFR: (25 + 33.33) / 2 ≈ 29.17
    expect(result.orgAverages!.changeFailureRate).toBeCloseTo(29.17, 1);
    // Avg frequency: (4 + 3) / 2 = 3.5
    expect(result.orgAverages!.deploymentFrequency).toBe(3.5);
  });

  it("returns only filtered team with org averages when teamId is set", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeTeamConfig("team-alpha", "Team Alpha"),
        makeTeamConfig("team-beta", "Team Beta"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Alpha: 50% CFR
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "high", ["inc-1"]),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "high", ["inc-2"]),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z", "low"),
        makeEvent("e4", "team-alpha", "2024-01-05T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Team Beta: 0% CFR
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e5", "team-beta", "2024-01-02T10:00:00.000Z", "low"),
        makeEvent("e6", "team-beta", "2024-01-03T10:00:00.000Z", "low"),
        makeEvent("e7", "team-beta", "2024-01-04T10:00:00.000Z", "medium"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext({ teamId: "team-alpha" }));

    // Should only have team-alpha in result
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].teamId).toBe("team-alpha");
    expect(result.teams[0].changeFailureRate).toBe(50);

    // Should still have org averages for comparison
    expect(result.orgAverages).toBeDefined();
    // Avg CFR: (50 + 0) / 2 = 25
    expect(result.orgAverages!.changeFailureRate).toBe(25);
  });

  it("uses correct query patterns for config and events", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeTeamConfig("team-alpha", "Team Alpha")],
      LastEvaluatedKey: undefined,
    });

    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z"),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z"),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    await computeTeamPerformance(makeContext());

    // First call: query teams from config table
    const configQuery = mockSend.mock.calls[0][0].input;
    expect(configQuery.TableName).toBe("ollinai-config");
    expect(configQuery.ExpressionAttributeValues[":pk"]).toBe("TENANT#tenant-1");
    expect(configQuery.ExpressionAttributeValues[":skPrefix"]).toBe("TEAM#");

    // Second call: query events for team from GSI2-TeamView
    const eventsQuery = mockSend.mock.calls[1][0].input;
    expect(eventsQuery.TableName).toBe("ollinai-events");
    expect(eventsQuery.IndexName).toBe("GSI2-TeamView");
    expect(eventsQuery.ExpressionAttributeValues[":pk"]).toBe(
      "TENANT#tenant-1#TEAM#team-alpha"
    );
  });

  it("handles pagination for team queries", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [makeTeamConfig("team-alpha", "Team Alpha")],
        LastEvaluatedKey: { PK: "test", SK: "test" },
      })
      .mockResolvedValueOnce({
        Items: [makeTeamConfig("team-beta", "Team Beta")],
        LastEvaluatedKey: undefined,
      })
      // Team Alpha events
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z"),
          makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z"),
          makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z"),
        ],
        LastEvaluatedKey: undefined,
      })
      // Team Beta events
      .mockResolvedValueOnce({
        Items: [
          makeEvent("e4", "team-beta", "2024-01-02T10:00:00.000Z"),
          makeEvent("e5", "team-beta", "2024-01-03T10:00:00.000Z"),
          makeEvent("e6", "team-beta", "2024-01-04T10:00:00.000Z"),
        ],
        LastEvaluatedKey: undefined,
      });

    const result = await computeTeamPerformance(makeContext());

    expect(result.teams).toHaveLength(2);
  });

  it("handles events with empty correlatedIncidents array as non-failures", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeTeamConfig("team-alpha", "Team Alpha")],
      LastEvaluatedKey: undefined,
    });

    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "high", []),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "low", []),
        makeEvent("e3", "team-alpha", "2024-01-04T10:00:00.000Z", "low", undefined),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    // Empty arrays should not count as failures
    expect(result.teams[0].changeFailureRate).toBe(0);
  });

  it("includes period in response", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    expect(result.period.start).toBe("2024-01-01T00:00:00.000Z");
    expect(result.period.end).toBe("2024-01-15T00:00:00.000Z");
  });

  it("skips indeterminate risk scores in risk profile", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeTeamConfig("team-alpha", "Team Alpha")],
      LastEvaluatedKey: undefined,
    });

    // Create an event with no riskScore property to simulate undefined
    const eventWithNoRisk = {
      PK: "TENANT#tenant-1#SVC#svc-1",
      SK: "DEPLOY#2024-01-04T10:00:00.000Z#e3",
      eventId: "e3",
      commitShas: ["sha1"],
      author: "dev1",
      services: ["svc-1"],
      environment: "production",
      teamId: "team-alpha",
      createdAt: "2024-01-04T10:00:00.000Z",
      GSI2PK: "TENANT#tenant-1#TEAM#team-alpha",
      GSI2SK: "DEPLOY#2024-01-04T10:00:00.000Z",
    };

    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", "team-alpha", "2024-01-02T10:00:00.000Z", "low"),
        makeEvent("e2", "team-alpha", "2024-01-03T10:00:00.000Z", "indeterminate"),
        eventWithNoRisk,
        makeEvent("e4", "team-alpha", "2024-01-05T10:00:00.000Z", "high"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeTeamPerformance(makeContext());

    expect(result.teams[0].riskProfile).toEqual({
      low: 1,
      medium: 0,
      high: 1,
      critical: 0,
    });
  });
});
