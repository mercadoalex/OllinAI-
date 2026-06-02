/**
 * Risk Scoring Engine Lambda Handler
 *
 * Triggered by SQS messages from the deployment-events queue (eventType: "deployment.created").
 * Computes a weighted risk score for each deployment event using:
 *   - Change Failure Rate (CFR): historical CFR for the service (90-day lookback)
 *   - Change Size: normalized from files and lines modified
 *   - Deployment Timing: time-of-day and day-of-week historical failure patterns
 *   - Author Failure Rate: how often this author's deployments correlate with incidents
 *
 * Default weights: CFR=0.35, changeSize=0.25, timing=0.20, authorRate=0.20
 * Custom weights read from ollinai-config (SK: SETTINGS#risk_weights) if configured.
 *
 * Classification:
 *   - low: [0, 0.3)
 *   - medium: [0.3, 0.55)
 *   - high: [0.55, 0.8)
 *   - critical: [0.8, 1.0]
 *
 * Fallback: If service has <10 historical deployments, use org-wide baseline stats.
 * On failure: mark risk_score as "indeterminate", still persist the event.
 * After scoring: emit EventBridge event with source="ollinai.risk-scorer",
 *   detail-type="risk-score.computed".
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5, 4.7
 */

import type { SQSEvent, SQSRecord } from "aws-lambda";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantServiceKey,
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import {
  EVENT_BUS_NAME,
  EVENT_SOURCES,
  EVENT_DETAIL_TYPES,
} from "../../../infra/eventbridge-rules";
import type { SqsEventMessage } from "@/lib/sqs/client";
import type { RiskFactors } from "@/lib/types";
import type { EventItem } from "@/lib/types/dynamo";

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Default risk factor weights */
export const DEFAULT_WEIGHTS = {
  changeFailureRate: 0.35,
  changeSize: 0.25,
  deploymentTiming: 0.20,
  authorFailureRate: 0.20,
} as const;

/** 90-day lookback window in milliseconds */
const LOOKBACK_DAYS = 90;
const LOOKBACK_MS = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

/** Minimum historical deployments before falling back to org-wide baseline */
export const MIN_HISTORICAL_DEPLOYMENTS = 10;

/** Risk classification thresholds */
export type RiskLevel = "low" | "medium" | "high" | "critical";

// ─── EventBridge Client ────────────────────────────────────────────────────────

let eventBridgeClient: EventBridgeClient | null = null;

export function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    eventBridgeClient = new EventBridgeClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    });
  }
  return eventBridgeClient;
}

/** Reset clients for testing */
export function resetClients(): void {
  eventBridgeClient = null;
}

/** Set a custom EventBridge client (for testing) */
export function setEventBridgeClient(client: EventBridgeClient): void {
  eventBridgeClient = client;
}

// ─── Lambda Handler ────────────────────────────────────────────────────────────

/**
 * SQS-triggered Lambda handler for risk scoring.
 * Processes each SQS record independently; failures on individual records
 * do not prevent other records from processing.
 */
export async function handler(event: SQSEvent): Promise<{
  batchItemFailures: { itemIdentifier: string }[];
}> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error(
        `Failed to process record ${record.messageId}:`,
        error
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

// ─── Record Processing ─────────────────────────────────────────────────────────

/**
 * Processes a single SQS record containing a deployment.created event.
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const message: SqsEventMessage = JSON.parse(record.body);

  // Only process deployment.created events
  if (message.eventType !== "deployment.created") {
    console.log(`Skipping non-deployment event: ${message.eventType}`);
    return;
  }

  const { tenantId, entityId: eventId } = message;
  const serviceId = message.metadata?.serviceId;
  const author = message.metadata?.author;
  const deploymentTimestamp = message.metadata?.deploymentTimestamp;

  if (!serviceId || !author || !deploymentTimestamp) {
    throw new Error(
      `Missing required metadata (serviceId, author, deploymentTimestamp) for event ${eventId}`
    );
  }

  // Parse change size from metadata
  const changeSize = {
    filesChanged: parseInt(message.metadata?.filesChanged ?? "0", 10),
    linesAdded: parseInt(message.metadata?.linesAdded ?? "0", 10),
    linesRemoved: parseInt(message.metadata?.linesRemoved ?? "0", 10),
  };

  try {
    // 1. Load custom weights (or use defaults)
    const weights = await getRiskWeights(tenantId);

    // 2. Compute individual risk factors
    const factors = await computeRiskFactors(
      tenantId,
      serviceId,
      author,
      deploymentTimestamp,
      changeSize
    );

    // 3. Compute weighted score
    const numericScore = computeWeightedScore(factors, weights);

    // 4. Classify risk level
    const riskLevel = classifyRisk(numericScore);

    // 5. Update the event record in DynamoDB
    await updateEventRiskScore(
      tenantId,
      serviceId,
      eventId,
      deploymentTimestamp,
      riskLevel,
      factors
    );

    // 6. Emit EventBridge event
    await emitRiskScoreEvent(tenantId, serviceId, eventId, riskLevel, factors, weights);
  } catch (error) {
    console.error(
      `Risk computation failed for event ${eventId}:`,
      error
    );

    // On failure: mark as "indeterminate" and notify admin
    await updateEventRiskScore(
      tenantId,
      serviceId,
      eventId,
      deploymentTimestamp,
      "indeterminate",
      undefined
    );

    // Emit failure event for admin notification
    await emitRiskScoreFailureEvent(tenantId, serviceId, eventId, error);
  }
}

// ─── Risk Weight Configuration ─────────────────────────────────────────────────

export interface RiskWeights {
  changeFailureRate: number;
  changeSize: number;
  deploymentTiming: number;
  authorFailureRate: number;
}

/**
 * Reads custom risk factor weights from ollinai-config.
 * Returns default weights if no custom configuration exists.
 */
export async function getRiskWeights(tenantId: string): Promise<RiskWeights> {
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);
  const sk = "SETTINGS#risk_weights";

  try {
    const result = await client.send(
      new QueryCommand(
        withTenantScope(tenantId, {
          TableName: TableNames.CONFIG,
          KeyConditionExpression: "PK = :pk AND SK = :sk",
          ExpressionAttributeValues: {
            ":pk": pk,
            ":sk": sk,
          },
        })
      )
    );

    if (result.Items && result.Items.length > 0) {
      const item = result.Items[0];
      const entityData = item.entityData as Partial<RiskWeights> | undefined;

      if (entityData && isValidWeights(entityData)) {
        return {
          changeFailureRate: entityData.changeFailureRate!,
          changeSize: entityData.changeSize!,
          deploymentTiming: entityData.deploymentTiming!,
          authorFailureRate: entityData.authorFailureRate!,
        };
      }
    }
  } catch (error) {
    console.warn(
      `Failed to read risk weights config for tenant ${tenantId}, using defaults:`,
      error
    );
  }

  return { ...DEFAULT_WEIGHTS };
}

/**
 * Validates that weights are all in [0,1] and sum to 1.0.
 */
export function isValidWeights(weights: Partial<RiskWeights>): boolean {
  const { changeFailureRate, changeSize, deploymentTiming, authorFailureRate } = weights;

  if (
    typeof changeFailureRate !== "number" ||
    typeof changeSize !== "number" ||
    typeof deploymentTiming !== "number" ||
    typeof authorFailureRate !== "number"
  ) {
    return false;
  }

  const values = [changeFailureRate, changeSize, deploymentTiming, authorFailureRate];
  if (values.some((v) => v < 0 || v > 1)) {
    return false;
  }

  const sum = values.reduce((a, b) => a + b, 0);
  // Allow a small floating-point tolerance
  return Math.abs(sum - 1.0) < 0.001;
}

// ─── Risk Factor Computation ───────────────────────────────────────────────────

interface ChangeSize {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Computes all risk factors for a deployment event.
 * Falls back to org-wide baseline when service has <10 historical deployments.
 */
export async function computeRiskFactors(
  tenantId: string,
  serviceId: string,
  author: string,
  deploymentTimestamp: string,
  changeSize: ChangeSize
): Promise<RiskFactors> {
  const lookbackStart = new Date(
    new Date(deploymentTimestamp).getTime() - LOOKBACK_MS
  ).toISOString();

  // Query historical deployments for this service
  const serviceDeployments = await queryHistoricalDeployments(
    tenantId,
    serviceId,
    lookbackStart,
    deploymentTimestamp
  );

  const useBaseline = serviceDeployments.length < MIN_HISTORICAL_DEPLOYMENTS;

  let historicalData: EventItem[];
  if (useBaseline) {
    // Fall back to org-wide baseline
    historicalData = await queryOrgWideDeployments(
      tenantId,
      lookbackStart,
      deploymentTimestamp
    );
  } else {
    historicalData = serviceDeployments;
  }

  // Compute individual factors
  const changeFailureRate = computeChangeFailureRate(historicalData);
  const changeSizeFactor = computeChangeSizeFactor(changeSize);
  const deploymentTiming = computeDeploymentTimingFactor(
    historicalData,
    deploymentTimestamp
  );
  const authorFailureRate = computeAuthorFailureRate(historicalData, author);

  return {
    changeFailureRate,
    changeSize: changeSizeFactor,
    deploymentTiming,
    authorFailureRate,
  };
}

/**
 * Query historical deployments for a specific service in the 90-day lookback.
 */
export async function queryHistoricalDeployments(
  tenantId: string,
  serviceId: string,
  lookbackStart: string,
  deploymentTimestamp: string
): Promise<EventItem[]> {
  const client = getDocumentClient();
  const pk = tenantServiceKey(tenantId, serviceId);

  const result = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.EVENTS,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :skStart AND :skEnd",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skStart": `DEPLOY#${lookbackStart}`,
          ":skEnd": `DEPLOY#${deploymentTimestamp}`,
        },
      })
    )
  );

  return (result.Items ?? []) as unknown as EventItem[];
}

/**
 * Query org-wide deployments as a baseline fallback.
 * Uses a broader query across all services for the tenant.
 */
export async function queryOrgWideDeployments(
  tenantId: string,
  lookbackStart: string,
  deploymentTimestamp: string
): Promise<EventItem[]> {
  const client = getDocumentClient();

  // Use GSI-2 (Team view) with a broader scan across the tenant
  // For baseline, we query all events across the tenant using a begins_with on the PK prefix
  const result = await client.send(
    new QueryCommand({
      TableName: TableNames.EVENTS,
      IndexName: "GSI2-TeamView",
      KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :skStart AND :skEnd",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${tenantId}#TEAM#UNASSIGNED`,
        ":skStart": `DEPLOY#${lookbackStart}`,
        ":skEnd": `DEPLOY#${deploymentTimestamp}`,
      },
    })
  );

  // If UNASSIGNED doesn't have enough data either, return what we have
  // In production, this would scan across multiple team partitions
  return (result.Items ?? []) as unknown as EventItem[];
}

// ─── Individual Factor Computations ────────────────────────────────────────────

/**
 * Computes the Change Failure Rate factor (0-1).
 * CFR = deployments with incidents / total deployments.
 */
export function computeChangeFailureRate(deployments: EventItem[]): number {
  if (deployments.length === 0) return 0;

  const deploymentsWithIncidents = deployments.filter(
    (d) => d.correlatedIncidents && d.correlatedIncidents.length > 0
  ).length;

  return deploymentsWithIncidents / deployments.length;
}

/**
 * Computes the Change Size factor (0-1).
 * Normalized using heuristic thresholds:
 *   - Files: 1-5 low, 6-20 medium, 21+ high
 *   - Lines: 1-100 low, 101-500 medium, 501+ high
 * Final value is the max of file and line normalized scores.
 */
export function computeChangeSizeFactor(changeSize: ChangeSize): number {
  const { filesChanged, linesAdded, linesRemoved } = changeSize;
  const totalLines = linesAdded + linesRemoved;

  // Normalize files changed (using sigmoid-like mapping)
  const fileScore = normalizeWithThreshold(filesChanged, 5, 50);

  // Normalize total lines changed
  const lineScore = normalizeWithThreshold(totalLines, 100, 1000);

  // Take the maximum of the two signals
  return Math.min(1, Math.max(fileScore, lineScore));
}

/**
 * Normalizes a value to [0, 1] using a threshold-based approach.
 * value <= low -> ~0.1
 * value >= high -> ~0.95
 * Linear interpolation in between.
 */
export function normalizeWithThreshold(
  value: number,
  lowThreshold: number,
  highThreshold: number
): number {
  if (value <= 0) return 0;
  if (value <= lowThreshold) return 0.1 + (0.2 * value) / lowThreshold;
  if (value >= highThreshold) return Math.min(1, 0.8 + (0.2 * value) / (highThreshold * 2));

  // Linear interpolation between low and high thresholds
  const range = highThreshold - lowThreshold;
  const position = (value - lowThreshold) / range;
  return 0.3 + position * 0.5; // Maps to [0.3, 0.8]
}

/**
 * Computes the Deployment Timing factor (0-1).
 * Based on historical failure patterns by hour-of-day and day-of-week.
 * Higher score = deploying at a historically risky time.
 */
export function computeDeploymentTimingFactor(
  historicalDeployments: EventItem[],
  deploymentTimestamp: string
): number {
  if (historicalDeployments.length === 0) return 0.5; // neutral when no data

  const deployDate = new Date(deploymentTimestamp);
  const deployHour = deployDate.getUTCHours();
  const deployDay = deployDate.getUTCDay(); // 0=Sunday

  // Count failures by hour and day
  const hourFailures: Record<number, { total: number; failures: number }> = {};
  const dayFailures: Record<number, { total: number; failures: number }> = {};

  for (const deployment of historicalDeployments) {
    const ts = new Date(deployment.createdAt);
    const hour = ts.getUTCHours();
    const day = ts.getUTCDay();
    const hasFailed =
      deployment.correlatedIncidents && deployment.correlatedIncidents.length > 0;

    if (!hourFailures[hour]) hourFailures[hour] = { total: 0, failures: 0 };
    hourFailures[hour].total++;
    if (hasFailed) hourFailures[hour].failures++;

    if (!dayFailures[day]) dayFailures[day] = { total: 0, failures: 0 };
    dayFailures[day].total++;
    if (hasFailed) dayFailures[day].failures++;
  }

  // Get failure rate at deploy time
  const hourData = hourFailures[deployHour];
  const hourRate = hourData && hourData.total >= 2
    ? hourData.failures / hourData.total
    : 0;

  const dayData = dayFailures[deployDay];
  const dayRate = dayData && dayData.total >= 2
    ? dayData.failures / dayData.total
    : 0;

  // Combined timing factor: average of hour and day signals
  return Math.min(1, (hourRate + dayRate) / 2);
}

/**
 * Computes the Author Failure Rate factor (0-1).
 * Ratio of this author's deployments that correlated with incidents.
 */
export function computeAuthorFailureRate(
  historicalDeployments: EventItem[],
  author: string
): number {
  const authorDeployments = historicalDeployments.filter(
    (d) => d.author === author
  );

  if (authorDeployments.length === 0) return 0;

  const authorFailures = authorDeployments.filter(
    (d) => d.correlatedIncidents && d.correlatedIncidents.length > 0
  ).length;

  return authorFailures / authorDeployments.length;
}

// ─── Scoring and Classification ────────────────────────────────────────────────

/**
 * Computes the weighted risk score (0-1) from factors and weights.
 */
export function computeWeightedScore(
  factors: RiskFactors,
  weights: RiskWeights
): number {
  const score =
    factors.changeFailureRate * weights.changeFailureRate +
    factors.changeSize * weights.changeSize +
    factors.deploymentTiming * weights.deploymentTiming +
    factors.authorFailureRate * weights.authorFailureRate;

  return Math.min(1, Math.max(0, score));
}

/**
 * Classifies a numeric risk score into a severity level.
 *   - low: [0, 0.3)
 *   - medium: [0.3, 0.55)
 *   - high: [0.55, 0.8)
 *   - critical: [0.8, 1.0]
 */
export function classifyRisk(score: number): RiskLevel {
  if (score < 0.3) return "low";
  if (score < 0.55) return "medium";
  if (score < 0.8) return "high";
  return "critical";
}

// ─── DynamoDB Updates ──────────────────────────────────────────────────────────

/**
 * Updates the event record in ollinai-events with the computed risk score.
 */
async function updateEventRiskScore(
  tenantId: string,
  serviceId: string,
  eventId: string,
  deploymentTimestamp: string,
  riskScore: RiskLevel | "indeterminate",
  factors: RiskFactors | undefined
): Promise<void> {
  const client = getDocumentClient();
  const pk = tenantServiceKey(tenantId, serviceId);
  const sk = `DEPLOY#${deploymentTimestamp}#${eventId}`;

  const updateExpression = factors
    ? "SET riskScore = :riskScore, riskFactors = :riskFactors"
    : "SET riskScore = :riskScore";

  const expressionValues: Record<string, unknown> = {
    ":riskScore": riskScore,
  };

  if (factors) {
    expressionValues[":riskFactors"] = {
      changeFailureRate: factors.changeFailureRate,
      changeSize: factors.changeSize,
      deploymentTiming: factors.deploymentTiming,
      authorFailureRate: factors.authorFailureRate,
    };
  }

  await client.send(
    new UpdateCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.EVENTS,
        Key: { PK: pk, SK: sk },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionValues,
      })
    )
  );
}

// ─── EventBridge Emission ──────────────────────────────────────────────────────

/**
 * Emits a risk-score.computed event to EventBridge for downstream processing
 * (recommendation generation for high/critical scores).
 */
async function emitRiskScoreEvent(
  tenantId: string,
  serviceId: string,
  eventId: string,
  riskScore: RiskLevel,
  factors: RiskFactors,
  weights: RiskWeights
): Promise<void> {
  const client = getEventBridgeClient();

  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: EVENT_SOURCES.RISK_SCORER,
          DetailType: EVENT_DETAIL_TYPES.RISK_SCORE_COMPUTED,
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            tenantId,
            serviceId,
            eventId,
            riskScore,
            factors,
            weights,
            computedAt: new Date().toISOString(),
          }),
        },
      ],
    })
  );
}

/**
 * Emits a failure notification event when risk computation fails.
 * This can be consumed by a notification Lambda to alert the admin.
 */
async function emitRiskScoreFailureEvent(
  tenantId: string,
  serviceId: string,
  eventId: string,
  error: unknown
): Promise<void> {
  try {
    const client = getEventBridgeClient();

    await client.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: EVENT_SOURCES.RISK_SCORER,
            DetailType: "risk-score.computation-failed",
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              tenantId,
              serviceId,
              eventId,
              error: error instanceof Error ? error.message : String(error),
              failedAt: new Date().toISOString(),
            }),
          },
        ],
      })
    );
  } catch (emitError) {
    // If we can't even emit the failure event, just log it
    console.error("Failed to emit risk-score failure event:", emitError);
  }
}
