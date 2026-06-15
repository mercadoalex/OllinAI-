/**
 * Risk metrics computer.
 *
 * Computes risk distribution, high/critical daily trend, and per-service
 * average risk scores from deployment events in the selected time range.
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { groupEventsByDay, computeAverageRiskScore } from "@/lib/metrics/utils";
import type { EventItem } from "@/lib/types/dynamo";
import type { MetricComputeContext, RiskMetricsResponse } from "./types";
import { MINIMUM_EVENTS_REQUIRED } from "./types";

/**
 * Query deployment events from ollinai-events using GSI2-TeamView.
 * Uses the team-scoped partition key with date range on sort key.
 */
async function queryEventsByTeamView(
  context: MetricComputeContext
): Promise<EventItem[]> {
  const client = getDocumentClient();
  const teamId = context.teamId || "UNASSIGNED";
  const pk = `TENANT#${context.tenantId}#TEAM#${teamId}`;
  const skFrom = `DEPLOY#${context.from.toISOString()}`;
  const skTo = `DEPLOY#${context.to.toISOString()}`;

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
 * Query deployment events for a specific service using the primary key pattern.
 */
async function queryEventsByService(
  context: MetricComputeContext
): Promise<EventItem[]> {
  const client = getDocumentClient();
  const pk = `TENANT#${context.tenantId}#SVC#${context.serviceId}`;
  const skFrom = `DEPLOY#${context.from.toISOString()}`;
  const skTo = `DEPLOY#${context.to.toISOString()}`;

  const items: EventItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: TableNames.EVENTS,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :skFrom AND :skTo",
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
 * Compute risk distribution counts by severity level.
 */
function computeDistribution(events: EventItem[]): {
  low: number;
  medium: number;
  high: number;
  critical: number;
} {
  const distribution = { low: 0, medium: 0, high: 0, critical: 0 };

  for (const event of events) {
    if (
      event.riskScore &&
      event.riskScore !== "indeterminate" &&
      event.riskScore in distribution
    ) {
      distribution[event.riskScore]++;
    }
  }

  return distribution;
}

/**
 * Compute the high/critical daily trend using groupEventsByDay.
 * Returns an array of { date, highCriticalCount } for every day in the range.
 */
function computeHighCriticalTrend(
  events: EventItem[],
  from: Date,
  to: Date
): Array<{ date: string; highCriticalCount: number }> {
  const dayGroups = groupEventsByDay(events, from, to);
  const trend: Array<{ date: string; highCriticalCount: number }> = [];

  for (const [date, dayEvents] of dayGroups) {
    const highCriticalCount = dayEvents.filter(
      (e) => e.riskScore === "high" || e.riskScore === "critical"
    ).length;
    trend.push({ date, highCriticalCount });
  }

  return trend;
}

/**
 * Compute average risk score by service, sorted descending, top 10.
 */
function computeAverageByService(
  events: EventItem[]
): Array<{
  serviceId: string;
  serviceName: string;
  averageScore: number;
  eventCount: number;
}> {
  // Group events by service
  const serviceMap = new Map<string, EventItem[]>();

  for (const event of events) {
    for (const service of event.services) {
      const existing = serviceMap.get(service) || [];
      existing.push(event);
      serviceMap.set(service, existing);
    }
  }

  // Compute average per service
  const serviceAverages: Array<{
    serviceId: string;
    serviceName: string;
    averageScore: number;
    eventCount: number;
  }> = [];

  for (const [serviceId, serviceEvents] of serviceMap) {
    const averageScore = computeAverageRiskScore(serviceEvents);
    serviceAverages.push({
      serviceId,
      serviceName: serviceId, // Service name lookup would require config query
      averageScore,
      eventCount: serviceEvents.length,
    });
  }

  // Sort descending by averageScore, return top 10
  serviceAverages.sort((a, b) => b.averageScore - a.averageScore);
  return serviceAverages.slice(0, 10);
}

/**
 * Compute risk metrics for the given context.
 *
 * Steps:
 * 1. Query events via GSI2-TeamView (or by service PK if serviceId is provided)
 * 2. Check insufficient data threshold (< 3 events)
 * 3. Compute risk distribution, high/critical trend, and per-service averages
 */
export async function computeRiskMetrics(
  context: MetricComputeContext
): Promise<RiskMetricsResponse> {
  // Query events based on whether a service filter is active
  const events = context.serviceId
    ? await queryEventsByService(context)
    : await queryEventsByTeamView(context);

  // Handle insufficient data
  if (events.length < MINIMUM_EVENTS_REQUIRED) {
    return {
      distribution: { low: 0, medium: 0, high: 0, critical: 0 },
      trend: [],
      averageByService: [],
      period: {
        start: context.from.toISOString(),
        end: context.to.toISOString(),
      },
      filters: {
        team: context.teamId,
        service: context.serviceId,
      },
    };
  }

  const distribution = computeDistribution(events);
  const trend = computeHighCriticalTrend(events, context.from, context.to);
  const averageByService = computeAverageByService(events);

  return {
    distribution,
    trend,
    averageByService,
    period: {
      start: context.from.toISOString(),
      end: context.to.toISOString(),
    },
    filters: {
      team: context.teamId,
      service: context.serviceId,
    },
  };
}
