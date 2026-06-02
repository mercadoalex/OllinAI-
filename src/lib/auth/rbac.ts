/**
 * Role-Based Access Control (RBAC) — OllinAI Platform
 *
 * Provides role validation logic for the three platform roles:
 * - Tenant Admin: Full access to all tenant resources
 * - Team Lead: Read/write access scoped to own teams' resources
 * - Viewer: Read-only access
 *
 * Requirements:
 *  - 7.2: RBAC enforcement with defined roles and permissions
 *  - 7.3: HTTP 403 for Viewer attempting write operations
 *  - 7.7: HTTP 403 for Team Lead accessing resources outside assigned teams
 */

import type {
  AuthenticatedSession,
  AuthorizationResult,
  Permission,
  ResourceType,
  UserRole,
} from "@/lib/types/auth";
import { ROLE_PERMISSIONS } from "@/lib/types/auth";

/**
 * Checks whether a role has a specific permission on a resource type.
 *
 * Uses the ROLE_PERMISSIONS matrix to determine if the operation is allowed
 * based solely on role (does not check team scope).
 */
export function hasPermission(
  role: UserRole,
  resource: ResourceType,
  permission: Permission
): boolean {
  const rolePermissions = ROLE_PERMISSIONS[role];
  if (!rolePermissions) {
    return false;
  }
  const resourcePermissions = rolePermissions[resource];
  if (!resourcePermissions) {
    return false;
  }
  return resourcePermissions.includes(permission);
}

/**
 * Checks whether a Team Lead user has access to a specific team's resources.
 *
 * Team Leads can only access resources belonging to teams they are assigned to.
 * Tenant Admins always pass this check. Viewers don't need team scope checks
 * because they are read-only.
 *
 * @param session - The authenticated session
 * @param targetTeamId - The team ID of the resource being accessed
 * @returns true if the user can access the team's resources
 */
export function isWithinTeamScope(
  session: AuthenticatedSession,
  targetTeamId: string
): boolean {
  // Tenant Admin can access all teams
  if (session.role === "tenant_admin") {
    return true;
  }

  // Team Lead can only access their assigned teams
  if (session.role === "team_lead") {
    return session.teamIds.includes(targetTeamId);
  }

  // Viewer: team scope is not relevant for write operations (they can't write),
  // and for read operations they have access to all teams' data
  return true;
}

/**
 * Performs a full authorization check combining role permission and team scope.
 *
 * @param session - The authenticated user session
 * @param resource - The resource type being accessed
 * @param permission - The operation being performed
 * @param targetTeamId - Optional team ID for scope enforcement (required for Team Lead write ops)
 * @returns AuthorizationResult indicating whether the operation is allowed
 */
export function authorize(
  session: AuthenticatedSession,
  resource: ResourceType,
  permission: Permission,
  targetTeamId?: string
): AuthorizationResult {
  // Step 1: Check role-based permission
  if (!hasPermission(session.role, resource, permission)) {
    return {
      allowed: false,
      reason: buildPermissionDeniedReason(session.role, resource, permission),
    };
  }

  // Step 2: For Team Lead with write operations, enforce team scope
  if (
    session.role === "team_lead" &&
    permission !== "read" &&
    targetTeamId !== undefined
  ) {
    if (!isWithinTeamScope(session, targetTeamId)) {
      return {
        allowed: false,
        reason: `Team Lead cannot modify resources belonging to team '${targetTeamId}'. You can only access resources for your assigned teams.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Builds a descriptive error reason for permission denial.
 */
function buildPermissionDeniedReason(
  role: UserRole,
  resource: ResourceType,
  permission: Permission
): string {
  const roleLabel = formatRoleLabel(role);

  if (role === "viewer") {
    return `Insufficient permissions: ${roleLabel} role cannot perform '${permission}' operations on '${resource}' resources. Viewer role is read-only.`;
  }

  return `Insufficient permissions: ${roleLabel} role does not have '${permission}' permission on '${resource}' resources.`;
}

/**
 * Formats a role identifier into a human-readable label.
 */
function formatRoleLabel(role: UserRole): string {
  switch (role) {
    case "tenant_admin":
      return "Tenant Admin";
    case "team_lead":
      return "Team Lead";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}
