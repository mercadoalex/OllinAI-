import { describe, it, expect } from "vitest";
import type {
  DeploymentEventPayload,
  IncidentPayload,
  WebhookResponse,
  CorrelationResult,
  RiskFactors,
  RiskScoreResult,
  DORAMetrics,
  Recommendation,
  PaginatedResponse,
} from "@/lib/types";
import type {
  EventItem,
  IncidentItem,
  MetricsItem,
  ConfigItem,
  AuditItem,
  TeamConfigItem,
  ServiceConfigItem,
  SubscriptionConfigItem,
  SubscriptionTier,
} from "@/lib/types/dynamo";
import type {
  JWTPayload,
  UserRole,
  AuthenticatedSession,
  AuthorizationResult,
} from "@/lib/types/auth";
import { ROLE_PERMISSIONS } from "@/lib/types/auth";

describe("Core types", () => {
  it("should allow constructing a valid DeploymentEventPayload", () => {
    const payload: DeploymentEventPayload = {
      commitShas: ["abc123"],
      author: "developer@example.com",
      services: ["api-service"],
      deploymentTimestamp: "2024-01-15T10:30:00Z",
      environment: "production",
      changeSize: { linesAdded: 50, linesRemoved: 10, filesChanged: 3 },
    };
    expect(payload.commitShas).toHaveLength(1);
    expect(payload.environment).toBe("production");
  });

  it("should allow DeploymentEventPayload without optional changeSize", () => {
    const payload: DeploymentEventPayload = {
      commitShas: ["abc123", "def456"],
      author: "dev",
      services: ["svc-a", "svc-b"],
      deploymentTimestamp: "2024-01-15T10:30:00Z",
      environment: "staging",
    };
    expect(payload.changeSize).toBeUndefined();
  });

  it("should allow constructing a valid IncidentPayload", () => {
    const payload: IncidentPayload = {
      externalId: "PD-12345",
      severity: "high",
      affectedService: "api-service",
      detectionTimestamp: "2024-01-15T11:00:00Z",
    };
    expect(payload.severity).toBe("high");
    expect(payload.resolutionTimestamp).toBeUndefined();
  });

  it("should allow constructing a WebhookResponse", () => {
    const response: WebhookResponse = {
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      status: "created",
    };
    expect(response.status).toBe("created");
  });

  it("should allow constructing a CorrelationResult", () => {
    const result: CorrelationResult = {
      incidentId: "inc-001",
      correlatedDeployments: [
        { eventId: "evt-001", temporalProximityMs: 5000, rank: 1 },
        { eventId: "evt-002", temporalProximityMs: 120000, rank: 2 },
      ],
      status: "correlated",
    };
    expect(result.correlatedDeployments).toHaveLength(2);
    expect(result.correlatedDeployments[0].rank).toBe(1);
  });

  it("should allow constructing RiskFactors and RiskScoreResult", () => {
    const factors: RiskFactors = {
      changeFailureRate: 0.4,
      changeSize: 0.6,
      deploymentTiming: 0.3,
      authorFailureRate: 0.2,
    };
    const result: RiskScoreResult = {
      score: "medium",
      factors,
      weights: {
        changeFailureRate: 0.35,
        changeSize: 0.25,
        deploymentTiming: 0.20,
        authorFailureRate: 0.20,
      },
      source: "rule_engine",
    };
    expect(result.score).toBe("medium");
  });

  it("should allow constructing DORAMetrics with numeric values", () => {
    const metrics: DORAMetrics = {
      deploymentFrequency: 12,
      leadTimeHours: 4.5,
      changeFailureRate: 8.3,
      mttrHours: 1.2,
      unresolvedIncidentCount: 2,
      period: { start: "2024-01-01T00:00:00Z", end: "2024-01-31T23:59:59Z" },
      filters: { team: "platform", service: "api" },
    };
    expect(metrics.deploymentFrequency).toBe(12);
  });

  it("should allow DORAMetrics with insufficient_data", () => {
    const metrics: DORAMetrics = {
      deploymentFrequency: "insufficient_data",
      leadTimeHours: "insufficient_data",
      changeFailureRate: "insufficient_data",
      mttrHours: "insufficient_data",
      unresolvedIncidentCount: 0,
      period: { start: "2024-01-01T00:00:00Z", end: "2024-01-31T23:59:59Z" },
      filters: {},
    };
    expect(metrics.deploymentFrequency).toBe("insufficient_data");
  });

  it("should allow constructing a Recommendation", () => {
    const rec: Recommendation = {
      id: "rec-001",
      category: "reduce_change_size",
      targetService: "api-service",
      targetTeam: "platform-team",
      triggeringMetrics: { changeSize: 0.85, filesChanged: 42 },
      timeRangeEvaluated: { start: "2024-01-08T00:00:00Z", end: "2024-01-15T00:00:00Z" },
      generatedAt: "2024-01-15T10:35:00Z",
    };
    expect(rec.category).toBe("reduce_change_size");
  });

  it("should allow constructing a PaginatedResponse", () => {
    const response: PaginatedResponse<{ id: string; name: string }> = {
      data: [{ id: "1", name: "item-1" }],
      pagination: {
        totalCount: 50,
        currentPage: 1,
        pageSize: 25,
        hasMore: true,
      },
    };
    expect(response.pagination.hasMore).toBe(true);
    expect(response.data).toHaveLength(1);
  });
});

describe("DynamoDB types", () => {
  it("should allow constructing an EventItem", () => {
    const item: EventItem = {
      PK: "TENANT#t1#SVC#api",
      SK: "DEPLOY#2024-01-15T10:30:00Z#evt-001",
      eventId: "evt-001",
      commitShas: ["abc123"],
      author: "dev@example.com",
      services: ["api"],
      environment: "production",
      teamId: "UNASSIGNED",
      createdAt: "2024-01-15T10:30:00Z",
    };
    expect(item.teamId).toBe("UNASSIGNED");
    expect(item.riskScore).toBeUndefined();
  });

  it("should allow constructing an IncidentItem", () => {
    const item: IncidentItem = {
      PK: "TENANT#t1#SVC#api",
      SK: "INC#2024-01-15T11:00:00Z#inc-001",
      incidentId: "inc-001",
      externalId: "PD-12345",
      severity: "high",
      detectionTimestamp: "2024-01-15T11:00:00Z",
      correlationStatus: "pending",
    };
    expect(item.correlationStatus).toBe("pending");
  });

  it("should allow constructing a MetricsItem", () => {
    const item: MetricsItem = {
      PK: "TENANT#t1#SCOPE#TEAM#platform",
      SK: "PERIOD#2024-01-01#2024-01-31",
      deploymentFrequency: 45,
      leadTimeHours: 3.2,
      changeFailureRate: 5.5,
      mttrHours: 0.8,
      unresolvedCount: 1,
      dataPoints: 45,
      computedAt: "2024-01-31T23:59:59Z",
    };
    expect(item.dataPoints).toBe(45);
  });

  it("should allow constructing an AuditItem", () => {
    const item: AuditItem = {
      PK: "TENANT#t1",
      SK: "AUDIT#2024-01-15T10:30:00.123Z#aud-001",
      actor: "user-123",
      action: "team.create",
      targetResource: "TEAM#team-456",
      sourceIp: "192.168.1.1",
      outcome: "success",
      timestamp: "2024-01-15T10:30:00.123Z",
    };
    expect(item.outcome).toBe("success");
  });

  it("should allow constructing TeamConfigItem", () => {
    const item: TeamConfigItem = {
      PK: "TENANT#t1",
      SK: "TEAM#team-001",
      entityData: {
        teamId: "team-001",
        name: "Platform Engineering",
        members: ["user-1", "user-2"],
        archived: false,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    };
    expect(item.entityData.name).toBe("Platform Engineering");
  });

  it("should allow constructing ServiceConfigItem", () => {
    const item: ServiceConfigItem = {
      PK: "TENANT#t1",
      SK: "SVC#svc-001",
      entityData: {
        serviceId: "svc-001",
        name: "api-gateway",
        owningTeamId: "team-001",
        ownershipHistory: [
          { teamId: "team-001", from: "2024-01-01T00:00:00Z" },
        ],
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    };
    expect(item.entityData.owningTeamId).toBe("team-001");
  });

  it("should validate subscription tier values", () => {
    const tiers: SubscriptionTier[] = ["starter", "pro", "enterprise"];
    expect(tiers).toHaveLength(3);
  });
});

describe("Auth types", () => {
  it("should allow constructing a JWTPayload", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      sub: "user-123",
      tenantId: "tenant-001",
      userId: "user-123",
      role: "team_lead",
      teamIds: ["team-001", "team-002"],
      iat: now,
      exp: now + 3600,
    };
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload.role).toBe("team_lead");
  });

  it("should allow constructing an AuthenticatedSession", () => {
    const session: AuthenticatedSession = {
      userId: "user-123",
      tenantId: "tenant-001",
      role: "tenant_admin",
      teamIds: [],
      expiresAt: new Date(Date.now() + 3600000),
    };
    expect(session.role).toBe("tenant_admin");
  });

  it("should allow constructing an AuthorizationResult", () => {
    const allowed: AuthorizationResult = { allowed: true };
    const denied: AuthorizationResult = {
      allowed: false,
      reason: "Viewer role cannot perform create operations",
    };
    expect(allowed.allowed).toBe(true);
    expect(denied.reason).toContain("Viewer");
  });

  it("should define correct permissions for viewer role", () => {
    const viewerTeamPerms = ROLE_PERMISSIONS.viewer.team;
    expect(viewerTeamPerms).toEqual(["read"]);
    expect(ROLE_PERMISSIONS.viewer.audit_log).toEqual([]);
  });

  it("should define correct permissions for tenant_admin role", () => {
    const adminTeamPerms = ROLE_PERMISSIONS.tenant_admin.team;
    expect(adminTeamPerms).toContain("create");
    expect(adminTeamPerms).toContain("delete");
  });

  it("should define team_lead role with limited permissions", () => {
    const leadTeamPerms = ROLE_PERMISSIONS.team_lead.team;
    expect(leadTeamPerms).toContain("read");
    expect(leadTeamPerms).toContain("update");
    expect(leadTeamPerms).not.toContain("create");
    expect(leadTeamPerms).not.toContain("delete");
  });

  it("should validate all role values", () => {
    const roles: UserRole[] = ["tenant_admin", "team_lead", "viewer"];
    roles.forEach((role) => {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    });
  });
});
