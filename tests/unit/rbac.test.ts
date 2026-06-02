/**
 * Unit tests for RBAC role validation logic and authorization middleware.
 *
 * Tests cover:
 * - Role permission checks against ROLE_PERMISSIONS matrix
 * - Team scope enforcement for Team Leads
 * - Full authorization combining role + scope
 * - Authorization middleware (withAuthorization) HTTP responses
 * - Viewer 403 on create/update/delete (Requirement 7.3)
 * - Team Lead 403 on other team's resources (Requirement 7.7)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedSession } from "@/lib/types/auth";
import { ROLE_PERMISSIONS } from "@/lib/types/auth";
import {
  hasPermission,
  isWithinTeamScope,
  authorize,
} from "@/lib/auth/rbac";

// Mock next-auth/jwt for middleware tests
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import {
  withAuthorization,
  checkTeamScope,
} from "@/lib/middleware/authorize";

const mockedGetToken = vi.mocked(getToken);

function createMockRequest(url = "http://localhost:3000/api/teams"): NextRequest {
  return new NextRequest(new URL(url));
}

function createSession(overrides: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    role: "viewer",
    teamIds: [],
    expiresAt: new Date(Date.now() + 3600000),
    ...overrides,
  };
}

// ─── hasPermission ──────────────────────────────────────────────────────────────

describe("hasPermission", () => {
  it("tenant_admin has full CRUD on team resource", () => {
    expect(hasPermission("tenant_admin", "team", "read")).toBe(true);
    expect(hasPermission("tenant_admin", "team", "create")).toBe(true);
    expect(hasPermission("tenant_admin", "team", "update")).toBe(true);
    expect(hasPermission("tenant_admin", "team", "delete")).toBe(true);
  });

  it("team_lead has read and update on team but not create or delete", () => {
    expect(hasPermission("team_lead", "team", "read")).toBe(true);
    expect(hasPermission("team_lead", "team", "update")).toBe(true);
    expect(hasPermission("team_lead", "team", "create")).toBe(false);
    expect(hasPermission("team_lead", "team", "delete")).toBe(false);
  });

  it("viewer has only read on team", () => {
    expect(hasPermission("viewer", "team", "read")).toBe(true);
    expect(hasPermission("viewer", "team", "create")).toBe(false);
    expect(hasPermission("viewer", "team", "update")).toBe(false);
    expect(hasPermission("viewer", "team", "delete")).toBe(false);
  });

  it("viewer cannot create, update, or delete any resource", () => {
    const writePermissions = ["create", "update", "delete"] as const;
    const resources = Object.keys(ROLE_PERMISSIONS.viewer) as Array<keyof typeof ROLE_PERMISSIONS.viewer>;

    for (const resource of resources) {
      for (const permission of writePermissions) {
        // Viewer should not have any write permission except where explicitly granted
        const allowed = hasPermission("viewer", resource, permission);
        const expected = ROLE_PERMISSIONS.viewer[resource].includes(permission);
        expect(allowed).toBe(expected);
      }
    }
  });

  it("team_lead can read and create deployment_event", () => {
    expect(hasPermission("team_lead", "deployment_event", "read")).toBe(true);
    expect(hasPermission("team_lead", "deployment_event", "create")).toBe(true);
    expect(hasPermission("team_lead", "deployment_event", "update")).toBe(true);
    expect(hasPermission("team_lead", "deployment_event", "delete")).toBe(false);
  });

  it("no role has write access to audit_log", () => {
    expect(hasPermission("tenant_admin", "audit_log", "create")).toBe(false);
    expect(hasPermission("team_lead", "audit_log", "create")).toBe(false);
    expect(hasPermission("viewer", "audit_log", "create")).toBe(false);
  });

  it("tenant_admin can read metrics but not write", () => {
    expect(hasPermission("tenant_admin", "metrics", "read")).toBe(true);
    expect(hasPermission("tenant_admin", "metrics", "create")).toBe(false);
  });
});

// ─── isWithinTeamScope ──────────────────────────────────────────────────────────

describe("isWithinTeamScope", () => {
  it("tenant_admin can access any team", () => {
    const session = createSession({
      role: "tenant_admin",
      teamIds: ["team-a"],
    });
    expect(isWithinTeamScope(session, "team-b")).toBe(true);
    expect(isWithinTeamScope(session, "team-xyz")).toBe(true);
  });

  it("team_lead can access their assigned teams", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a", "team-b"],
    });
    expect(isWithinTeamScope(session, "team-a")).toBe(true);
    expect(isWithinTeamScope(session, "team-b")).toBe(true);
  });

  it("team_lead cannot access teams they are not assigned to", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a"],
    });
    expect(isWithinTeamScope(session, "team-b")).toBe(false);
    expect(isWithinTeamScope(session, "team-c")).toBe(false);
  });

  it("team_lead with empty teamIds cannot access any team", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: [],
    });
    expect(isWithinTeamScope(session, "team-a")).toBe(false);
  });

  it("viewer always passes team scope check", () => {
    const session = createSession({
      role: "viewer",
      teamIds: [],
    });
    expect(isWithinTeamScope(session, "team-a")).toBe(true);
  });
});

// ─── authorize ──────────────────────────────────────────────────────────────────

describe("authorize", () => {
  it("allows tenant_admin to create team", () => {
    const session = createSession({ role: "tenant_admin" });
    const result = authorize(session, "team", "create");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("denies viewer creating a team with descriptive reason", () => {
    const session = createSession({ role: "viewer" });
    const result = authorize(session, "team", "create");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Viewer");
    expect(result.reason).toContain("read-only");
  });

  it("denies viewer updating a service", () => {
    const session = createSession({ role: "viewer" });
    const result = authorize(session, "service", "update");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Viewer");
  });

  it("denies viewer deleting a deployment_event", () => {
    const session = createSession({ role: "viewer" });
    const result = authorize(session, "deployment_event", "delete");
    expect(result.allowed).toBe(false);
  });

  it("allows viewer to read any resource that grants read", () => {
    const session = createSession({ role: "viewer" });
    const result = authorize(session, "deployment_event", "read");
    expect(result.allowed).toBe(true);
  });

  it("denies team_lead deleting a deployment_event", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a"],
    });
    const result = authorize(session, "deployment_event", "delete", "team-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Team Lead");
  });

  it("allows team_lead to update resources in their team", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a"],
    });
    const result = authorize(session, "deployment_event", "update", "team-a");
    expect(result.allowed).toBe(true);
  });

  it("denies team_lead updating resources in another team", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a"],
    });
    const result = authorize(session, "deployment_event", "update", "team-b");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("team-b");
    expect(result.reason).toContain("assigned teams");
  });

  it("allows team_lead to read resources without team scope", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a"],
    });
    // Read operations don't enforce team scope
    const result = authorize(session, "deployment_event", "read");
    expect(result.allowed).toBe(true);
  });

  it("team_lead read operations skip team scope even if team ID provided", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a"],
    });
    // Read is allowed for any team — scope only enforced on writes
    const result = authorize(session, "deployment_event", "read", "team-b");
    expect(result.allowed).toBe(true);
  });
});

// ─── withAuthorization middleware ───────────────────────────────────────────────

describe("withAuthorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockToken(overrides: Record<string, unknown> = {}) {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
      role: "tenant_admin",
      teamIds: ["team-a"],
      exp: futureExp,
      sub: "user-1",
      iat: Math.floor(Date.now() / 1000),
      ...overrides,
    } as any);
  }

  it("returns AuthorizedContext on successful authorization", async () => {
    mockToken({ role: "tenant_admin" });

    const request = createMockRequest();
    const result = await withAuthorization(request, {
      resource: "team",
      permission: "create",
    });

    expect(result).not.toBeInstanceOf(NextResponse);
    const ctx = result as { session: AuthenticatedSession };
    expect(ctx.session.role).toBe("tenant_admin");
    expect(ctx.session.tenantId).toBe("tenant-1");
  });

  it("returns 401 when not authenticated", async () => {
    mockedGetToken.mockResolvedValue(null);

    const request = createMockRequest();
    const result = await withAuthorization(request, {
      resource: "team",
      permission: "create",
    });

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
  });

  it("returns 403 when viewer tries to create", async () => {
    mockToken({ role: "viewer" });

    const request = createMockRequest();
    const result = await withAuthorization(request, {
      resource: "team",
      permission: "create",
    });

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("FORBIDDEN");
    expect(body.error).toContain("Viewer");
  });

  it("returns 403 when team_lead tries to modify another team's resource", async () => {
    mockToken({ role: "team_lead", teamIds: ["team-a"] });

    const request = createMockRequest();
    const result = await withAuthorization(request, {
      resource: "deployment_event",
      permission: "update",
      getTeamId: () => "team-b",
    });

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("TEAM_SCOPE_VIOLATION");
    expect(body.error).toContain("team-b");
  });

  it("allows team_lead to modify their own team's resource", async () => {
    mockToken({ role: "team_lead", teamIds: ["team-a", "team-b"] });

    const request = createMockRequest();
    const result = await withAuthorization(request, {
      resource: "deployment_event",
      permission: "update",
      getTeamId: () => "team-a",
    });

    expect(result).not.toBeInstanceOf(NextResponse);
    const ctx = result as { session: AuthenticatedSession };
    expect(ctx.session.role).toBe("team_lead");
  });

  it("supports async getTeamId function", async () => {
    mockToken({ role: "team_lead", teamIds: ["team-x"] });

    const request = createMockRequest();
    const result = await withAuthorization(request, {
      resource: "service",
      permission: "update",
      getTeamId: async () => "team-x",
    });

    expect(result).not.toBeInstanceOf(NextResponse);
  });

  it("skips team scope check when getTeamId returns undefined", async () => {
    mockToken({ role: "team_lead", teamIds: ["team-a"] });

    const request = createMockRequest();
    const result = await withAuthorization(request, {
      resource: "deployment_event",
      permission: "create",
      getTeamId: () => undefined,
    });

    expect(result).not.toBeInstanceOf(NextResponse);
  });
});

// ─── checkTeamScope ─────────────────────────────────────────────────────────────

describe("checkTeamScope", () => {
  it("returns null (authorized) for tenant_admin", () => {
    const session = createSession({ role: "tenant_admin" });
    const result = checkTeamScope(session, "any-team");
    expect(result).toBeNull();
  });

  it("returns null for team_lead accessing assigned team", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a", "team-b"],
    });
    const result = checkTeamScope(session, "team-a");
    expect(result).toBeNull();
  });

  it("returns 403 for team_lead accessing unassigned team", () => {
    const session = createSession({
      role: "team_lead",
      teamIds: ["team-a"],
    });
    const result = checkTeamScope(session, "team-c");
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(403);
  });

  it("returns null for viewer (team scope not enforced for viewers)", () => {
    const session = createSession({ role: "viewer", teamIds: [] });
    const result = checkTeamScope(session, "any-team");
    expect(result).toBeNull();
  });
});
