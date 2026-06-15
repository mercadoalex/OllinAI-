/**
 * Predictions metrics computer.
 *
 * Computes ML prediction accuracy, blocked/warned counts, false positive rate,
 * early warning count, and trend indicators from deployment events.
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { computeTrendIndicator } from "@/lib/metrics/utils";
import type { EventItem } from "@/lib/types/dynamo";
import type { MetricComputeContext, PredictionsMetricsResponse } from "./types";

/** Prediction score threshold: >= 0.5 means model predicted incident */
const PREDICTION_THRESHOLD = 0.5;

/** Threshold for simulating "blocked" gate decision */
const BLOCKED_THRESHOLD = 0.8;

/** Threshold for early warning flag simulation */
const EARLY_WARNING_THRESHOLD = 0.6;

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
 * Compute prediction accuracy.
 *
 * Accuracy = (true positives + true negatives) / total events with predictions × 100
 * - True positive: predictionScore >= threshold AND has correlatedIncidents (non-empty)
 * - True negative: predictionScore < threshold AND has NO correlatedIncidents
 */
function computePredictionAccuracy(eventsWithPredictions: EventItem[]): number {
  if (eventsWithPredictions.length === 0) return 0;

  let correctPredictions = 0;

  for (const event of eventsWithPredictions) {
    const predictedIncident = (event.predictionScore ?? 0) >= PREDICTION_THRESHOLD;
    const actualIncident =
      event.correlatedIncidents !== undefined &&
      event.correlatedIncidents.length > 0;

    if (
      (predictedIncident && actualIncident) ||
      (!predictedIncident && !actualIncident)
    ) {
      correctPredictions++;
    }
  }

  return (correctPredictions / eventsWithPredictions.length) * 100;
}

/**
 * Compute false positive rate.
 *
 * FPR = events with predictionScore >= threshold that have NO correlatedIncidents /
 *       all events with predictionScore >= threshold × 100
 */
function computeFalsePositiveRate(eventsWithPredictions: EventItem[]): number {
  const aboveThreshold = eventsWithPredictions.filter(
    (e) => (e.predictionScore ?? 0) >= PREDICTION_THRESHOLD
  );

  if (aboveThreshold.length === 0) return 0;

  const falsePositives = aboveThreshold.filter(
    (e) =>
      !e.correlatedIncidents || e.correlatedIncidents.length === 0
  ).length;

  return (falsePositives / aboveThreshold.length) * 100;
}

/**
 * Count events where gateDecision is "blocked".
 * For now, simulate with predictionScore > 0.8 as blocked.
 */
function computeBlockedCount(events: EventItem[]): number {
  return events.filter(
    (e) => e.predictionScore !== undefined && e.predictionScore > BLOCKED_THRESHOLD
  ).length;
}

/**
 * Count events with predictionScore between 0.5 and 0.8 (warned).
 */
function computeWarnedCount(events: EventItem[]): number {
  return events.filter(
    (e) =>
      e.predictionScore !== undefined &&
      e.predictionScore >= PREDICTION_THRESHOLD &&
      e.predictionScore <= BLOCKED_THRESHOLD
  ).length;
}

/**
 * Count events where predictionScore > 0.6 (simulates earlyWarning flag).
 */
function computeEarlyWarningCount(events: EventItem[]): number {
  return events.filter(
    (e) =>
      e.predictionScore !== undefined &&
      e.predictionScore > EARLY_WARNING_THRESHOLD
  ).length;
}

/**
 * Compute prediction metrics for the given context.
 *
 * Steps:
 * 1. Query events from GSI2-TeamView for the time range
 * 2. Filter events that have a predictionScore (not undefined)
 * 3. If no events have predictionScore → return "ml_inactive" for accuracy/FPR
 * 4. Compute prediction accuracy, blocked/warned counts, FPR, early warning count
 * 5. Compute trends by comparing current period to previous period
 */
export async function computePredictions(
  context: MetricComputeContext
): Promise<PredictionsMetricsResponse> {
  const teamId = context.teamId || "UNASSIGNED";

  // Query current period events
  const allEvents = await queryEventsByTeamView(
    context.tenantId,
    teamId,
    context.from,
    context.to
  );

  // Filter events that have a predictionScore
  const eventsWithPredictions = allEvents.filter(
    (e) => e.predictionScore !== undefined
  );

  // Handle ML inactive case
  if (eventsWithPredictions.length === 0) {
    return {
      predictionAccuracy: "ml_inactive",
      blockedCount: 0,
      warnedCount: 0,
      falsePositiveRate: "ml_inactive",
      earlyWarningCount: 0,
      period: {
        start: context.from.toISOString(),
        end: context.to.toISOString(),
      },
      filters: {
        team: context.teamId,
        service: context.serviceId,
      },
      note: "ML model inactive — no events with prediction scores in this period",
    };
  }

  // Compute current period metrics
  const predictionAccuracy = computePredictionAccuracy(eventsWithPredictions);
  const blockedCount = computeBlockedCount(allEvents);
  const warnedCount = computeWarnedCount(allEvents);
  const falsePositiveRate = computeFalsePositiveRate(eventsWithPredictions);
  const earlyWarningCount = computeEarlyWarningCount(allEvents);

  // Compute trends by comparing to previous period
  const periodDuration = context.to.getTime() - context.from.getTime();
  const previousFrom = new Date(context.from.getTime() - periodDuration);
  const previousTo = context.from;

  const previousEvents = await queryEventsByTeamView(
    context.tenantId,
    teamId,
    previousFrom,
    previousTo
  );

  const previousEventsWithPredictions = previousEvents.filter(
    (e) => e.predictionScore !== undefined
  );

  let predictionAccuracyTrend;
  let falsePositiveRateTrend;

  if (previousEventsWithPredictions.length > 0) {
    const previousAccuracy = computePredictionAccuracy(
      previousEventsWithPredictions
    );
    const previousFPR = computeFalsePositiveRate(
      previousEventsWithPredictions
    );

    // Higher accuracy is better
    predictionAccuracyTrend = computeTrendIndicator(
      predictionAccuracy,
      previousAccuracy,
      false
    );

    // Lower FPR is better
    falsePositiveRateTrend = computeTrendIndicator(
      falsePositiveRate,
      previousFPR,
      true
    );
  }

  return {
    predictionAccuracy,
    blockedCount,
    warnedCount,
    falsePositiveRate,
    earlyWarningCount,
    predictionAccuracyTrend,
    falsePositiveRateTrend,
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
