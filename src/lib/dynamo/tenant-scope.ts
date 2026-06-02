/**
 * Tenant Isolation Data Access Layer
 *
 * This module ensures strict data isolation at the DynamoDB partition key level.
 * All queries MUST go through this layer to guarantee that no request can ever
 * access data belonging to a different tenant.
 *
 * Key design:
 * - All partition keys are prefixed with `TENANT#{tenantId}`
 * - The `withTenantScope` helper wraps any query to enforce tenant boundaries
 * - Helper functions build properly scoped partition keys for each entity type
 *
 * Requirements: 7.1 — No API request or query can access data belonging to a different tenant
 */

import {
  QueryCommandInput,
  GetCommandInput,
  PutCommandInput,
  UpdateCommandInput,
  DeleteCommandInput,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "./client";

// ─── Tenant Partition Key Builders ─────────────────────────────────────────────

/**
 * Base tenant prefix used in all partition keys.
 */
export function tenantPrefix(tenantId: string): string {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required and cannot be empty");
  }
  return `TENANT#${tenantId}`;
}

/**
 * Build partition key for service-scoped entities (events, incidents, attestations).
 * Format: TENANT#{tenantId}#SVC#{serviceId}
 */
export function tenantServiceKey(tenantId: string, serviceId: string): string {
  if (!serviceId || serviceId.trim() === "") {
    throw new Error("serviceId is required and cannot be empty");
  }
  return `${tenantPrefix(tenantId)}#SVC#${serviceId}`;
}

/**
 * Build partition key for team-scoped entities (GSI-2 on events).
 * Format: TENANT#{tenantId}#TEAM#{teamId}
 */
export function tenantTeamKey(tenantId: string, teamId: string): string {
  if (!teamId || teamId.trim() === "") {
    throw new Error("teamId is required and cannot be empty");
  }
  return `${tenantPrefix(tenantId)}#TEAM#${teamId}`;
}

/**
 * Build partition key for deduplication lookups (GSI-3 on events).
 * Format: TENANT#{tenantId}#DEDUP
 */
export function tenantDedupKey(tenantId: string): string {
  return `${tenantPrefix(tenantId)}#DEDUP`;
}

/**
 * Build partition key for metrics scope.
 * Format: TENANT#{tenantId}#SCOPE#{scopeType}#{scopeId}
 */
export function tenantMetricsScopeKey(
  tenantId: string,
  scopeType: "TEAM" | "SERVICE" | "ENVIRONMENT" | "ALL",
  scopeId: string
): string {
  if (!scopeId || scopeId.trim() === "") {
    throw new Error("scopeId is required and cannot be empty");
  }
  return `${tenantPrefix(tenantId)}#SCOPE#${scopeType}#${scopeId}`;
}

/**
 * Build partition key for config entities (teams, services, integrations, subscriptions).
 * Format: TENANT#{tenantId}
 */
export function tenantConfigKey(tenantId: string): string {
  return tenantPrefix(tenantId);
}

/**
 * Build partition key for audit log entries.
 * Format: TENANT#{tenantId}
 */
export function tenantAuditKey(tenantId: string): string {
  return tenantPrefix(tenantId);
}

// ─── Query Scope Enforcement ───────────────────────────────────────────────────

/**
 * Validates that a partition key belongs to the given tenant.
 * This is a safety check that prevents accidental cross-tenant data access.
 */
export function assertTenantOwnership(
  tenantId: string,
  partitionKey: string
): void {
  const expectedPrefix = `TENANT#${tenantId}`;
  if (!partitionKey.startsWith(expectedPrefix)) {
    throw new Error(
      `Tenant isolation violation: partition key "${partitionKey}" does not belong to tenant "${tenantId}"`
    );
  }
}

// ─── Scoped Query Types ────────────────────────────────────────────────────────

export interface TenantScopedQueryInput
  extends Omit<QueryCommandInput, "TableName"> {
  TableName?: string;
}

export interface TenantScopedGetInput
  extends Omit<GetCommandInput, "TableName"> {
  TableName?: string;
}

export interface TenantScopedPutInput
  extends Omit<PutCommandInput, "TableName"> {
  TableName?: string;
}

export interface TenantScopedUpdateInput
  extends Omit<UpdateCommandInput, "TableName"> {
  TableName?: string;
}

export interface TenantScopedDeleteInput
  extends Omit<DeleteCommandInput, "TableName"> {
  TableName?: string;
}

// ─── withTenantScope — Core Isolation Wrapper ──────────────────────────────────

/**
 * Wraps a DynamoDB query/get/put/update/delete command input to enforce tenant scoping.
 *
 * This function validates that:
 * 1. The tenantId is provided and non-empty
 * 2. The partition key in the query starts with the tenant prefix
 *
 * It does NOT modify the query — it validates that the caller has already
 * correctly scoped the key. This ensures that misuse (e.g., passing another
 * tenant's key) is caught at the data access layer.
 *
 * Usage:
 * ```ts
 * const params = withTenantScope(tenantId, {
 *   TableName: TableNames.EVENTS,
 *   KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
 *   ExpressionAttributeValues: {
 *     ":pk": tenantServiceKey(tenantId, serviceId),
 *     ":sk": "DEPLOY#",
 *   },
 * });
 * const result = await getDocumentClient().send(new QueryCommand(params));
 * ```
 */
export function withTenantScope<
  T extends { Key?: Record<string, unknown>; ExpressionAttributeValues?: Record<string, unknown>; Item?: Record<string, unknown> }
>(tenantId: string, input: T): T {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required for all data access operations");
  }

  const expectedPrefix = `TENANT#${tenantId}`;

  // Check partition key in Key (Get, Update, Delete)
  if (input.Key && "PK" in input.Key) {
    const pk = input.Key.PK as string;
    if (!pk.startsWith(expectedPrefix)) {
      throw new Error(
        `Tenant isolation violation: Key.PK "${pk}" does not belong to tenant "${tenantId}"`
      );
    }
  }

  // Check partition key in Item (Put)
  if (input.Item && "PK" in input.Item) {
    const pk = input.Item.PK as string;
    if (!pk.startsWith(expectedPrefix)) {
      throw new Error(
        `Tenant isolation violation: Item.PK "${pk}" does not belong to tenant "${tenantId}"`
      );
    }
  }

  // Check partition key in ExpressionAttributeValues (Query)
  if (input.ExpressionAttributeValues) {
    const values = input.ExpressionAttributeValues;
    // Check common partition key value names
    const pkValueKeys = [":pk", ":PK", ":partitionKey"];
    for (const key of pkValueKeys) {
      if (key in values) {
        const pkValue = values[key] as string;
        if (typeof pkValue === "string" && !pkValue.startsWith(expectedPrefix)) {
          throw new Error(
            `Tenant isolation violation: ExpressionAttributeValues["${key}"] = "${pkValue}" does not belong to tenant "${tenantId}"`
          );
        }
      }
    }
  }

  return input;
}

// ─── Convenience Data Access Functions ─────────────────────────────────────────

/**
 * Execute a tenant-scoped query on the specified table.
 * Validates partition key ownership before executing.
 */
export async function tenantQuery(
  tenantId: string,
  params: TenantScopedQueryInput
) {
  const validated = withTenantScope(tenantId, params);
  const client = getDocumentClient();
  return client.send(new QueryCommand(validated as QueryCommandInput));
}

/**
 * Execute a tenant-scoped get on the specified table.
 * Validates partition key ownership before executing.
 */
export async function tenantGet(
  tenantId: string,
  params: TenantScopedGetInput
) {
  const validated = withTenantScope(tenantId, params);
  const client = getDocumentClient();
  return client.send(new GetCommand(validated as GetCommandInput));
}

/**
 * Execute a tenant-scoped put on the specified table.
 * Validates partition key ownership before executing.
 */
export async function tenantPut(
  tenantId: string,
  params: TenantScopedPutInput
) {
  const validated = withTenantScope(tenantId, params);
  const client = getDocumentClient();
  return client.send(new PutCommand(validated as PutCommandInput));
}

/**
 * Execute a tenant-scoped update on the specified table.
 * Validates partition key ownership before executing.
 */
export async function tenantUpdate(
  tenantId: string,
  params: TenantScopedUpdateInput
) {
  const validated = withTenantScope(tenantId, params);
  const client = getDocumentClient();
  return client.send(new UpdateCommand(validated as UpdateCommandInput));
}

/**
 * Execute a tenant-scoped delete on the specified table.
 * Validates partition key ownership before executing.
 */
export async function tenantDelete(
  tenantId: string,
  params: TenantScopedDeleteInput
) {
  const validated = withTenantScope(tenantId, params);
  const client = getDocumentClient();
  return client.send(new DeleteCommand(validated as DeleteCommandInput));
}
