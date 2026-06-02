/**
 * Authorization Middleware — OllinAI Platform
 *
 * Composable middleware that checks role permissions per endpoint.
 * Designed to be used in API route handlers to enforce RBAC.
 *
 * Requirements:
 *  - 7.2: RBAC enforcement per endpoint
 *  - 7.3: HTTP 403 for unauthorized Viewer operations
 *  - 7.7: HTTP 403 for Team Lead accessing other teams' resources
 */

import { type NextRequest, NextResponse } from "next/server";
import type {
  AuthenticatedSession,
  Permission,
  ResourceType,
} from "@/lib/types/auth";
import { getAuthSession, isAuthenticated } from "@/lib/auth/session";
import { authorize, isWithinTeamScope } from "@/lib/auth/rbac";

/** Error response for authorization failures */
export interface AuthzErrorResponse {
  error: string;
  code: "FORBIDDEN" | "TEAM_SCOPE_VIOLATION";
}

/**
 * Options for the authorization middleware.
 */
export interface AuthorizeOptions {
  /** The resource type being accessed */
  resource: ResourceType;
  /** The permission required for the operation */
  permission: Permission;
  /**
   * Optional function to extract the target team ID from the request.
   * Used for Team Lead scope enforcement. If provided and the user is a
   * Team Lead performing a write operation, the middleware will verify
   * they are assigned to the target team.
   */
  getTeamId?: (request: NextRequest) => string | undefined | Promise<string | undefined>;
}

/**
 * Result of a successful authorization check.
 * Contains the authenticated session so route handlers can use it.
 */
export interface AuthorizedContext {
  session: AuthenticatedSession;
}

/**
 * Performs authentication and authorization for an API route.
 *
 * Returns either an AuthorizedContext (on success) or a NextResponse
 * (on auth failure — 401 or 403). Callers should check the return type.
 *
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   const result = await withAuthorization(request, {
 *     resource: "team",
 *     permission: "create",
 *   });
 *   if (result instanceof NextResponse) {
 *     return result; // 401 or 403
 *   }
 *   const { session } = result;
 *   // Proceed with authorized operation...
 * }
 * ```
 *
 * @example Team-scoped authorization
 * ```ts
 * export async function PUT(request: NextRequest, { params }: { params: { teamId: string } }) {
 *   const result = await withAuthorization(request, {
 *     resource: "service",
 *     permission: "update",
 *     getTeamId: () => params.teamId,
 *   });
 *   if (result instanceof NextResponse) {
 *     return result;
 *   }
 *   // ...
 * }
 * ```
 */
export async function withAuthorization(
  request: NextRequest,
  options: AuthorizeOptions
): Promise<AuthorizedContext | NextResponse> {
  // Step 1: Authenticate — extract and validate session
  const authResult = await getAuthSession(request);
  if (!isAuthenticated(authResult)) {
    return authResult; // 401 response from session extraction
  }

  const session = authResult;

  // Step 2: Resolve team ID if a team scope extractor is provided
  let targetTeamId: string | undefined;
  if (options.getTeamId) {
    targetTeamId = await options.getTeamId(request);
  }

  // Step 3: Authorize — check role permission + team scope
  const authzResult = authorize(
    session,
    options.resource,
    options.permission,
    targetTeamId
  );

  if (!authzResult.allowed) {
    const code = getErrorCode(session.role, targetTeamId);
    return createForbiddenResponse(
      code,
      authzResult.reason ?? "You do not have permission to perform this action."
    );
  }

  return { session };
}

/**
 * Middleware that only checks team scope for an already-authenticated session.
 * Useful when you need to validate team access after authentication is
 * already confirmed (e.g., in a handler that fetches the teamId from a DB).
 *
 * @param session - The authenticated session
 * @param targetTeamId - The team ID of the resource being accessed
 * @returns null if authorized, or a 403 NextResponse if not
 */
export function checkTeamScope(
  session: AuthenticatedSession,
  targetTeamId: string
): NextResponse | null {
  if (!isWithinTeamScope(session, targetTeamId)) {
    return createForbiddenResponse(
      "TEAM_SCOPE_VIOLATION",
      `Team Lead cannot modify resources belonging to team '${targetTeamId}'. You can only access resources for your assigned teams.`
    );
  }
  return null;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────────

function getErrorCode(
  role: string,
  targetTeamId: string | undefined
): AuthzErrorResponse["code"] {
  if (role === "team_lead" && targetTeamId !== undefined) {
    return "TEAM_SCOPE_VIOLATION";
  }
  return "FORBIDDEN";
}

function createForbiddenResponse(
  code: AuthzErrorResponse["code"],
  message: string
): NextResponse {
  return NextResponse.json(
    { error: message, code } satisfies AuthzErrorResponse,
    { status: 403 }
  );
}
