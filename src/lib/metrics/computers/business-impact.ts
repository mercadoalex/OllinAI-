/**
 * Business Impact metrics computer.
 *
 * Computes estimated downtime avoided, SLA compliance percentage,
 * and incident trend from events, incidents, and pre-computed metrics.
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { computeTrendIndicator } from "@/lib/metrics/utils";
import type { EventItem, IncidentItem, MetricsItem } from "@/lib/types/dynamo";
import type { MetricComputeContext, BusinessImpactResponse } from "./types";

/** Default average MTTR in hours when no metrics data is available */
const DEFAULT_MTTR_HOURS = 2;

/** Threshold for simulating "blocked" gate decision */
const BLOCKED_THRESHOLD = 0.8;

/**
 * Query deployment events from ollinai-events using GSI2-TeamView.
 */
async function queryEventsByTeamView(
  tenantId: string,
  teamId: string,
  from: Date,
  to: Date
): Promise<EventItem[]> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}#TEAM#${teamId}`;
  const skFrom = `DEPLOY#${from.toISOString()}`;
  const skTo = `DEPLOY#${to.toISOString()}`;

  const items: EventItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: TableNames.EVENTS,
      IndexName: "GSI2-TeamView",
      KeyConditionExpression:
        "GSI2PK = :pk AND GSI2SK BETWEEN :skFrom AND :skTo",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":skFrom": skFrom,
        ":skTo": skTo,
      },
      ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await client.send(command);
    if (result.Items) {
      items.push(...(result.Items as EventItem[]));
    }
    exclusiveStartKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return items;
}

/**
 * Query incidents from ollinai-incidents via GSI1-TimeRange.
 * PK = TENANT#{tenantId}, SK between INC#{from} and INC#{to}
 */
async function queryIncidentsByTimeRange(
  tenantId: string,
  from: Date,
  to: Date
): Promise<IncidentItem[]> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}`;
  const skFrom = `INC#${from.toISOString()}`;
  const skTo = `INC#${to.toISOString()}`;

  const items: IncidentItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: TableNames.INCIDENTS,
      IndexName: "GSI1-TimeRange",
      KeyConditionExpression:
        "GSI1PK = :pk AND GSI1SK BETWEEN :skFrom AND :skTo",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":skFrom": skFrom,
        ":skTo": skTo,
      },
      ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await client.send(command);
    if (result.Items) {
      items.push(...(result.Items as IncidentItem[]));
    }
    exclusiveStartKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return items;
}

/**
 * Query the latest MTTR value from ollinai-metrics.
 * PK = TENANT#{tenantId}#SCOPE#ALL#ALL, get latest record.
 */
async function queryAverageMTTR(tenantId: string): Promise<number> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}#SCOPE#ALL#ALL`;

  const command = new QueryCommand({
    TableName: TableNames.METRICS,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: {
      ":pk": pk,
    },
    ScanIndexForward: false, // Most recent first
    Limit: 1,
  });

  const result = await client.send(command);
  if (result.Items && result.Items.length > 0) {
    const metricsItem = result.Items[0] as MetricsItem;
    return metricsItem.mttrHours || DEFAULT_MTTR_HOURS;
  }

  return DEFAULT_MTTR_HOURS;
}

/**
 * Compute estimated downtime avoided.
 *
 * Count events with predictionScore > 0.8 AND riskScore in ["high", "critical"],
 * then multiply by average MTTR.
 */
function computeDowntimeAvoided(
  events: EventItem[],
  avgMTTR: number
): number {
  const blockedHighRisk = events.filter(
    (e) =>
      e.predictionScore !== undefined &&
      e.predictionScore > BLOCKED_THRESHOLD &&
      (e.riskScore === "high" || e.riskScore === "critical")
  );

  return blockedHighRisk.length * avgMTTR;
}

/**
 * Compute SLA compliance percentage.
 *
 * Steps:
 * 1. Find all critical-severity incidents in the period
 * 2. For each, compute active window: detectionTimestamp to resolutionTimestamp
 *    (cap unresolved at period end)
 * 3. Merge overlapping windows
 * 4. Total downtime minutes = sum of all merged windows
 * 5. SLA = ((total period minutes - downtime minutes) / total period minutes) × 100
 */
function computeSLACompliance(
  incidents: IncidentItem[],
  periodStart: Date,
  periodEnd: Date
): number {
  const totalPeriodMinutes =
    (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60);

  if (totalPeriodMinutes <= 0) return 100;

  // Filter critical-severity incidents
  const criticalIncidents = incidents.filter(
    (inc) => inc.severity === "critical"
  );

  if (criticalIncidents.length === 0) return 100;

  // Compute active windows
  const windows: Array<{ start: number; end: number }> = [];

  for (const incident of criticalIncidents) {
    const start = new Date(incident.detectionTimestamp).getTime();
    const end = incident.resolutionTimestamp
      ? new Date(incident.resolutionTimestamp).getTime()
      : periodEnd.getTime(); // Cap unresolved at period end

    // Clamp window to period boundaries
    const clampedStart = Math.max(start, periodStart.getTime());
    const clampedEnd = Math.min(end, periodEnd.getTime());

    if (clampedStart < clampedEnd) {
      windows.push({ start: clampedStart, end: clampedEnd });
    }
  }

  if (windows.length === 0) return 100;

  // Merge overlapping windows
  windows.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [windows[0]];

  for (let i = 1; i < windows.length; i++) {
    const current = windows[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      // Overlapping — extend the end
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  // Sum downtime minutes
  const downtimeMs = merged.reduce(
    (sum, w) => sum + (w.end - w.start),
    0
  );
  const downtimeMinutes = downtimeMs / (1000 * 60);

  return ((totalPeriodMinutes - downtimeMinutes) / totalPeriodMinutes) * 100;
}

/**
 * Compute business impact metrics for the given context.
 *
 * Steps:
 * 1. Query events from GSI2-TeamView for the time range
 * 2. Query incidents from GSI1-TimeRange for the time range
 * 3. Query average MTTR from ollinai-metrics
 * 4. Compute estimated downtime avoided, SLA compliance, incident trend
 * 5. Handle edge cases (no blocked deploys, no critical incidents)
 */
export async function computeBusinessImpact(
  context: MetricComputeContext
): Promise<BusinessImpactResponse> {
  const teamId = context.teamId || "UNASSIGNED";

  // Query current period data
  const [events, incidents, avgMTTR] = await Promise.all([
    queryEventsByTeamView(context.tenantId, teamId, context.from, context.to),
    queryIncidentsByTimeRange(context.tenantId, context.from, context.to),
    queryAverageMTTR(context.tenantId),
  ]);

  // Compute estimated downtime avoided
  const estimatedDowntimeAvoided = computeDowntimeAvoided(events, avgMTTR);

  // Compute SLA compliance
  const slaCompliancePercentage = computeSLACompliance(
    incidents,
    context.from,
    context.to
  );

  // Compute incident trend: compare total incident count current vs previous period
  const periodDuration = context.to.getTime() - context.from.getTime();
  const previousFrom = new Date(context.from.getTime() - periodDuration);
  const previousTo = context.from;

  const previousIncidents = await queryIncidentsByTimeRange(
    context.tenantId,
    previousFrom,
    previousTo
  );

  // Lower incident count is better
  const incidentTrend = computeTrendIndicator(
    incidents.length,
    previousIncidents.length,
    true
  );

  // Handle edge case notes
  const notes: BusinessImpactResponse["notes"] = {};

  if (estimatedDowntimeAvoided === 0) {
    notes.downtimeAvoided = "No deployments blocked in this period";
  }

  const criticalIncidents = incidents.filter(
    (inc) => inc.severity === "critical"
  );
  if (criticalIncidents.length === 0) {
    notes.slaCompliance = "No critical incidents in this period — 100% SLA";
  }

  return {
    estimatedDowntimeAvoided,
    slaCompliancePercentage,
    incidentTrend,
    period: {
      start: context.from.toISOString(),
      end: context.to.toISOString(),
    },
    filters: {
      team: context.teamId,
      service: context.serviceId,
    },
    notes: Object.keys(notes).length > 0 ? notes : undefined,
  };
}
