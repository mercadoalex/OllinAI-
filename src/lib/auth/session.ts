/**
 * Session Extraction Helper — OllinAI Platform
 *
 * Provides utilities to extract and validate the authenticated session
 * from incoming requests. Used by API routes to get the authenticated
 * user context (tenantId, userId, role, teamIds).
 *
 * Requirements:
 *  - 7.4: JWT tokens with 1-hour validity
 *  - 7.5: HTTP 401 on missing, expired, or malformed tokens
 */

import { getToken } from "next-auth/jwt";
import { type NextRequest, NextResponse } from "next/server";
import type {
  AuthenticatedSession,
  JWTPayload,
  UserRole,
} from "@/lib/types/auth";

/** Error response for authentication failures */
export interface AuthErrorResponse {
  error: string;
  code: "MISSING_TOKEN" | "EXPIRED_TOKEN" | "MALFORMED_TOKEN" | "INVALID_TOKEN";
}

/**
 * Extracts and validates the authenticated session from a NextRequest.
 *
 * Returns an AuthenticatedSession on success, or a NextResponse (HTTP 401)
 * on failure. Callers should check the return type to determine if
 * authentication succeeded.
 *
 * @example
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const result = await getAuthSession(request);
 *   if (result instanceof NextResponse) {
 *     return result; // 401 error response
 *   }
 *   const session: AuthenticatedSession = result;
 *   // Use session.tenantId, session.userId, etc.
 * }
 * ```
 */
export async function getAuthSession(
  request: NextRequest
): Promise<AuthenticatedSession | NextResponse> {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      return createAuthError("MISSING_TOKEN", "Authentication required");
    }

    // Validate required custom claims exist
    const tenantId = token.tenantId as string | undefined;
    const userId = token.userId as string | undefined;
    const role = token.role as UserRole | undefined;
    const teamIds = token.teamIds as string[] | undefined;

    if (!tenantId || !userId || !role) {
      return createAuthError(
        "MALFORMED_TOKEN",
        "Token is missing required claims"
      );
    }

    // Validate role is one of the known roles
    if (!isValidRole(role)) {
      return createAuthError("INVALID_TOKEN", "Token contains invalid role");
    }

    // Check token expiration
    const exp = token.exp as number | undefined;
    if (exp && Date.now() >= exp * 1000) {
      return createAuthError("EXPIRED_TOKEN", "Token has expired");
    }

    const session: AuthenticatedSession = {
      userId,
      tenantId,
      role,
      teamIds: teamIds ?? [],
      expiresAt: exp ? new Date(exp * 1000) : new Date(Date.now() + 3600000),
    };

    return session;
  } catch (error) {
    return createAuthError(
      "MALFORMED_TOKEN",
      "Unable to decode or verify token"
    );
  }
}

/**
 * Extracts the session from a request, throwing if not authenticated.
 * Useful when you want to handle the error differently from the standard
 * 401 response.
 */
export async function requireAuthSession(
  request: NextRequest
): Promise<AuthenticatedSession> {
  const result = await getAuthSession(request);
  if (result instanceof NextResponse) {
    throw new AuthenticationError("Authentication required");
  }
  return result;
}

/**
 * Type guard to check if a getAuthSession result is an authenticated session.
 */
export function isAuthenticated(
  result: AuthenticatedSession | NextResponse
): result is AuthenticatedSession {
  return !(result instanceof NextResponse);
}

/**
 * Converts an AuthenticatedSession to the JWTPayload format.
 * Useful for logging or passing session data to downstream services.
 */
export function sessionToJWTPayload(session: AuthenticatedSession): JWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: session.userId,
    tenantId: session.tenantId,
    userId: session.userId,
    role: session.role,
    teamIds: session.teamIds,
    iat: now,
    exp: Math.floor(session.expiresAt.getTime() / 1000),
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────────

const VALID_ROLES: UserRole[] = ["tenant_admin", "team_lead", "viewer"];

function isValidRole(role: string): role is UserRole {
  return VALID_ROLES.includes(role as UserRole);
}

function createAuthError(
  code: AuthErrorResponse["code"],
  message: string
): NextResponse {
  return NextResponse.json(
    { error: message, code } satisfies AuthErrorResponse,
    { status: 401 }
  );
}

/**
 * Custom error class for authentication failures.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}
