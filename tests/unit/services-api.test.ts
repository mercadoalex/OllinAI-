/**
 * Unit tests for the service CRUD API.
 *
 * Tests cover: listing services, creating services, getting a single service,
 * updating ownership with history tracking, uniqueness enforcement, and validation.
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

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

vi.mock("@/lib/dynamo/tenant-scope", () => ({
  tenantConfigKey: (tenantId: string) => `TENANT#${tenantId}`,
  withTenantScope: (_tenantId: string, input: unknown) => input,
}));

// Mock withAuthorization to return a valid session
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

const mockSession = {
  userId: "user-001",
  tenantId: "tenant-001",
  role: "tenant_admin" as const,
  teamIds: ["team-001"],
  expiresAt: new Date(Date.now() + 3600000),
};

// Import handlers after mocks
import { GET, POST } from "@/app/api/services/route";
import { GET as GET_SINGLE, PUT } from "@/app/api/services/[serviceId]/route";
import { withAuthorization } from "@/lib/middleware/authorize";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const TEST_TENANT_ID = "tenant-001";

function createRequest(
  url: string,
  method: string,
  body?: unknown
): NextRequest {
  const init: { method: string; headers?: Record<string, string>; body?: string } = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(new URL(url, "http://localhost"), init);
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withAuthorization).mockResolvedValue({ session: mockSession });
});

// ─── Tests: GET /api/services ──────────────────────────────────────────────────

describe("GET /api/services", () => {
  it("should return empty list when no services exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createRequest("/api/services", "GET");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  it("should return list of services", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-001",
          entityData: {
            serviceId: "svc-001",
            name: "API Gateway",
            owningTeamId: "team-backend",
            ownershipHistory: [{ teamId: "team-backend", from: "2024-01-01T00:00:00.000Z" }],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-002",
          entityData: {
            serviceId: "svc-002",
            name: "Auth Service",
            owningTeamId: "UNASSIGNED",
            ownershipHistory: [],
            createdAt: "2024-01-02T00:00:00.000Z",
            updatedAt: "2024-01-02T00:00:00.000Z",
          },
        },
      ],
    });

    const req = createRequest("/api/services", "GET");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].serviceId).toBe("svc-001");
    expect(body.data[0].name).toBe("API Gateway");
    expect(body.data[0].owningTeamId).toBe("team-backend");
    expect(body.data[1].serviceId).toBe("svc-002");
    expect(body.data[1].owningTeamId).toBe("UNASSIGNED");
  });

  it("should return 401/403 when unauthorized", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const req = createRequest("/api/services", "GET");
    const response = await GET(req);

    expect(response.status).toBe(403);
  });
});

// ─── Tests: POST /api/services ─────────────────────────────────────────────────

describe("POST /api/services", () => {
  it("should create a service with UNASSIGNED team", async () => {
    // First call: query for existing services (uniqueness check)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Second call: PutCommand
    mockSend.mockResolvedValueOnce({});

    const req = createRequest("/api/services", "POST", {
      name: "Payment Service",
    });
    const response = await POST(req);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.serviceId).toBeDefined();
    expect(body.name).toBe("Payment Service");
    expect(body.owningTeamId).toBe("UNASSIGNED");
    expect(body.ownershipHistory).toEqual([]);
  });

  it("should create a service with an owning team", async () => {
    // First call: query for existing services (uniqueness check)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Second call: verify team exists
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: `TENANT#${TEST_TENANT_ID}`, SK: "TEAM#team-backend", entityData: { teamId: "team-backend" } }],
    });
    // Third call: PutCommand
    mockSend.mockResolvedValueOnce({});

    const req = createRequest("/api/services", "POST", {
      name: "Payment Service",
      owningTeamId: "team-backend",
    });
    const response = await POST(req);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.owningTeamId).toBe("team-backend");
    expect(body.ownershipHistory).toHaveLength(1);
    expect(body.ownershipHistory[0].teamId).toBe("team-backend");
    expect(body.ownershipHistory[0].from).toBeDefined();
  });

  it("should return 409 for duplicate service name (case-insensitive)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-existing",
          entityData: {
            serviceId: "svc-existing",
            name: "payment service",
            owningTeamId: "team-001",
            ownershipHistory: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      ],
    });

    const req = createRequest("/api/services", "POST", {
      name: "Payment Service", // same name, different case
    });
    const response = await POST(req);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already exists");
  });

  it("should return 400 for empty service name", async () => {
    const req = createRequest("/api/services", "POST", {
      name: "",
    });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should return 400 for service name exceeding 150 characters", async () => {
    const req = createRequest("/api/services", "POST", {
      name: "a".repeat(151),
    });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should return 400 for non-existent owning team", async () => {
    // First call: query for existing services (uniqueness check)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Second call: verify team exists - returns empty
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createRequest("/api/services", "POST", {
      name: "New Service",
      owningTeamId: "non-existent-team",
    });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("team not found");
  });

  it("should return 400 for invalid JSON body", async () => {
    const req = new NextRequest(new URL("/api/services", "http://localhost"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });
    const response = await POST(req);

    expect(response.status).toBe(400);
  });

  it("should return 403 when user lacks create permission", async () => {
    vi.mocked(withAuthorization).mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const req = createRequest("/api/services", "POST", {
      name: "Payment Service",
    });
    const response = await POST(req);

    expect(response.status).toBe(403);
  });
});

// ─── Tests: GET /api/services/[serviceId] ──────────────────────────────────────

describe("GET /api/services/[serviceId]", () => {
  it("should return a single service", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-001",
          entityData: {
            serviceId: "svc-001",
            name: "API Gateway",
            owningTeamId: "team-backend",
            ownershipHistory: [{ teamId: "team-backend", from: "2024-01-01T00:00:00.000Z" }],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-15T00:00:00.000Z",
          },
        },
      ],
    });

    const req = createRequest("/api/services/svc-001", "GET");
    const response = await GET_SINGLE(req, { params: Promise.resolve({ serviceId: "svc-001" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.serviceId).toBe("svc-001");
    expect(body.name).toBe("API Gateway");
    expect(body.owningTeamId).toBe("team-backend");
    expect(body.ownershipHistory).toHaveLength(1);
  });

  it("should return 404 when service not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createRequest("/api/services/non-existent", "GET");
    const response = await GET_SINGLE(req, { params: Promise.resolve({ serviceId: "non-existent" }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Service not found");
  });
});

// ─── Tests: PUT /api/services/[serviceId] ──────────────────────────────────────

describe("PUT /api/services/[serviceId]", () => {
  it("should update service ownership and track history", async () => {
    // First call: fetch existing service
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-001",
          entityData: {
            serviceId: "svc-001",
            name: "API Gateway",
            owningTeamId: "team-backend",
            ownershipHistory: [{ teamId: "team-backend", from: "2024-01-01T00:00:00.000Z" }],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      ],
    });
    // Second call: verify new team exists
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: `TENANT#${TEST_TENANT_ID}`, SK: "TEAM#team-frontend", entityData: { teamId: "team-frontend" } }],
    });
    // Third call: UpdateCommand
    mockSend.mockResolvedValueOnce({
      Attributes: {
        entityData: {
          serviceId: "svc-001",
          name: "API Gateway",
          owningTeamId: "team-frontend",
          ownershipHistory: [
            { teamId: "team-backend", from: "2024-01-01T00:00:00.000Z", to: "2024-02-01T00:00:00.000Z" },
            { teamId: "team-frontend", from: "2024-02-01T00:00:00.000Z" },
          ],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-02-01T00:00:00.000Z",
        },
      },
    });

    const req = createRequest("/api/services/svc-001", "PUT", {
      owningTeamId: "team-frontend",
    });
    const response = await PUT(req, { params: Promise.resolve({ serviceId: "svc-001" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.owningTeamId).toBe("team-frontend");
    expect(body.ownershipHistory).toHaveLength(2);
    // Previous owner should have a 'to' timestamp
    expect(body.ownershipHistory[0].to).toBeDefined();
    // New owner should not have 'to'
    expect(body.ownershipHistory[1].to).toBeUndefined();
  });

  it("should return 404 when service not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createRequest("/api/services/non-existent", "PUT", {
      owningTeamId: "team-frontend",
    });
    const response = await PUT(req, { params: Promise.resolve({ serviceId: "non-existent" }) });

    expect(response.status).toBe(404);
  });

  it("should return 400 when owning team does not exist", async () => {
    // First call: fetch existing service
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-001",
          entityData: {
            serviceId: "svc-001",
            name: "API Gateway",
            owningTeamId: "team-backend",
            ownershipHistory: [{ teamId: "team-backend", from: "2024-01-01T00:00:00.000Z" }],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      ],
    });
    // Second call: verify team exists - not found
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = createRequest("/api/services/svc-001", "PUT", {
      owningTeamId: "non-existent-team",
    });
    const response = await PUT(req, { params: Promise.resolve({ serviceId: "svc-001" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("team not found");
  });

  it("should return 409 when renaming to a duplicate name", async () => {
    // First call: fetch existing service
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-001",
          entityData: {
            serviceId: "svc-001",
            name: "API Gateway",
            owningTeamId: "team-backend",
            ownershipHistory: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      ],
    });
    // Second call: query all services for uniqueness check
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-002",
          entityData: {
            serviceId: "svc-002",
            name: "Auth Service",
            owningTeamId: "team-backend",
            ownershipHistory: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      ],
    });

    const req = createRequest("/api/services/svc-001", "PUT", {
      name: "Auth Service",
      owningTeamId: "team-backend",
    });
    const response = await PUT(req, { params: Promise.resolve({ serviceId: "svc-001" }) });

    expect(response.status).toBe(409);
  });

  it("should return 400 for invalid JSON body", async () => {
    const req = new NextRequest(new URL("/api/services/svc-001", "http://localhost"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });
    const response = await PUT(req, { params: Promise.resolve({ serviceId: "svc-001" }) });

    expect(response.status).toBe(400);
  });

  it("should return 400 when owningTeamId is missing", async () => {
    const req = createRequest("/api/services/svc-001", "PUT", {
      name: "New Name",
    });
    const response = await PUT(req, { params: Promise.resolve({ serviceId: "svc-001" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("should not modify history when owningTeamId stays the same", async () => {
    // First call: fetch existing service
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `TENANT#${TEST_TENANT_ID}`,
          SK: "SVC#svc-001",
          entityData: {
            serviceId: "svc-001",
            name: "API Gateway",
            owningTeamId: "team-backend",
            ownershipHistory: [{ teamId: "team-backend", from: "2024-01-01T00:00:00.000Z" }],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      ],
    });
    // Second call: verify team exists
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: `TENANT#${TEST_TENANT_ID}`, SK: "TEAM#team-backend", entityData: { teamId: "team-backend" } }],
    });
    // Third call: UpdateCommand
    mockSend.mockResolvedValueOnce({
      Attributes: {
        entityData: {
          serviceId: "svc-001",
          name: "API Gateway",
          owningTeamId: "team-backend",
          ownershipHistory: [{ teamId: "team-backend", from: "2024-01-01T00:00:00.000Z" }],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-02-01T00:00:00.000Z",
        },
      },
    });

    const req = createRequest("/api/services/svc-001", "PUT", {
      owningTeamId: "team-backend",
    });
    const response = await PUT(req, { params: Promise.resolve({ serviceId: "svc-001" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    // History should not have changed - still one entry without 'to'
    expect(body.ownershipHistory).toHaveLength(1);
    expect(body.ownershipHistory[0].to).toBeUndefined();
  });
});
