/**
 * Authentication and authorization types for the OllinAI platform.
 *
 * JWT-based authentication with role-based access control (RBAC).
 * Token validity: 1 hour.
 */

// ─── Roles and Permissions ─────────────────────────────────────────────────────

/**
 * User roles supported by the platform.
 *
 * - tenant_admin: Full read/write access to all tenant resources
 * - team_lead: Read/write access to resources belonging to assigned teams only
 * - viewer: Read-only access to dashboards, metrics, and reports
 */
export type UserRole = "tenant_admin" | "team_lead" | "viewer";

/**
 * Operations that can be performed on resources.
 */
export type Permission = "read" | "create" | "update" | "delete";

/**
 * Resource types that permissions apply to.
 */
export type ResourceType =
  | "deployment_event"
  | "incident"
  | "team"
  | "service"
  | "integration"
  | "subscription"
  | "metrics"
  | "recommendation"
  | "audit_log"
  | "settings"
  | "api_export";

/**
 * A permission grant mapping a role to allowed operations on a resource type.
 */
export interface PermissionGrant {
  role: UserRole;
  resource: ResourceType;
  permissions: Permission[];
}

/**
 * Role-based permission matrix.
 * Defines what each role can do on each resource type.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Record<ResourceType, Permission[]>> = {
  tenant_admin: {
    deployment_event: ["read", "create", "update", "delete"],
    incident: ["read", "create", "update", "delete"],
    team: ["read", "create", "update", "delete"],
    service: ["read", "create", "update", "delete"],
    integration: ["read", "create", "update", "delete"],
    subscription: ["read", "create", "update", "delete"],
    metrics: ["read"],
    recommendation: ["read", "update", "delete"],
    audit_log: ["read"],
    settings: ["read", "create", "update", "delete"],
    api_export: ["read"],
  },
  team_lead: {
    deployment_event: ["read", "create", "update"],
    incident: ["read", "create", "update"],
    team: ["read", "update"],
    service: ["read", "update"],
    integration: ["read"],
    subscription: ["read"],
    metrics: ["read"],
    recommendation: ["read", "update"],
    audit_log: [],
    settings: ["read", "update"],
    api_export: ["read"],
  },
  viewer: {
    deployment_event: ["read"],
    incident: ["read"],
    team: ["read"],
    service: ["read"],
    integration: ["read"],
    subscription: ["read"],
    metrics: ["read"],
    recommendation: ["read"],
    audit_log: [],
    settings: ["read"],
    api_export: ["read"],
  },
};

// ─── JWT Payload ───────────────────────────────────────────────────────────────

/**
 * Claims embedded in the JWT token.
 * Token validity: 1 hour (3600 seconds).
 */
export interface JWTPayload {
  /** Subject: unique user identifier */
  sub: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId: string;
  /** User ID within the tenant */
  userId: string;
  /** User's role determining their permissions */
  role: UserRole;
  /** Team IDs the user belongs to (used for Team Lead scope enforcement) */
  teamIds: string[];
  /** Token issued-at timestamp (Unix epoch seconds) */
  iat: number;
  /** Token expiration timestamp (Unix epoch seconds, iat + 3600) */
  exp: number;
  /** Token issuer */
  iss?: string;
}

// ─── Session ───────────────────────────────────────────────────────────────────

/**
 * Authenticated session extracted from a validated JWT.
 * Used throughout the application for authorization checks.
 */
export interface AuthenticatedSession {
  /** User's unique identifier */
  userId: string;
  /** Tenant ID for data isolation */
  tenantId: string;
  /** User's role */
  role: UserRole;
  /** Teams the user is assigned to */
  teamIds: string[];
  /** Token expiration time */
  expiresAt: Date;
}

/**
 * Result of an authorization check.
 */
export interface AuthorizationResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for denial (when allowed is false) */
  reason?: string;
}
