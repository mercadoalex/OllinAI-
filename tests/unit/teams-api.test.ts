/**
 * Unit tests for the Team CRUD API endpoints.
 *
 * Tests cover: creation, listing, get, update, archive,
 * unique name enforcement, member limit, and archive rejection
 * when team owns services.
 *
 * Requirements: 6.1, 6.4, 6.6
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

// Mock tenant-scope (pass-through)
vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantPrefix: (tenantId: string) => `TENANT#${tenantId}`,
  tenantServiceKey: (tenantId: string, serviceId: string) =>
    `TENANT#${tenantId}#SVC#${serviceId}`,
  tenantDedupKey: (tenantId: string) => `TENANT#${tenantId}#DEDUP`,
  tenantTeamKey: (tenantId: string, teamId: string) =>
    `TENANT#${tenantId}#TEAM#${teamId}`,
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

// Mock authorization middleware
vi.mock("@/lib/middleware/authorize", () => ({
  withAuthorization: vi.fn().mockResolvedValue({
    session: {
      userId: "user-001",
      tenantId: "tenant-001",
      role: "tenant_admin",
      teamIds: ["team-001"],
      expiresAt: new Date(Date.now() + 3600000),
    },
  }),
}));

// Import handlers after mocks
import { GET as listTeams, POST as createTeam } from "@/app/api/teams/route";
import {
  GET as getTeam,
  PUT as updateTeam,
  DELETE as deleteTeam,
} from "@/app/api/teams/[teamId]/route";
import { withAuthorization } from "@/lib/middleware/authorize";
import { NextResponse } from "next/server";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const TEST_TENANT_ID = "tenant-001";

function createGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createPutRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "DELETE" });
}

function makeRouteContext(teamId: string) {
  return { params: Promise.resolve({ teamId }) };
}

function makeTeamItem(teamId: string, name: string, archived = false) {
  return {
    PK: `TENANT#${TEST_TENANT_ID}`,
    SK: `TEAM#${teamId}`,
    entityData: {
      teamId,
      name,
      members: ["member-1"],
      archived,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  };
}

function makeServiceItem(serviceId: string, owningTeamId: string) {
  return {
    PK: `TENANT#${TEST_TENANT_ID}`,
    SK: `SVC#${serviceId}`,
    entityData: {
      serviceId,
      name: serviceId,
      owningTeamId,
      ownershipHistory: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  };
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

const mockSession = {
  userId: "user-001",
  tenantId: "tenant-001",
  role: "tenant_admin" as const,
  teamIds: ["team-001"],
  expiresAt: new Date(Date.now() + 3600000),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Re-setup default authorization mock
  vi.mocked(withAuthorization).mockResolvedValue({ session: mockSession });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/teams", () => {
  it("should return list of teams for the tenant", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeTeamItem("team-1", "Backend Team"),
        makeTeamItem("team-2", "Frontend Team"),
      ],
    });

    const req = createGetRequest("http://localhost/api/teams");
    const response = await listTeams(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe("Backend Team");
    expect(body.data[1].name).toBe("Frontend Team");
  });

  it("should return empty array when no teams exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createGetRequest("http://localhost/api/teams");
    const response = await listTeams(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(0);
  });

  it("should return 401/403 when not authenticated", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const req = createGetRequest("http://localhost/api/teams");
    const response = await listTeams(req);
    expect(response.status).toBe(401);
  });
});

describe("POST /api/teams", () => {
  it("should create a team and return 201", async () => {
    // First call: query for existing teams (uniqueness check)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Second call: put team
    mockSend.mockResolvedValueOnce({});

    const req = createPostRequest("http://localhost/api/teams", {
      name: "New Team",
      members: ["user-1", "user-2"],
    });

    const response = await createTeam(req);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.teamId).toBeDefined();
    expect(body.name).toBe("New Team");
    expect(body.members).toEqual(["user-1", "user-2"]);
    expect(body.archived).toBe(false);
  });

  it("should create team with empty members array by default", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    const req = createPostRequest("http://localhost/api/teams", {
      name: "Empty Team",
    });

    const response = await createTeam(req);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.members).toEqual([]);
  });

  it("should return 400 when name is empty", async () => {
    const req = createPostRequest("http://localhost/api/teams", {
      name: "",
    });

    const response = await createTeam(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should return 400 when name exceeds 100 characters", async () => {
    const req = createPostRequest("http://localhost/api/teams", {
      name: "a".repeat(101),
    });

    const response = await createTeam(req);
    expect(response.status).toBe(400);
  });

  it("should return 400 when members exceed 200", async () => {
    const req = createPostRequest("http://localhost/api/teams", {
      name: "Big Team",
      members: Array.from({ length: 201 }, (_, i) => `user-${i}`),
    });

    const response = await createTeam(req);
    expect(response.status).toBe(400);
  });

  it("should return 409 when team name already exists (case-insensitive)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeTeamItem("team-existing", "Backend Team")],
    });

    const req = createPostRequest("http://localhost/api/teams", {
      name: "backend team", // same name, different case
    });

    const response = await createTeam(req);
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error).toContain("already exists");
  });

  it("should allow reusing name of archived team", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeTeamItem("team-archived", "Backend Team", true)],
    });
    mockSend.mockResolvedValueOnce({});

    const req = createPostRequest("http://localhost/api/teams", {
      name: "Backend Team",
    });

    const response = await createTeam(req);
    expect(response.status).toBe(201);
  });

  it("should return 422 when max 50 teams reached", async () => {
    const fiftyTeams = Array.from({ length: 50 }, (_, i) =>
      makeTeamItem(`team-${i}`, `Team ${i}`)
    );
    mockSend.mockResolvedValueOnce({ Items: fiftyTeams });

    const req = createPostRequest("http://localhost/api/teams", {
      name: "Team 51",
    });

    const response = await createTeam(req);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error).toContain("50");
  });

  it("should return 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json {{{",
    });

    const response = await createTeam(req);
    expect(response.status).toBe(400);
  });
});

describe("GET /api/teams/[teamId]", () => {
  it("should return team details", async () => {
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Backend Team"),
    });

    const req = createGetRequest("http://localhost/api/teams/team-1");
    const response = await getTeam(req, makeRouteContext("team-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.teamId).toBe("team-1");
    expect(body.name).toBe("Backend Team");
  });

  it("should return 404 when team not found", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const req = createGetRequest("http://localhost/api/teams/nonexistent");
    const response = await getTeam(req, makeRouteContext("nonexistent"));

    expect(response.status).toBe(404);
  });
});

describe("PUT /api/teams/[teamId]", () => {
  it("should update team name", async () => {
    // First: GetCommand to fetch existing team
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Old Name"),
    });
    // Second: QueryCommand to check name uniqueness
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Third: PutCommand to save
    mockSend.mockResolvedValueOnce({});

    const req = createPutRequest("http://localhost/api/teams/team-1", {
      name: "New Name",
    });

    const response = await updateTeam(req, makeRouteContext("team-1"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.name).toBe("New Name");
  });

  it("should update team members", async () => {
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Backend Team"),
    });
    mockSend.mockResolvedValueOnce({});

    const req = createPutRequest("http://localhost/api/teams/team-1", {
      members: ["user-new-1", "user-new-2"],
    });

    const response = await updateTeam(req, makeRouteContext("team-1"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.members).toEqual(["user-new-1", "user-new-2"]);
  });

  it("should return 404 when team not found", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const req = createPutRequest("http://localhost/api/teams/nonexistent", {
      name: "Updated",
    });

    const response = await updateTeam(req, makeRouteContext("nonexistent"));
    expect(response.status).toBe(404);
  });

  it("should return 422 when updating archived team", async () => {
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Archived Team", true),
    });

    const req = createPutRequest("http://localhost/api/teams/team-1", {
      name: "Updated",
    });

    const response = await updateTeam(req, makeRouteContext("team-1"));
    expect(response.status).toBe(422);
  });

  it("should return 409 when new name conflicts with existing team", async () => {
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Old Name"),
    });
    mockSend.mockResolvedValueOnce({
      Items: [makeTeamItem("team-2", "Taken Name")],
    });

    const req = createPutRequest("http://localhost/api/teams/team-1", {
      name: "Taken Name",
    });

    const response = await updateTeam(req, makeRouteContext("team-1"));
    expect(response.status).toBe(409);
  });

  it("should return 400 when name exceeds 100 characters", async () => {
    const req = createPutRequest("http://localhost/api/teams/team-1", {
      name: "a".repeat(101),
    });

    const response = await updateTeam(req, makeRouteContext("team-1"));
    expect(response.status).toBe(400);
  });

  it("should return 400 when members exceed 200", async () => {
    const req = createPutRequest("http://localhost/api/teams/team-1", {
      members: Array.from({ length: 201 }, (_, i) => `user-${i}`),
    });

    const response = await updateTeam(req, makeRouteContext("team-1"));
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/teams/[teamId] (archive)", () => {
  it("should archive team and return 200", async () => {
    // GetCommand: team exists
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Backend Team"),
    });
    // QueryCommand: no services owned by this team
    mockSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand: save archived team
    mockSend.mockResolvedValueOnce({});

    const req = createDeleteRequest("http://localhost/api/teams/team-1");
    const response = await deleteTeam(req, makeRouteContext("team-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.archived).toBe(true);
  });

  it("should return 404 when team not found", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const req = createDeleteRequest("http://localhost/api/teams/nonexistent");
    const response = await deleteTeam(req, makeRouteContext("nonexistent"));

    expect(response.status).toBe(404);
  });

  it("should return 422 when team is already archived", async () => {
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Archived Team", true),
    });

    const req = createDeleteRequest("http://localhost/api/teams/team-1");
    const response = await deleteTeam(req, makeRouteContext("team-1"));

    expect(response.status).toBe(422);
  });

  it("should return 409 when team owns services (Requirement 6.6)", async () => {
    // GetCommand: team exists
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Backend Team"),
    });
    // QueryCommand: team owns services
    mockSend.mockResolvedValueOnce({
      Items: [
        makeServiceItem("api-service", "team-1"),
        makeServiceItem("auth-service", "team-1"),
      ],
    });

    const req = createDeleteRequest("http://localhost/api/teams/team-1");
    const response = await deleteTeam(req, makeRouteContext("team-1"));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("Reassign");
    expect(body.services).toHaveLength(2);
    expect(body.services[0].serviceId).toBe("api-service");
    expect(body.services[1].serviceId).toBe("auth-service");
  });

  it("should ignore services owned by other teams", async () => {
    // GetCommand: team exists
    mockSend.mockResolvedValueOnce({
      Item: makeTeamItem("team-1", "Backend Team"),
    });
    // QueryCommand: services exist but are owned by a different team
    mockSend.mockResolvedValueOnce({
      Items: [makeServiceItem("other-service", "team-2")],
    });
    // PutCommand: save archived
    mockSend.mockResolvedValueOnce({});

    const req = createDeleteRequest("http://localhost/api/teams/team-1");
    const response = await deleteTeam(req, makeRouteContext("team-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.archived).toBe(true);
  });

  it("should require tenant_admin role", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      )
    );

    const req = createDeleteRequest("http://localhost/api/teams/team-1");
    const response = await deleteTeam(req, makeRouteContext("team-1"));

    expect(response.status).toBe(403);
  });
});
