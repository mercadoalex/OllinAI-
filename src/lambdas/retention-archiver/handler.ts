/**
 * Retention Archiver Lambda Handler — OllinAI Platform
 *
 * Scheduled Lambda that runs every 24 hours via EventBridge rule.
 * Archives (deletes) data older than the tenant's tier retention period.
 *
 * Algorithm:
 * 1. Scan all tenants from ollinai-config (SUBSCRIPTION#current items)
 * 2. For each tenant, determine the retention period from their tier
 * 3. Query ollinai-events and ollinai-incidents for items older than the retention cutoff
 * 4. Delete archived items in batches
 *
 * On downgrade: existing data is retained until this job runs and applies the
 * new (shorter) retention period. Data is not immediately deleted on downgrade.
 *
 * Requirements: 8.6, 8.8
 */

import type { ScheduledEvent } from "aws-lambda";
import { QueryCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { tenantConfigKey } from "@/lib/dynamo/tenant-scope";
import { getRetentionDays, TIER_DEFINITIONS } from "@/lib/tiers/tier-config";
import type { SubscriptionTier, SubscriptionConfigItem } from "@/lib/types/dynamo";

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Maximum items to delete in a single batch run per tenant */
const MAX_ITEMS_PER_TENANT = 1000;

/** Batch size for DynamoDB delete operations */
const DELETE_BATCH_SIZE = 25;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ArchivalResult {
  tenantId: string;
  tier: SubscriptionTier;
  retentionDays: number | null;
  eventsArchived: number;
  incidentsArchived: number;
  skipped: boolean;
  error?: string;
}

export interface HandlerResult {
  tenantsProcessed: number;
  totalEventsArchived: number;
  totalIncidentsArchived: number;
  results: ArchivalResult[];
  executedAt: string;
}

// ─── Lambda Handler ────────────────────────────────────────────────────────────

/**
 * EventBridge scheduled event handler (runs every 24 hours).
 * Processes all tenants and archives data older than their retention period.
 */
export async function handler(_event: ScheduledEvent): Promise<HandlerResult> {
  const executedAt = new Date().toISOString();
  console.log(`[RetentionArchiver] Starting archival run at ${executedAt}`);

  // 1. Discover all tenant subscriptions
  const tenantSubscriptions = await getAllTenantSubscriptions();
  console.log(
    `[RetentionArchiver] Found ${tenantSubscriptions.length} tenant(s) to process`
  );

  const results: ArchivalResult[] = [];

  // 2. Process each tenant
  for (const { tenantId, tier } of tenantSubscriptions) {
    try {
      const result = await archiveTenantData(tenantId, tier);
      results.push(result);
    } catch (error) {
      console.error(
        `[RetentionArchiver] Failed to process tenant ${tenantId}:`,
        error
      );
      results.push({
        tenantId,
        tier,
        retentionDays: getRetentionDays(tier),
        eventsArchived: 0,
        incidentsArchived: 0,
        skipped: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const totalEventsArchived = results.reduce(
    (sum, r) => sum + r.eventsArchived,
    0
  );
  const totalIncidentsArchived = results.reduce(
    (sum, r) => sum + r.incidentsArchived,
    0
  );

  console.log(
    `[RetentionArchiver] Completed. Tenants: ${tenantSubscriptions.length}, ` +
      `Events archived: ${totalEventsArchived}, Incidents archived: ${totalIncidentsArchived}`
  );

  return {
    tenantsProcessed: tenantSubscriptions.length,
    totalEventsArchived,
    totalIncidentsArchived,
    results,
    executedAt,
  };
}

// ─── Tenant Discovery ──────────────────────────────────────────────────────────

interface TenantSubscription {
  tenantId: string;
  tier: SubscriptionTier;
}

/**
 * Scans ollinai-config for all SUBSCRIPTION#current items to discover tenants.
 * Uses a filter expression to find only subscription records.
 */
export async function getAllTenantSubscriptions(): Promise<TenantSubscription[]> {
  const client = getDocumentClient();
  const tenants: TenantSubscription[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: TableNames.CONFIG,
        FilterExpression: "SK = :sk",
        ExpressionAttributeValues: {
          ":sk": "SUBSCRIPTION#current",
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      })
    );

    if (result.Items) {
      for (const item of result.Items) {
        const pk = item.PK as string;
        // Extract tenantId from PK format: TENANT#{tenantId}
        const tenantId = pk.replace("TENANT#", "");
        const entityData = (item as SubscriptionConfigItem).entityData;
        tenants.push({
          tenantId,
          tier: entityData.tier,
        });
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  return tenants;
}

// ─── Per-Tenant Archival ───────────────────────────────────────────────────────

/**
 * Archives data for a single tenant based on their tier's retention period.
 * If the tier has unlimited retention (null), the tenant is skipped.
 */
export async function archiveTenantData(
  tenantId: string,
  tier: SubscriptionTier
): Promise<ArchivalResult> {
  const retentionDays = getRetentionDays(tier);

  // Enterprise tier has unlimited retention — skip archival
  if (retentionDays === null) {
    console.log(
      `[RetentionArchiver] Tenant ${tenantId} (${tier}): unlimited retention, skipping`
    );
    return {
      tenantId,
      tier,
      retentionDays: null,
      eventsArchived: 0,
      incidentsArchived: 0,
      skipped: true,
    };
  }

  // Calculate the cutoff timestamp
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffTimestamp = cutoffDate.toISOString();

  console.log(
    `[RetentionArchiver] Tenant ${tenantId} (${tier}): archiving data older than ${cutoffTimestamp} (${retentionDays} days)`
  );

  // Archive events older than retention
  const eventsArchived = await archiveOldEvents(tenantId, cutoffTimestamp);

  // Archive incidents older than retention
  const incidentsArchived = await archiveOldIncidents(tenantId, cutoffTimestamp);

  return {
    tenantId,
    tier,
    retentionDays,
    eventsArchived,
    incidentsArchived,
    skipped: false,
  };
}

// ─── Event Archival ────────────────────────────────────────────────────────────

/**
 * Queries and deletes deployment events older than the cutoff timestamp.
 * Uses GSI-1 (time-based) to find old events efficiently.
 */
async function archiveOldEvents(
  tenantId: string,
  cutoffTimestamp: string
): Promise<number> {
  const client = getDocumentClient();
  let totalDeleted = 0;

  // Query events using a scan with filter (since events are partitioned by service)
  // We scan ollinai-events for items with PK starting with TENANT#{tenantId}
  // and SK (DEPLOY#{timestamp}#...) where timestamp < cutoff
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  const pk = `TENANT#${tenantId}`;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: TableNames.EVENTS,
        FilterExpression:
          "begins_with(PK, :tenantPrefix) AND createdAt < :cutoff",
        ExpressionAttributeValues: {
          ":tenantPrefix": pk,
          ":cutoff": cutoffTimestamp,
        },
        Limit: MAX_ITEMS_PER_TENANT,
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      })
    );

    if (result.Items && result.Items.length > 0) {
      // Delete items in batches
      for (let i = 0; i < result.Items.length; i += DELETE_BATCH_SIZE) {
        const batch = result.Items.slice(i, i + DELETE_BATCH_SIZE);
        await deleteItems(TableNames.EVENTS, batch);
        totalDeleted += batch.length;
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;

    // Stop if we've hit the per-tenant limit
    if (totalDeleted >= MAX_ITEMS_PER_TENANT) {
      break;
    }
  } while (lastEvaluatedKey);

  return totalDeleted;
}

// ─── Incident Archival ─────────────────────────────────────────────────────────

/**
 * Queries and deletes incidents older than the cutoff timestamp.
 */
async function archiveOldIncidents(
  tenantId: string,
  cutoffTimestamp: string
): Promise<number> {
  const client = getDocumentClient();
  let totalDeleted = 0;
  const pk = `TENANT#${tenantId}`;

  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: TableNames.INCIDENTS,
        FilterExpression:
          "begins_with(PK, :tenantPrefix) AND detectionTimestamp < :cutoff",
        ExpressionAttributeValues: {
          ":tenantPrefix": pk,
          ":cutoff": cutoffTimestamp,
        },
        Limit: MAX_ITEMS_PER_TENANT,
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      })
    );

    if (result.Items && result.Items.length > 0) {
      for (let i = 0; i < result.Items.length; i += DELETE_BATCH_SIZE) {
        const batch = result.Items.slice(i, i + DELETE_BATCH_SIZE);
        await deleteItems(TableNames.INCIDENTS, batch);
        totalDeleted += batch.length;
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;

    if (totalDeleted >= MAX_ITEMS_PER_TENANT) {
      break;
    }
  } while (lastEvaluatedKey);

  return totalDeleted;
}

// ─── Batch Delete ──────────────────────────────────────────────────────────────

/**
 * Deletes a batch of items from a DynamoDB table.
 * Each item must have PK and SK attributes.
 */
async function deleteItems(
  tableName: string,
  items: Record<string, unknown>[]
): Promise<void> {
  const client = getDocumentClient();

  for (const item of items) {
    try {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            PK: item.PK as string,
            SK: item.SK as string,
          },
        })
      );
    } catch (error) {
      console.error(
        `[RetentionArchiver] Failed to delete item PK=${item.PK}, SK=${item.SK}:`,
        error
      );
      // Continue processing other items
    }
  }
}
