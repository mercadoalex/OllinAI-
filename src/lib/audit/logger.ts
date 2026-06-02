/**
 * Audit Logging Service — OllinAI Platform
 *
 * Provides structured audit event recording for Enterprise tier tenants.
 * Writes to the `ollinai-audit` DynamoDB table in append-only mode
 * (no delete or update operations are exposed).
 *
 * Requirements:
 *  - 12.1: Log configuration changes and data access events (Enterprise tier)
 *  - 12.2: Record actor, action, target resource, UTC timestamp (ms), source IP, outcome
 *  - 12.3: 365-day minimum retention regardless of tier retention period
 *  - 12.5: Append-only — no modify or delete by any user
 *  - 12.6: On downgrade from Enterprise, retain existing logs but stop recording new events
 */

import { randomUUID } from "crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { tenantAuditKey } from "@/lib/dynamo/tenant-scope";
import { getTenantSubscription } from "@/lib/middleware/tier-gate";
import type { AuditItem } from "@/lib/types/dynamo";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Parameters for recording an audit event.
 */
export interface AuditEventParams {
  /** Tenant ID for data isolation */
  tenantId: string;
  /** User ID of the actor performing the action */
  actor: string;
  /** Action performed (e.g., "team.create", "service.update", "integration.rotate_key") */
  action: string;
  /** Target resource identifier (e.g., "TEAM#team-123", "SVC#svc-456") */
  targetResource: string;
  /** Source IP address of the request */
  sourceIp: string;
  /** Outcome of the operation */
  outcome: "success" | "failure";
}

/**
 * Result of an audit log attempt.
 */
export interface AuditLogResult {
  /** Whether the audit event was recorded */
  recorded: boolean;
  /** The audit ID if recorded */
  auditId?: string;
  /** Reason if not recorded */
  reason?: "not_enterprise_tier";
}

// ─── Main Logger Function ──────────────────────────────────────────────────────

/**
 * Records an audit event to the ollinai-audit table.
 *
 * This function:
 * 1. Checks if the tenant is on Enterprise tier
 * 2. If not Enterprise, skips logging silently (does not throw)
 * 3. If Enterprise, writes an append-only record with all required fields
 *
 * The audit table has no TTL — 365-day retention is enforced at the
 * application level (no DynamoDB TTL configured).
 *
 * @example
 * ```ts
 * await logAuditEvent({
 *   tenantId: session.tenantId,
 *   actor: session.userId,
 *   action: "team.create",
 *   targetResource: "TEAM#team-123",
 *   sourceIp: request.headers.get("x-forwarded-for") ?? "unknown",
 *   outcome: "success",
 * });
 * ```
 */
export async function logAuditEvent(
  params: AuditEventParams
): Promise<AuditLogResult> {
  // Gate behind Enterprise tier — skip silently for other tiers
  const tier = await getTenantSubscription(params.tenantId);
  if (tier !== "enterprise") {
    return { recorded: false, reason: "not_enterprise_tier" };
  }

  const auditId = randomUUID();
  const timestamp = new Date().toISOString(); // ISO 8601 with ms precision

  const pk = tenantAuditKey(params.tenantId);
  const sk = `AUDIT#${timestamp}#${auditId}`;

  const item: AuditItem = {
    PK: pk,
    SK: sk,
    actor: params.actor,
    action: params.action,
    targetResource: params.targetResource,
    sourceIp: params.sourceIp,
    outcome: params.outcome,
    timestamp,
  };

  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TableNames.AUDIT,
      Item: item,
    })
  );

  return { recorded: true, auditId };
}
