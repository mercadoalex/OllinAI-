/**
 * Telemetry Processing Lambda Handler
 *
 * Triggered by SQS messages from the agent-telemetry queue.
 * Processes agent telemetry batches:
 *   - Extracts anomaly flags and resource metrics from events
 *   - Incorporates eBPF signals as Risk_Factors in Risk_Score computation
 *   - Correlates early warnings with Deployment_Events, escalates Risk_Score to critical
 *   - Applies healthy canary results (reduces Risk_Score by one level)
 *
 * Requirements: 13.11, 14.4, 14.5
 */

import type { SQSEvent, SQSRecord } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantServiceKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import type { SqsEventMessage } from "@/lib/sqs/client";
import type { RiskFactors } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Telemetry event as received from the agent. */
export interface AgentTelemetryEvent {
  type: string;
  pid?: number;
  ppid?: number;
  comm?: string;
  dest_addr?: string;
  dest_port?: number;
  domain?: string;
  path?: string;
  bytes_written?: number;
  cpu_percent?: number;
  memory_bytes?: number;
  timestamp_ns?: number;
  syscall_id?: number;
  count?: number;
  latency_ns?: number;
}

/** Anomaly signal extracted from telemetry. */
export interface AnomalySignal {
  type: "supply_chain" | "resource" | "network" | "syscall_deviation" | "kernel_error";
  severity: "low" | "medium" | "high" | "critical";
  detail: Record<string, unknown>;
}

/** Canary result from the agent. */
export interface CanaryResultEvent {
  type: "canary_healthy" | "canary_deviation" | "canary_early_warning";
  service_id: string;
  deviation_percent?: number;
  errors?: unknown[];
}

/** Risk level classification. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

// ─── Risk Level Utilities ──────────────────────────────────────────────────────

const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];

/**
 * Escalate a risk level to critical.
 */
export function escalateToCritical(): RiskLevel {
  return "critical";
}

/**
 * Reduce a risk level by one step (minimum: low).
 */
export function reduceRiskByOneLevel(current: RiskLevel): RiskLevel {
  const index = RISK_LEVELS.indexOf(current);
  if (index <= 0) return "low";
  return RISK_LEVELS[index - 1];
}

/**
 * Parse a risk level string, defaulting to "medium" if invalid.
 */
export function parseRiskLevel(value: string | undefined): RiskLevel {
  if (value && RISK_LEVELS.includes(value as RiskLevel)) {
    return value as RiskLevel;
  }
  return "medium";
}

// ─── Lambda Handler ────────────────────────────────────────────────────────────

/**
 * SQS-triggered Lambda handler for telemetry processing.
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
 * Processes a single SQS record containing a telemetry batch message.
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const message: SqsEventMessage = JSON.parse(record.body);

  if (message.eventType !== "telemetry.batch") {
    console.log(`Skipping non-telemetry event: ${message.eventType}`);
    return;
  }

  const { tenantId } = message;
  const serviceId = message.metadata?.serviceId;
  const pipelineId = message.metadata?.pipelineId;

  if (!serviceId) {
    throw new Error(`Missing serviceId in telemetry batch ${message.entityId}`);
  }

  // Extract anomaly signals from the batch metadata
  const anomalies = extractAnomalySignals(message);

  // Check for canary results
  const canaryResult = extractCanaryResult(message);

  // Find the most recent deployment event for this service
  const recentDeployment = await findRecentDeployment(tenantId, serviceId);

  if (!recentDeployment) {
    console.log(
      `No recent deployment found for tenant ${tenantId}, service ${serviceId}`
    );
    return;
  }

  // Incorporate eBPF signals into risk score
  if (anomalies.length > 0) {
    await incorporateAnomalySignals(
      tenantId,
      serviceId,
      recentDeployment,
      anomalies
    );
  }

  // Handle canary results
  if (canaryResult) {
    await handleCanaryResult(
      tenantId,
      serviceId,
      recentDeployment,
      canaryResult
    );
  }
}

// ─── Anomaly Extraction ────────────────────────────────────────────────────────

/**
 * Extracts anomaly signals from telemetry batch metadata.
 * In a full implementation, this would parse the actual telemetry events.
 * Here it processes the metadata flags set by the agent.
 */
export function extractAnomalySignals(
  message: SqsEventMessage
): AnomalySignal[] {
  const anomalies: AnomalySignal[] = [];
  const metadata = message.metadata ?? {};

  // Check for supply chain anomaly flag
  if (metadata.supplyChainAnomaly === "true") {
    anomalies.push({
      type: "supply_chain",
      severity: "critical",
      detail: {
        source: "ebpf_agent",
        batchId: message.entityId,
      },
    });
  }

  // Check for resource anomaly flag
  if (metadata.resourceAnomaly === "true") {
    anomalies.push({
      type: "resource",
      severity: "high",
      detail: {
        source: "ebpf_agent",
        batchId: message.entityId,
      },
    });
  }

  // Check for network anomaly flag
  if (metadata.networkAnomaly === "true") {
    anomalies.push({
      type: "network",
      severity: "high",
      detail: {
        source: "ebpf_agent",
        batchId: message.entityId,
      },
    });
  }

  // Check for syscall deviation (canary early warning)
  if (metadata.syscallDeviation === "true") {
    anomalies.push({
      type: "syscall_deviation",
      severity: "high",
      detail: {
        source: "ebpf_agent",
        batchId: message.entityId,
        deviationPercent: metadata.deviationPercent,
      },
    });
  }

  // Check for kernel error (early warning)
  if (metadata.kernelError === "true") {
    anomalies.push({
      type: "kernel_error",
      severity: "critical",
      detail: {
        source: "ebpf_agent",
        batchId: message.entityId,
        errorType: metadata.kernelErrorType,
      },
    });
  }

  return anomalies;
}

/**
 * Extracts canary result from telemetry metadata.
 */
export function extractCanaryResult(
  message: SqsEventMessage
): CanaryResultEvent | null {
  const metadata = message.metadata ?? {};

  if (metadata.canaryResult === "healthy") {
    return {
      type: "canary_healthy",
      service_id: metadata.serviceId ?? "",
    };
  }

  if (metadata.canaryResult === "deviation") {
    return {
      type: "canary_deviation",
      service_id: metadata.serviceId ?? "",
      deviation_percent: metadata.deviationPercent
        ? parseFloat(metadata.deviationPercent)
        : undefined,
    };
  }

  if (metadata.canaryResult === "early_warning") {
    return {
      type: "canary_early_warning",
      service_id: metadata.serviceId ?? "",
    };
  }

  return null;
}

// ─── Deployment Lookup ─────────────────────────────────────────────────────────

interface DeploymentRecord {
  PK: string;
  SK: string;
  eventId: string;
  riskScore?: string;
  riskFactors?: Record<string, number>;
  createdAt: string;
}

/**
 * Finds the most recent deployment event for a service.
 * Used to associate telemetry signals with the triggering deployment.
 */
export async function findRecentDeployment(
  tenantId: string,
  serviceId: string
): Promise<DeploymentRecord | null> {
  const client = getDocumentClient();
  const pk = tenantServiceKey(tenantId, serviceId);

  const result = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.EVENTS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skPrefix": "DEPLOY#",
        },
        ScanIndexForward: false, // Most recent first
        Limit: 1,
      })
    )
  );

  if (result.Items && result.Items.length > 0) {
    return result.Items[0] as unknown as DeploymentRecord;
  }

  return null;
}

// ─── Risk Score Updates ────────────────────────────────────────────────────────

/**
 * Incorporates eBPF anomaly signals as Risk_Factors in the deployment's Risk_Score.
 * If any critical anomaly (supply chain, kernel error) is detected, escalate to critical.
 *
 * Requirements: 13.11 - eBPF signals as Risk_Factors
 * Requirements: 14.4 - Early warning escalates Risk_Score to critical
 */
export async function incorporateAnomalySignals(
  tenantId: string,
  serviceId: string,
  deployment: DeploymentRecord,
  anomalies: AnomalySignal[]
): Promise<void> {
  const client = getDocumentClient();

  // Determine risk score update
  const hasCriticalAnomaly = anomalies.some(
    (a) => a.severity === "critical"
  );

  // Compute anomaly-based risk factors
  const supplyChainAnomaly = anomalies.some((a) => a.type === "supply_chain")
    ? 1.0
    : 0.0;
  const resourceAnomaly = anomalies.some((a) => a.type === "resource")
    ? 0.8
    : 0.0;

  // If critical anomaly (early warning), escalate to critical
  const newRiskScore: RiskLevel = hasCriticalAnomaly
    ? escalateToCritical()
    : parseRiskLevel(deployment.riskScore);

  // Update the event record with eBPF risk factors
  await client.send(
    new UpdateCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.EVENTS,
        Key: { PK: deployment.PK, SK: deployment.SK },
        UpdateExpression:
          "SET riskScore = :riskScore, #rf.supplyChainAnomaly = :supplyChain, #rf.resourceAnomaly = :resource",
        ExpressionAttributeNames: {
          "#rf": "riskFactors",
        },
        ExpressionAttributeValues: {
          ":riskScore": newRiskScore,
          ":supplyChain": supplyChainAnomaly,
          ":resource": resourceAnomaly,
        },
      })
    )
  );

  console.log(
    `Updated risk score for deployment ${deployment.eventId}: ${newRiskScore} ` +
      `(supplyChain=${supplyChainAnomaly}, resource=${resourceAnomaly})`
  );
}

/**
 * Handles canary observation results:
 * - Healthy canary: reduce Risk_Score by one level (minimum: low)
 * - Early warning: escalate Risk_Score to critical
 * - Deviation: keep current score but record deviation
 *
 * Requirements: 14.4, 14.5
 */
export async function handleCanaryResult(
  tenantId: string,
  serviceId: string,
  deployment: DeploymentRecord,
  canaryResult: CanaryResultEvent
): Promise<void> {
  const client = getDocumentClient();
  const currentRisk = parseRiskLevel(deployment.riskScore);
  let newRiskScore: RiskLevel;

  switch (canaryResult.type) {
    case "canary_healthy":
      // Reduce Risk_Score by one level (minimum: low)
      newRiskScore = reduceRiskByOneLevel(currentRisk);
      break;

    case "canary_early_warning":
      // Escalate to critical
      newRiskScore = escalateToCritical();
      break;

    case "canary_deviation":
      // Keep current risk — deviation noted but not automatically escalated
      newRiskScore = currentRisk;
      break;

    default:
      return;
  }

  await client.send(
    new UpdateCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.EVENTS,
        Key: { PK: deployment.PK, SK: deployment.SK },
        UpdateExpression:
          "SET riskScore = :riskScore, canaryResult = :canaryResult, canaryUpdatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":riskScore": newRiskScore,
          ":canaryResult": canaryResult.type,
          ":updatedAt": new Date().toISOString(),
        },
      })
    )
  );

  console.log(
    `Applied canary result (${canaryResult.type}) for deployment ${deployment.eventId}: ` +
      `${currentRisk} → ${newRiskScore}`
  );
}
