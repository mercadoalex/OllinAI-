/**
 * Recommendation Engine Lambda Handler
 *
 * Triggered by EventBridge events:
 *   - "risk-score.computed" (when risk is high/critical) → generates factor-based recommendations
 *   - "correlation.created" → generates trend-based recommendations (20pp CFR increase in 7-day window)
 *
 * Category mapping from dominant risk factor:
 *   - changeSize dominant → "reduce_change_size"
 *   - deploymentTiming dominant → "adjust_timing"
 *   - authorFailureRate dominant → "increase_review"
 *   - Service exceeds 5 correlated incidents in 30 days → "split_service"
 *   - Service has no post-deploy observation + CFR > 15% → "add_canary"
 *
 * Suppression: Checks if same category + team + service was suppressed (14 days after dismissal).
 * Storage: Recommendations stored in ollinai-config (PK=TENANT#{tenantId}, SK=REC#{recommendationId}).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6
 */

import type { EventBridgeEvent } from "aws-lambda";
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  tenantServiceKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import type { RecommendationCategory } from "@/lib/types";
import type { RecommendationConfigItem } from "@/lib/types/dynamo";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Detail payload for risk-score.computed EventBridge events */
export interface RiskScoreComputedDetail {
  tenantId: string;
  serviceId: string;
  eventId: string;
  riskScore: "high" | "critical";
  factors: {
    changeFailureRate: number;
    changeSize: number;
    deploymentTiming: number;
    authorFailureRate: number;
  };
  weights: {
    changeFailureRate: number;
    changeSize: number;
    deploymentTiming: number;
    authorFailureRate: number;
  };
  computedAt: string;
}

/** Detail payload for correlation.created EventBridge events */
export interface CorrelationCreatedDetail {
  tenantId: string;
  serviceId: string;
  incidentId: string;
  status: "correlated" | "uncorrelated";
  correlatedDeployments: {
    eventId: string;
    temporalProximityMs: number;
    rank: number;
  }[];
  correlatedAt: string;
  teamId?: string;
}

/** Result of a recommendation generation attempt */
export interface RecommendationResult {
  generated: boolean;
  recommendationId?: string;
  category?: RecommendationCategory;
  reason?: string;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Suppression period in days after dismissal */
export const SUPPRESSION_DAYS = 14;

/** Minimum correlated incidents in 30 days to trigger split_service */
export const SPLIT_SERVICE_INCIDENT_THRESHOLD = 5;

/** CFR threshold (percentage) for add_canary recommendation */
export const CANARY_CFR_THRESHOLD = 15;

/** Trend-based: percentage point increase threshold */
export const TREND_CFR_INCREASE_THRESHOLD = 20;

/** Trend-based: minimum deployments in 7-day window */
export const TREND_MIN_DEPLOYMENTS = 5;

/** Trend evaluation: 7-day rolling window in milliseconds */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** 30-day window for incident counting */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Lambda Handler ────────────────────────────────────────────────────────────

/**
 * EventBridge-triggered Lambda handler for recommendation generation.
 * Handles both risk-score.computed and correlation.created events.
 */
export async function handler(
  event: EventBridgeEvent<string, unknown>
): Promise<RecommendationResult> {
  const detailType = event["detail-type"];
  const detail = event.detail as Record<string, unknown>;

  if (detailType === "risk-score.computed") {
    return handleRiskScoreEvent(detail as unknown as RiskScoreComputedDetail);
  }

  if (detailType === "correlation.created") {
    return handleCorrelationEvent(detail as unknown as CorrelationCreatedDetail);
  }

  console.log(`Skipping unsupported event type: ${detailType}`);
  return { generated: false, reason: "unsupported_event_type" };
}

// ─── Risk Score Event Handling ─────────────────────────────────────────────────

/**
 * Handles risk-score.computed events for high/critical scores.
 * Identifies the dominant risk factor and maps to a recommendation category.
 */
export async function handleRiskScoreEvent(
  detail: RiskScoreComputedDetail
): Promise<RecommendationResult> {
  const { tenantId, serviceId, factors, weights, riskScore } = detail;

  // Only process high/critical risk scores
  if (riskScore !== "high" && riskScore !== "critical") {
    return { generated: false, reason: "risk_score_not_high_or_critical" };
  }

  // Get the team for this service
  const teamId = await getServiceTeam(tenantId, serviceId);

  // Identify dominant risk factor (highest weighted contribution)
  const dominantFactor = getDominantFactor(factors, weights);

  // Map dominant factor to recommendation category
  const category = mapFactorToCategory(dominantFactor);

  if (!category) {
    // Req 5.6: Log for review when no category mapping applies
    console.warn(
      `[UNMAPPED_RISK_FACTOR] No recommendation category for dominant factor "${dominantFactor}" ` +
      `| tenantId=${tenantId} | serviceId=${serviceId} | riskScore=${riskScore} | factors=${JSON.stringify(factors)}`
    );
    return { generated: false, reason: `unmapped_factor:${dominantFactor}` };
  }

  // Check for special categories that need additional validation
  if (category === "split_service") {
    const shouldSplit = await checkSplitServiceCondition(tenantId, serviceId);
    if (!shouldSplit) {
      // Fall back to the next-best factor-based category
      const fallbackCategory = mapFactorToCategory(dominantFactor, true);
      if (!fallbackCategory) {
        return { generated: false, reason: "split_service_threshold_not_met" };
      }
      return generateRecommendation(
        tenantId, serviceId, teamId, fallbackCategory, factors, weights
      );
    }
  }

  if (category === "add_canary") {
    const shouldAddCanary = await checkCanaryCondition(tenantId, serviceId);
    if (!shouldAddCanary) {
      return { generated: false, reason: "canary_condition_not_met" };
    }
  }

  return generateRecommendation(
    tenantId, serviceId, teamId, category, factors, weights
  );
}

// ─── Correlation Event Handling (Trend-Based) ──────────────────────────────────

/**
 * Handles correlation.created events for trend-based recommendations.
 * Triggers when a team's CFR increases by >20pp over a 7-day rolling window
 * AND the team has ≥5 deployments in that window.
 */
export async function handleCorrelationEvent(
  detail: CorrelationCreatedDetail
): Promise<RecommendationResult> {
  const { tenantId, serviceId, status } = detail;

  // Only process correlated incidents
  if (status !== "correlated") {
    return { generated: false, reason: "incident_uncorrelated" };
  }

  // Get team for this service
  const teamId = detail.teamId ?? await getServiceTeam(tenantId, serviceId);

  // Check 7-day trend for the team
  const trendResult = await evaluateTeamCFRTrend(tenantId, teamId, serviceId);

  if (!trendResult.triggered) {
    return { generated: false, reason: "trend_threshold_not_met" };
  }

  // Generate trend-based recommendation
  const now = new Date();
  const windowStart = new Date(now.getTime() - SEVEN_DAYS_MS);

  const factors = {
    changeFailureRate: trendResult.currentCFR / 100,
    changeSize: 0,
    deploymentTiming: 0,
    authorFailureRate: 0,
  };
  const weights = {
    changeFailureRate: 1,
    changeSize: 0,
    deploymentTiming: 0,
    authorFailureRate: 0,
  };

  // Determine best category for the trend recommendation
  const category: RecommendationCategory = "increase_review";

  return generateRecommendation(
    tenantId,
    serviceId,
    teamId,
    category,
    factors,
    weights,
    {
      cfrIncrease: trendResult.increase,
      currentCFR: trendResult.currentCFR,
      previousCFR: trendResult.previousCFR,
      deploymentsInWindow: trendResult.deploymentsInWindow,
    }
  );
}

// ─── Dominant Factor Identification ────────────────────────────────────────────

/**
 * Identifies the risk factor with the highest weighted contribution.
 */
export function getDominantFactor(
  factors: RiskScoreComputedDetail["factors"],
  weights: RiskScoreComputedDetail["weights"]
): string {
  const contributions: Record<string, number> = {
    changeSize: factors.changeSize * weights.changeSize,
    deploymentTiming: factors.deploymentTiming * weights.deploymentTiming,
    authorFailureRate: factors.authorFailureRate * weights.authorFailureRate,
    changeFailureRate: factors.changeFailureRate * weights.changeFailureRate,
  };

  let dominant = "changeFailureRate";
  let maxContribution = -1;

  for (const [factor, contribution] of Object.entries(contributions)) {
    if (contribution > maxContribution) {
      maxContribution = contribution;
      dominant = factor;
    }
  }

  return dominant;
}

/**
 * Maps a dominant risk factor to a recommendation category.
 * Returns null if no mapping applies (Req 5.6).
 */
export function mapFactorToCategory(
  dominantFactor: string,
  skipSpecial = false
): RecommendationCategory | null {
  switch (dominantFactor) {
    case "changeSize":
      return "reduce_change_size";
    case "deploymentTiming":
      return "adjust_timing";
    case "authorFailureRate":
      return "increase_review";
    case "changeFailureRate":
      // changeFailureRate can map to split_service or add_canary
      // depending on additional conditions checked later
      if (skipSpecial) {
        return "increase_review"; // fallback
      }
      return "split_service"; // will be validated by checkSplitServiceCondition
    default:
      return null;
  }
}

// ─── Condition Checks ──────────────────────────────────────────────────────────

/**
 * Checks whether a service exceeds 5 correlated incidents in a 30-day window.
 * Requirement 5.2: "split into smaller services" trigger.
 */
export async function checkSplitServiceCondition(
  tenantId: string,
  serviceId: string
): Promise<boolean> {
  const client = getDocumentClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);

  try {
    const result = await client.send(
      new QueryCommand(
        withTenantScope(tenantId, {
          TableName: TableNames.EVENTS,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :skStart AND :skEnd",
          FilterExpression: "attribute_exists(correlatedIncidents) AND size(correlatedIncidents) > :zero",
          ExpressionAttributeValues: {
            ":pk": tenantServiceKey(tenantId, serviceId),
            ":skStart": `DEPLOY#${thirtyDaysAgo.toISOString()}`,
            ":skEnd": `DEPLOY#${now.toISOString()}~`,
            ":zero": 0,
          },
          Select: "COUNT",
        })
      )
    );

    return (result.Count ?? 0) >= SPLIT_SERVICE_INCIDENT_THRESHOLD;
  } catch (error) {
    console.error(`Error checking split_service condition for ${serviceId}:`, error);
    return false;
  }
}

/**
 * Checks whether a service has no post-deploy observation AND CFR > 15%.
 * Requirement 5.2: "add canary deployment" trigger.
 */
export async function checkCanaryCondition(
  tenantId: string,
  serviceId: string
): Promise<boolean> {
  const client = getDocumentClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);

  try {
    // Query recent deployments for the service to calculate CFR
    const result = await client.send(
      new QueryCommand(
        withTenantScope(tenantId, {
          TableName: TableNames.EVENTS,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :skStart AND :skEnd",
          ExpressionAttributeValues: {
            ":pk": tenantServiceKey(tenantId, serviceId),
            ":skStart": `DEPLOY#${thirtyDaysAgo.toISOString()}`,
            ":skEnd": `DEPLOY#${now.toISOString()}~`,
          },
        })
      )
    );

    const deployments = result.Items ?? [];
    if (deployments.length === 0) return false;

    const withIncidents = deployments.filter(
      (d) => d.correlatedIncidents && (d.correlatedIncidents as string[]).length > 0
    ).length;

    const cfr = (withIncidents / deployments.length) * 100;

    // No post-deploy observation (Phase 1 doesn't have eBPF agent active)
    // So if CFR > 15%, recommend canary
    return cfr > CANARY_CFR_THRESHOLD;
  } catch (error) {
    console.error(`Error checking canary condition for ${serviceId}:`, error);
    return false;
  }
}

// ─── Trend Evaluation ──────────────────────────────────────────────────────────

export interface TrendResult {
  triggered: boolean;
  currentCFR: number;
  previousCFR: number;
  increase: number;
  deploymentsInWindow: number;
}

/**
 * Evaluates whether a team's CFR has increased by >20pp in a 7-day window.
 * Requires at least 5 deployments in the window.
 */
export async function evaluateTeamCFRTrend(
  tenantId: string,
  teamId: string,
  serviceId: string
): Promise<TrendResult> {
  const client = getDocumentClient();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
  const fourteenDaysAgo = new Date(now.getTime() - 2 * SEVEN_DAYS_MS);

  const noTrend: TrendResult = {
    triggered: false,
    currentCFR: 0,
    previousCFR: 0,
    increase: 0,
    deploymentsInWindow: 0,
  };

  try {
    // Query current 7-day window deployments for the team
    const currentResult = await client.send(
      new QueryCommand({
        TableName: TableNames.EVENTS,
        IndexName: "GSI2-TeamView",
        KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :skStart AND :skEnd",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}#TEAM#${teamId}`,
          ":skStart": `DEPLOY#${sevenDaysAgo.toISOString()}`,
          ":skEnd": `DEPLOY#${now.toISOString()}~`,
        },
      })
    );

    const currentDeployments = currentResult.Items ?? [];

    // Must have ≥5 deployments in the window
    if (currentDeployments.length < TREND_MIN_DEPLOYMENTS) {
      return { ...noTrend, deploymentsInWindow: currentDeployments.length };
    }

    // Query previous 7-day window for comparison
    const previousResult = await client.send(
      new QueryCommand({
        TableName: TableNames.EVENTS,
        IndexName: "GSI2-TeamView",
        KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :skStart AND :skEnd",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}#TEAM#${teamId}`,
          ":skStart": `DEPLOY#${fourteenDaysAgo.toISOString()}`,
          ":skEnd": `DEPLOY#${sevenDaysAgo.toISOString()}`,
        },
      })
    );

    const previousDeployments = previousResult.Items ?? [];

    // Compute CFR for both windows
    const currentCFR = computeCFRPercentage(currentDeployments);
    const previousCFR = previousDeployments.length > 0
      ? computeCFRPercentage(previousDeployments)
      : 0;

    const increase = currentCFR - previousCFR;

    return {
      triggered: increase > TREND_CFR_INCREASE_THRESHOLD,
      currentCFR,
      previousCFR,
      increase,
      deploymentsInWindow: currentDeployments.length,
    };
  } catch (error) {
    console.error(`Error evaluating CFR trend for team ${teamId}:`, error);
    return noTrend;
  }
}

/**
 * Computes CFR as a percentage (0-100) from a set of deployment items.
 */
export function computeCFRPercentage(deployments: Record<string, unknown>[]): number {
  if (deployments.length === 0) return 0;

  const withIncidents = deployments.filter(
    (d) => d.correlatedIncidents && (d.correlatedIncidents as string[]).length > 0
  ).length;

  return (withIncidents / deployments.length) * 100;
}

// ─── Recommendation Generation ─────────────────────────────────────────────────

/**
 * Generates and stores a recommendation after checking suppression.
 */
export async function generateRecommendation(
  tenantId: string,
  serviceId: string,
  teamId: string,
  category: RecommendationCategory,
  factors: RiskScoreComputedDetail["factors"],
  weights: RiskScoreComputedDetail["weights"],
  additionalMetrics?: Record<string, number>
): Promise<RecommendationResult> {
  // Check suppression before generating
  const isSuppressed = await isRecommendationSuppressed(
    tenantId, serviceId, teamId, category
  );

  if (isSuppressed) {
    return { generated: false, reason: "suppressed" };
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
  const recommendationId = generateId();

  const triggeringMetrics: Record<string, number> = {
    ...additionalMetrics,
  };

  // Include factor values that triggered this recommendation
  if (factors.changeFailureRate > 0) {
    triggeringMetrics.changeFailureRate = factors.changeFailureRate;
  }
  if (factors.changeSize > 0) {
    triggeringMetrics.changeSize = factors.changeSize;
  }
  if (factors.deploymentTiming > 0) {
    triggeringMetrics.deploymentTiming = factors.deploymentTiming;
  }
  if (factors.authorFailureRate > 0) {
    triggeringMetrics.authorFailureRate = factors.authorFailureRate;
  }

  const recommendation: RecommendationConfigItem = {
    PK: tenantConfigKey(tenantId),
    SK: `REC#${recommendationId}`,
    entityData: {
      id: recommendationId,
      category,
      targetService: serviceId,
      targetTeam: teamId,
      triggeringMetrics,
      timeRangeEvaluated: {
        start: sevenDaysAgo.toISOString(),
        end: now.toISOString(),
      },
      generatedAt: now.toISOString(),
    },
  };

  // Store recommendation
  const client = getDocumentClient();
  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: recommendation,
      })
    )
  );

  return {
    generated: true,
    recommendationId,
    category,
  };
}

// ─── Suppression Check ─────────────────────────────────────────────────────────

/**
 * Checks if a recommendation of the given category is suppressed
 * for the specified team + service combination.
 * Suppression lasts 14 days after a dismissal.
 */
export async function isRecommendationSuppressed(
  tenantId: string,
  serviceId: string,
  teamId: string,
  category: RecommendationCategory
): Promise<boolean> {
  const client = getDocumentClient();
  const now = new Date();

  try {
    // Query existing recommendations for this tenant
    const result = await client.send(
      new QueryCommand(
        withTenantScope(tenantId, {
          TableName: TableNames.CONFIG,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          FilterExpression:
            "entityData.category = :category AND entityData.targetService = :service AND entityData.targetTeam = :team AND entityData.suppressedUntil > :now",
          ExpressionAttributeValues: {
            ":pk": tenantConfigKey(tenantId),
            ":skPrefix": "REC#",
            ":category": category,
            ":service": serviceId,
            ":team": teamId,
            ":now": now.toISOString(),
          },
        })
      )
    );

    return (result.Items ?? []).length > 0;
  } catch (error) {
    console.error(
      `Error checking suppression for ${category}/${teamId}/${serviceId}:`,
      error
    );
    // On error, don't suppress — allow recommendation to be generated
    return false;
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Retrieves the team that owns a given service.
 * Returns "UNASSIGNED" if not found.
 */
export async function getServiceTeam(
  tenantId: string,
  serviceId: string
): Promise<string> {
  const client = getDocumentClient();

  try {
    const result = await client.send(
      new QueryCommand(
        withTenantScope(tenantId, {
          TableName: TableNames.CONFIG,
          KeyConditionExpression: "PK = :pk AND SK = :sk",
          ExpressionAttributeValues: {
            ":pk": tenantConfigKey(tenantId),
            ":sk": `SVC#${serviceId}`,
          },
        })
      )
    );

    if (result.Items && result.Items.length > 0) {
      const item = result.Items[0];
      const entityData = item.entityData as { owningTeamId?: string } | undefined;
      return entityData?.owningTeamId ?? "UNASSIGNED";
    }
  } catch (error) {
    console.warn(`Failed to get team for service ${serviceId}:`, error);
  }

  return "UNASSIGNED";
}

/**
 * Generates a unique recommendation ID.
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `rec-${timestamp}-${random}`;
}
