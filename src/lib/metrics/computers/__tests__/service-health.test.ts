import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeServiceHealth } from "../service-health";
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

function makeEvent(
  id: string,
  services: string[],
  createdAt: string,
  riskScore: "low" | "medium" | "high" | "critical" | "indeterminate" | undefined = "low",
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

function makeServiceConfig(serviceId: string, name: string) {
  return {
    PK: "TENANT#tenant-1",
    SK: `SVC#${serviceId}`,
    entityData: {
      serviceId,
      name,
      owningTeamId: "team-1",
      ownershipHistory: [],
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-06-01T00:00:00.000Z",
    },
  };
}

function makeMetricsItem(serviceId: string, dataPoints: number = 10) {
  return {
    PK: `TENANT#tenant-1#SCOPE#SERVICE#${serviceId}`,
    SK: "PERIOD#2024-01-01#2024-01-15",
    deploymentFrequency: 12,
    leadTimeHours: 4.5,
    changeFailureRate: 15,
    mttrHours: 2.3,
    unresolvedCount: 1,
    dataPoints,
    computedAt: "2024-01-15T00:00:00.000Z",
  };
}

function makeIncident(
  id: string,
  detectionTimestamp: string,
  correlatedDeployments?: string[],
  resolutionTimestamp?: string
) {
  return {
    PK: "TENANT#tenant-1#SVC#svc-1",
    SK: `INC#${detectionTimestamp}#${id}`,
    incidentId: id,
    externalId: `ext-${id}`,
    severity: "high" as const,
    detectionTimestamp,
    resolutionTimestamp,
    correlatedDeployments,
    correlationStatus: correlatedDeployments ? "correlated" as const : "uncorrelated" as const,
    GSI1PK: "TENANT#tenant-1",
    GSI1SK: `INC#${detectionTimestamp}`,
  };
}

describe("computeServiceHealth", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
      send: mockSend,
    });
    // Mock Date.now for the 7-day window calculation
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T00:00:00.000Z"));
  });

  it("identifies services at risk from last 7 days events", async () => {
    // Step 1: Query recent events (last 7 days)
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", ["svc-api"], "2024-01-10T10:00:00.000Z", "high"),
        makeEvent("e2", ["svc-api"], "2024-01-12T10:00:00.000Z", "critical"),
        makeEvent("e3", ["svc-web"], "2024-01-11T10:00:00.000Z", "high"),
        makeEvent("e4", ["svc-db"], "2024-01-09T10:00:00.000Z", "low"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Step 2: Query services from config
    mockSend.mockResolvedValueOnce({
      Items: [
        makeServiceConfig("svc-api", "API Service"),
        makeServiceConfig("svc-web", "Web Service"),
        makeServiceConfig("svc-db", "DB Service"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Step 3: Query metrics for each service
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-api")], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-web")], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-db")], LastEvaluatedKey: undefined });

    // Step 4: Query incidents for blast radius
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Step 5: Query events for context time range (for blast radius)
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeServiceHealth(makeContext());

    // svc-api has 2 high/critical events, svc-web has 1
    expect(result.servicesAtRisk).toHaveLength(2);
    expect(result.servicesAtRisk[0].serviceId).toBe("svc-api");
    expect(result.servicesAtRisk[0].highCriticalCount).toBe(2);
    expect(result.servicesAtRisk[0].mostRecentRiskScore).toBe("critical");
    expect(result.servicesAtRisk[1].serviceId).toBe("svc-web");
    expect(result.servicesAtRisk[1].highCriticalCount).toBe(1);
  });

  it("returns service metrics from pre-computed DORA data", async () => {
    // Recent events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Services config
    mockSend.mockResolvedValueOnce({
      Items: [
        makeServiceConfig("svc-api", "API Service"),
        makeServiceConfig("svc-web", "Web Service"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Metrics for svc-api (sufficient data)
    mockSend.mockResolvedValueOnce({
      Items: [makeMetricsItem("svc-api", 10)],
      LastEvaluatedKey: undefined,
    });

    // Metrics for svc-web (insufficient data)
    mockSend.mockResolvedValueOnce({
      Items: [makeMetricsItem("svc-web", 2)],
      LastEvaluatedKey: undefined,
    });

    // Incidents
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Context events for blast radius
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeServiceHealth(makeContext());

    expect(result.serviceMetrics).toHaveLength(2);

    const apiMetrics = result.serviceMetrics.find((s) => s.serviceId === "svc-api");
    expect(apiMetrics?.insufficientData).toBe(false);
    expect(apiMetrics?.deploymentFrequency).toBe(12);
    expect(apiMetrics?.leadTimeHours).toBe(4.5);
    expect(apiMetrics?.changeFailureRate).toBe(15);
    expect(apiMetrics?.mttrHours).toBe(2.3);

    const webMetrics = result.serviceMetrics.find((s) => s.serviceId === "svc-web");
    expect(webMetrics?.insufficientData).toBe(true);
    expect(webMetrics?.deploymentFrequency).toBe(0);
  });

  it("marks services with no pre-computed metrics as insufficient data", async () => {
    // Recent events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Services config
    mockSend.mockResolvedValueOnce({
      Items: [makeServiceConfig("svc-new", "New Service")],
      LastEvaluatedKey: undefined,
    });

    // Metrics for svc-new (no data)
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Incidents
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Context events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeServiceHealth(makeContext());

    expect(result.serviceMetrics[0].insufficientData).toBe(true);
    expect(result.serviceMetrics[0].deploymentFrequency).toBe(0);
  });

  it("computes blast radius from incidents and correlated deployments", async () => {
    // Recent events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Services config
    mockSend.mockResolvedValueOnce({
      Items: [
        makeServiceConfig("svc-api", "API Service"),
        makeServiceConfig("svc-web", "Web Service"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Service metrics
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-api")], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-web")], LastEvaluatedKey: undefined });

    // Incidents with correlated deployments
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "2024-01-05T10:00:00.000Z", ["e1", "e2"]),
        makeIncident("inc-2", "2024-01-08T10:00:00.000Z", ["e3"]),
      ],
      LastEvaluatedKey: undefined,
    });

    // Context events - these are the events that can be looked up for services
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", ["svc-api", "svc-web"], "2024-01-05T09:00:00.000Z"),
        makeEvent("e2", ["svc-api", "svc-db"], "2024-01-05T08:00:00.000Z"),
        makeEvent("e3", ["svc-web"], "2024-01-08T09:00:00.000Z"),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await computeServiceHealth(makeContext());

    // inc-1: e1 has [svc-api, svc-web], e2 has [svc-api, svc-db] → distinct: svc-api, svc-web, svc-db = 3
    // inc-2: e3 has [svc-web] → distinct: svc-web = 1
    expect(result.blastRadius.incidents).toHaveLength(2);
    expect(result.blastRadius.incidents[0].incidentId).toBe("inc-1");
    expect(result.blastRadius.incidents[0].blastRadius).toBe(3);
    expect(result.blastRadius.incidents[0].affectedServices).toContain("svc-api");
    expect(result.blastRadius.incidents[0].affectedServices).toContain("svc-web");
    expect(result.blastRadius.incidents[0].affectedServices).toContain("svc-db");

    expect(result.blastRadius.incidents[1].incidentId).toBe("inc-2");
    expect(result.blastRadius.incidents[1].blastRadius).toBe(1);

    // Average: (3 + 1) / 2 = 2
    expect(result.blastRadius.average).toBe(2);
    // Maximum: 3
    expect(result.blastRadius.maximum).toBe(3);
  });

  it("returns zero blast radius when no incidents have correlated deployments", async () => {
    // Recent events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Services config
    mockSend.mockResolvedValueOnce({
      Items: [makeServiceConfig("svc-api", "API Service")],
      LastEvaluatedKey: undefined,
    });

    // Service metrics
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-api")], LastEvaluatedKey: undefined });

    // Incidents with no correlated deployments
    mockSend.mockResolvedValueOnce({
      Items: [
        makeIncident("inc-1", "2024-01-05T10:00:00.000Z", undefined),
        makeIncident("inc-2", "2024-01-08T10:00:00.000Z", []),
      ],
      LastEvaluatedKey: undefined,
    });

    // Context events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeServiceHealth(makeContext());

    expect(result.blastRadius.average).toBe(0);
    expect(result.blastRadius.maximum).toBe(0);
    expect(result.blastRadius.incidents).toEqual([]);
  });

  it("filters service metrics when serviceId is provided", async () => {
    // Recent events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Services config
    mockSend.mockResolvedValueOnce({
      Items: [
        makeServiceConfig("svc-api", "API Service"),
        makeServiceConfig("svc-web", "Web Service"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Only query metrics for the filtered service (svc-api)
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-api")], LastEvaluatedKey: undefined });

    // Incidents
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Context events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeServiceHealth(makeContext({ serviceId: "svc-api" }));

    // Only the filtered service should have metrics
    expect(result.serviceMetrics).toHaveLength(1);
    expect(result.serviceMetrics[0].serviceId).toBe("svc-api");
    expect(result.filters.service).toBe("svc-api");
  });

  it("uses most recent risk score for services at risk", async () => {
    // Recent events - svc-api has high then critical (critical is most recent)
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", ["svc-api"], "2024-01-09T10:00:00.000Z", "high"),
        makeEvent("e2", ["svc-api"], "2024-01-12T10:00:00.000Z", "critical"),
        makeEvent("e3", ["svc-api"], "2024-01-08T10:00:00.000Z", "high"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Services config
    mockSend.mockResolvedValueOnce({
      Items: [makeServiceConfig("svc-api", "API Service")],
      LastEvaluatedKey: undefined,
    });

    // Service metrics
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-api")], LastEvaluatedKey: undefined });

    // Incidents
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // Context events
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await computeServiceHealth(makeContext());

    expect(result.servicesAtRisk[0].mostRecentRiskScore).toBe("critical");
    expect(result.servicesAtRisk[0].highCriticalCount).toBe(3);
  });

  it("includes period and filters in response", async () => {
    // Recent events
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // Services config
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // Incidents
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // Context events
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const context = makeContext({ teamId: "team-alpha", serviceId: "svc-x" });
    const result = await computeServiceHealth(context);

    expect(result.period.start).toBe("2024-01-01T00:00:00.000Z");
    expect(result.period.end).toBe("2024-01-15T00:00:00.000Z");
    expect(result.filters.team).toBe("team-alpha");
    expect(result.filters.service).toBe("svc-x");
  });

  it("resolves service names from config for services at risk", async () => {
    // Recent events with service IDs
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEvent("e1", ["svc-api"], "2024-01-10T10:00:00.000Z", "high"),
      ],
      LastEvaluatedKey: undefined,
    });

    // Services config with readable names
    mockSend.mockResolvedValueOnce({
      Items: [makeServiceConfig("svc-api", "Payment API")],
      LastEvaluatedKey: undefined,
    });

    // Service metrics
    mockSend.mockResolvedValueOnce({ Items: [makeMetricsItem("svc-api")], LastEvaluatedKey: undefined });

    // Incidents
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    // Context events
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await computeServiceHealth(makeContext());

    expect(result.servicesAtRisk[0].serviceName).toBe("Payment API");
  });
});
