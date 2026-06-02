/**
 * Unit tests for the auth session extraction helper.
 *
 * Tests cover:
 * - Successful session extraction from valid JWT tokens
 * - HTTP 401 responses for missing, expired, and malformed tokens
 * - Role validation
 * - Helper utilities (isAuthenticated, sessionToJWTPayload)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedSession } from "@/lib/types/auth";

// Mock next-auth/jwt
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import {
  getAuthSession,
  isAuthenticated,
  sessionToJWTPayload,
  requireAuthSession,
  AuthenticationError,
} from "@/lib/auth/session";

const mockedGetToken = vi.mocked(getToken);

function createMockRequest(url = "http://localhost:3000/api/test"): NextRequest {
  return new NextRequest(new URL(url));
}

describe("getAuthSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AuthenticatedSession for valid token with all claims", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-123",
      userId: "user-456",
      role: "tenant_admin",
      teamIds: ["team-a", "team-b"],
      exp: futureExp,
      sub: "user-456",
      iat: Math.floor(Date.now() / 1000),
    } as any);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).not.toBeInstanceOf(NextResponse);
    const session = result as AuthenticatedSession;
    expect(session.tenantId).toBe("tenant-123");
    expect(session.userId).toBe("user-456");
    expect(session.role).toBe("tenant_admin");
    expect(session.teamIds).toEqual(["team-a", "team-b"]);
    expect(session.expiresAt).toBeInstanceOf(Date);
    expect(session.expiresAt.getTime()).toBe(futureExp * 1000);
  });

  it("returns 401 MISSING_TOKEN when getToken returns null", async () => {
    mockedGetToken.mockResolvedValue(null);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MISSING_TOKEN");
    expect(body.error).toBe("Authentication required");
  });

  it("returns 401 MALFORMED_TOKEN when tenantId is missing", async () => {
    mockedGetToken.mockResolvedValue({
      userId: "user-456",
      role: "viewer",
      teamIds: [],
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MALFORMED_TOKEN");
  });

  it("returns 401 MALFORMED_TOKEN when userId is missing", async () => {
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-123",
      role: "viewer",
      teamIds: [],
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MALFORMED_TOKEN");
  });

  it("returns 401 MALFORMED_TOKEN when role is missing", async () => {
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-123",
      userId: "user-456",
      teamIds: [],
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MALFORMED_TOKEN");
  });

  it("returns 401 INVALID_TOKEN when role is not a valid UserRole", async () => {
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-123",
      userId: "user-456",
      role: "super_admin",
      teamIds: [],
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("INVALID_TOKEN");
  });

  it("returns 401 EXPIRED_TOKEN when token exp is in the past", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-123",
      userId: "user-456",
      role: "viewer",
      teamIds: [],
      exp: pastExp,
    } as any);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("EXPIRED_TOKEN");
  });

  it("returns 401 MALFORMED_TOKEN when getToken throws", async () => {
    mockedGetToken.mockRejectedValue(new Error("decode failed"));

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MALFORMED_TOKEN");
  });

  it("defaults teamIds to empty array when not present in token", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-123",
      userId: "user-456",
      role: "viewer",
      exp: futureExp,
    } as any);

    const request = createMockRequest();
    const result = await getAuthSession(request);

    expect(result).not.toBeInstanceOf(NextResponse);
    const session = result as AuthenticatedSession;
    expect(session.teamIds).toEqual([]);
  });

  it("accepts all valid roles: tenant_admin, team_lead, viewer", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const roles = ["tenant_admin", "team_lead", "viewer"] as const;

    for (const role of roles) {
      mockedGetToken.mockResolvedValue({
        tenantId: "tenant-123",
        userId: "user-456",
        role,
        teamIds: [],
        exp: futureExp,
      } as any);

      const request = createMockRequest();
      const result = await getAuthSession(request);
      expect(result).not.toBeInstanceOf(NextResponse);
      const session = result as AuthenticatedSession;
      expect(session.role).toBe(role);
    }
  });
});

describe("isAuthenticated", () => {
  it("returns true for AuthenticatedSession objects", () => {
    const session: AuthenticatedSession = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "viewer",
      teamIds: [],
      expiresAt: new Date(),
    };
    expect(isAuthenticated(session)).toBe(true);
  });

  it("returns false for NextResponse objects", () => {
    const response = NextResponse.json({ error: "test" }, { status: 401 });
    expect(isAuthenticated(response)).toBe(false);
  });
});

describe("sessionToJWTPayload", () => {
  it("converts an AuthenticatedSession to a JWTPayload", () => {
    const expiresAt = new Date(Date.now() + 3600000);
    const session: AuthenticatedSession = {
      userId: "user-789",
      tenantId: "tenant-abc",
      role: "team_lead",
      teamIds: ["team-x"],
      expiresAt,
    };

    const payload = sessionToJWTPayload(session);

    expect(payload.sub).toBe("user-789");
    expect(payload.tenantId).toBe("tenant-abc");
    expect(payload.userId).toBe("user-789");
    expect(payload.role).toBe("team_lead");
    expect(payload.teamIds).toEqual(["team-x"]);
    expect(payload.exp).toBe(Math.floor(expiresAt.getTime() / 1000));
    expect(payload.iat).toBeCloseTo(Math.floor(Date.now() / 1000), 0);
  });
});

describe("requireAuthSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session when authenticated", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    mockedGetToken.mockResolvedValue({
      tenantId: "tenant-123",
      userId: "user-456",
      role: "tenant_admin",
      teamIds: [],
      exp: futureExp,
    } as any);

    const request = createMockRequest();
    const session = await requireAuthSession(request);
    expect(session.tenantId).toBe("tenant-123");
  });

  it("throws AuthenticationError when not authenticated", async () => {
    mockedGetToken.mockResolvedValue(null);

    const request = createMockRequest();
    await expect(requireAuthSession(request)).rejects.toThrow(
      AuthenticationError
    );
  });
});
