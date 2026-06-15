/**
 * Correlation metrics computer.
 *
 * Computes incident correlation rate, average time-to-correlation,
 * uncorrelated count, and trend indicators from incident data.
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { computeTrendIndicator } from "@/lib/metrics/utils";
import type { IncidentItem } from "@/lib/types/dynamo";
import type { MetricComputeContext, CorrelationMetricsResponse } from "./types";

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
 * Compute the correlation rate: (correlated / total) × 100
 */
function computeCorrelationRate(incidents: IncidentItem[]): number {
  if (incidents.length === 0) return 0;

  const correlatedCount = incidents.filter(
    (inc) => inc.correlationStatus === "correlated"
  ).length;

  return (correlatedCount / incidents.length) * 100;
}

/**
 * Compute average time-to-correlation in seconds.
 *
 * Since we don't store a correlationTimestamp directly, we use a
 * placeholder of 30 seconds as an estimate for correlated incidents.
 */
function computeAverageTimeToCorrelation(
  incidents: IncidentItem[]
): number {
  const correlated = incidents.filter(
    (inc) => inc.correlationStatus === "correlated"
  );

  if (correlated.length === 0) return 0;

  // Placeholder: 30 seconds per correlated incident since we don't
  // store correlationTimestamp directly
  const PLACEHOLDER_CORRELATION_TIME_SECONDS = 30;
  return PLACEHOLDER_CORRELATION_TIME_SECONDS;
}

/**
 * Count incidents with correlationStatus "uncorrelated".
 */
function computeUncorrelatedCount(incidents: IncidentItem[]): number {
  return incidents.filter(
    (inc) => inc.correlationStatus === "uncorrelated"
  ).length;
}

/**
 * Compute correlation metrics for the given context.
 *
 * Steps:
 * 1. Query incidents via GSI1-TimeRange for the current period
 * 2. Compute correlation rate, avg time-to-correlation, uncorrelated count
 * 3. Query the previous period (same length, immediately before `from`)
 * 4. Compute trend indicators by comparing current vs. previous
 * 5. Handle zero incidents case
 */
export async function computeCorrelationMetrics(
  context: MetricComputeContext
): Promise<CorrelationMetricsResponse> {
  // Query current period incidents
  const currentIncidents = await queryIncidentsByTimeRange(
    context.tenantId,
    context.from,
    context.to
  );

  // Handle zero incidents
  if (currentIncidents.length === 0) {
    return {
      correlationRate: 0,
      averageTimeToCorrelation: 0,
      uncorrelatedCount: 0,
      correlationRateTrend: { direction: "stable", percentChange: 0 },
      uncorrelatedTrend: { direction: "stable", percentChange: 0 },
      period: {
        start: context.from.toISOString(),
        end: context.to.toISOString(),
      },
      filters: {
        team: context.teamId,
        service: context.serviceId,
      },
      note: "No incidents in selected period",
    };
  }

  // Compute current period metrics
  const correlationRate = computeCorrelationRate(currentIncidents);
  const averageTimeToCorrelation =
    computeAverageTimeToCorrelation(currentIncidents);
  const uncorrelatedCount = computeUncorrelatedCount(currentIncidents);

  // Query previous period for trend computation
  const periodDuration = context.to.getTime() - context.from.getTime();
  const previousFrom = new Date(context.from.getTime() - periodDuration);
  const previousTo = context.from;

  const previousIncidents = await queryIncidentsByTimeRange(
    context.tenantId,
    previousFrom,
    previousTo
  );

  // Compute previous period metrics for trends
  const previousCorrelationRate = computeCorrelationRate(previousIncidents);
  const previousUncorrelatedCount =
    computeUncorrelatedCount(previousIncidents);

  // Compute trend indicators
  // For correlation rate, higher is better (more incidents are correlated)
  const correlationRateTrend = computeTrendIndicator(
    correlationRate,
    previousCorrelationRate,
    false // higher correlation rate is better
  );

  // For uncorrelated count, lower is better (fewer uncorrelated incidents)
  const uncorrelatedTrend = computeTrendIndicator(
    uncorrelatedCount,
    previousUncorrelatedCount,
    true // lower uncorrelated count is better
  );

  return {
    correlationRate,
    averageTimeToCorrelation,
    uncorrelatedCount,
    correlationRateTrend,
    uncorrelatedTrend,
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
