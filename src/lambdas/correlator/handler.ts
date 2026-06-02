/**
 * Correlation Engine Lambda Handler
 *
 * Triggered by SQS messages from the incidents queue (eventType: "incident.created").
 * Links incidents to deployment events within the configured Correlation_Window.
 *
 * Algorithm:
 * 1. Read the incident from DynamoDB
 * 2. Read the correlation window from ollinai-config (or default to 60 minutes)
 * 3. Query ollinai-events GSI-1 for deployments within the window for the affected service
 * 4. Rank correlations by temporal proximity (most recent deployment first = rank 1)
 * 5. Update incident record with correlatedDeployments and correlationStatus
 * 6. Update each correlated deployment event: append incidentId to correlatedIncidents
 * 7. Emit correlation.created event to EventBridge
 *
 * Requirements: 2.2, 2.3, 2.5, 2.7
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
import type { CorrelationResult } from "@/lib/types";
import type { EventItem, IncidentItem } from "@/lib/types/dynamo";

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Default correlation window in minutes when no custom config exists */
const DEFAULT_CORRELATION_WINDOW_MINUTES = 60;

/** Minimum allowed correlation window (5 minutes) */
const MIN_CORRELATION_WINDOW_MINUTES = 5;

/** Maximum allowed correlation window (24 hours) */
const MAX_CORRELATION_WINDOW_MINUTES = 1440;

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
 * SQS-triggered Lambda handler for incident correlation.
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
 * Processes a single SQS record containing an incident.created event.
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const message: SqsEventMessage = JSON.parse(record.body);

  // Only process incident.created events
  if (message.eventType !== "incident.created") {
    console.log(`Skipping non-incident event: ${message.eventType}`);
    return;
  }

  const { tenantId, entityId: incidentId } = message;
  const serviceId = message.metadata?.serviceId;
  const detectionTimestamp = message.metadata?.detectionTimestamp;

  if (!serviceId || !detectionTimestamp) {
    throw new Error(
      `Missing required metadata (serviceId, detectionTimestamp) for incident ${incidentId}`
    );
  }

  // 1. Get the correlation window
  const windowMinutes = await getCorrelationWindow(tenantId);

  // 2. Query deployments within the correlation window
  const deployments = await queryDeploymentsInWindow(
    tenantId,
    serviceId,
    detectionTimestamp,
    windowMinutes
  );

  // 3. Rank by temporal proximity (most recent first)
  const rankedCorrelations = rankByTemporalProximity(
    deployments,
    detectionTimestamp
  );

  // 4. Determine correlation status
  const status: "correlated" | "uncorrelated" =
    rankedCorrelations.length > 0 ? "correlated" : "uncorrelated";

  // 5. Update the incident record with correlation results
  await updateIncidentCorrelation(
    tenantId,
    serviceId,
    incidentId,
    detectionTimestamp,
    rankedCorrelations,
    status
  );

  // 6. Update each correlated deployment event (append incidentId)
  await updateDeploymentEvents(
    tenantId,
    serviceId,
    incidentId,
    deployments
  );

  // 7. Emit correlation.created event to EventBridge
  const correlationResult: CorrelationResult = {
    incidentId,
    correlatedDeployments: rankedCorrelations,
    status,
  };

  await emitCorrelationEvent(tenantId, serviceId, correlationResult);
}

// ─── Correlation Window ────────────────────────────────────────────────────────

/**
 * Reads the tenant's custom correlation window from ollinai-config.
 * Returns the default (60 minutes) if no custom configuration exists.
 */
export async function getCorrelationWindow(
  tenantId: string
): Promise<number> {
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);
  const sk = "SETTINGS#correlation_window";

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
      const entityData = item.entityData as { windowMinutes?: number } | undefined;
      const windowMinutes = entityData?.windowMinutes;

      if (
        typeof windowMinutes === "number" &&
        windowMinutes >= MIN_CORRELATION_WINDOW_MINUTES &&
        windowMinutes <= MAX_CORRELATION_WINDOW_MINUTES
      ) {
        return windowMinutes;
      }
    }
  } catch (error) {
    console.warn(
      `Failed to read correlation window config for tenant ${tenantId}, using default:`,
      error
    );
  }

  return DEFAULT_CORRELATION_WINDOW_MINUTES;
}

// ─── Deployment Query ──────────────────────────────────────────────────────────

/**
 * Queries ollinai-events GSI-1 (CorrelationLookup) for deployments within
 * the correlation window preceding the incident detection time.
 *
 * GSI-1 key structure:
 *   PK: TENANT#{tenantId}#SVC#{serviceId}
 *   SK: TS#{deploymentTimestamp}
 */
export async function queryDeploymentsInWindow(
  tenantId: string,
  serviceId: string,
  incidentTimestamp: string,
  windowMinutes: number
): Promise<EventItem[]> {
  const client = getDocumentClient();
  const gsiPk = tenantServiceKey(tenantId, serviceId);

  const incidentTime = new Date(incidentTimestamp).getTime();
  const windowStart = new Date(
    incidentTime - windowMinutes * 60 * 1000
  ).toISOString();

  // GSI-1 SK format: TS#{deploymentTimestamp}
  const skStart = `TS#${windowStart}`;
  const skEnd = `TS#${incidentTimestamp}`;

  const result = await client.send(
    new QueryCommand({
      TableName: TableNames.EVENTS,
      IndexName: "GSI1-CorrelationLookup",
      KeyConditionExpression:
        "GSI1PK = :pk AND GSI1SK BETWEEN :skStart AND :skEnd",
      ExpressionAttributeValues: {
        ":pk": gsiPk,
        ":skStart": skStart,
        ":skEnd": skEnd,
      },
      ScanIndexForward: false, // Most recent first
    })
  );

  return (result.Items ?? []) as unknown as EventItem[];
}

// ─── Ranking ───────────────────────────────────────────────────────────────────

/**
 * Ranks deployments by temporal proximity to the incident detection time.
 * Most recent deployment gets rank 1 (closest to the incident).
 */
export function rankByTemporalProximity(
  deployments: EventItem[],
  incidentTimestamp: string
): CorrelationResult["correlatedDeployments"] {
  const incidentTime = new Date(incidentTimestamp).getTime();

  // Calculate temporal proximity for each deployment
  const withProximity = deployments.map((deployment) => {
    // Extract deployment timestamp from GSI1SK (format: TS#{timestamp})
    const deployTs = deployment.GSI1SK?.replace("TS#", "") ?? deployment.createdAt;
    const deployTime = new Date(deployTs).getTime();
    const temporalProximityMs = incidentTime - deployTime;

    return {
      eventId: deployment.eventId,
      temporalProximityMs,
    };
  });

  // Sort by temporal proximity ascending (smallest gap = most recent = rank 1)
  withProximity.sort((a, b) => a.temporalProximityMs - b.temporalProximityMs);

  // Assign ranks
  return withProximity.map((item, index) => ({
    eventId: item.eventId,
    temporalProximityMs: item.temporalProximityMs,
    rank: index + 1,
  }));
}

// ─── DynamoDB Updates ──────────────────────────────────────────────────────────

/**
 * Updates the incident record with correlation results.
 * Sets correlatedDeployments (ordered list of eventIds) and correlationStatus.
 */
async function updateIncidentCorrelation(
  tenantId: string,
  serviceId: string,
  incidentId: string,
  detectionTimestamp: string,
  correlations: CorrelationResult["correlatedDeployments"],
  status: "correlated" | "uncorrelated"
): Promise<void> {
  const client = getDocumentClient();
  const pk = tenantServiceKey(tenantId, serviceId);
  const sk = `INC#${detectionTimestamp}#${incidentId}`;

  const correlatedDeploymentIds = correlations.map((c) => c.eventId);

  await client.send(
    new UpdateCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.INCIDENTS,
        Key: { PK: pk, SK: sk },
        UpdateExpression:
          "SET correlatedDeployments = :deployments, correlationStatus = :status",
        ExpressionAttributeValues: {
          ":deployments": correlatedDeploymentIds,
          ":status": status,
        },
      })
    )
  );
}

/**
 * Updates each correlated deployment event to append the incidentId
 * to its correlatedIncidents list.
 */
async function updateDeploymentEvents(
  tenantId: string,
  serviceId: string,
  incidentId: string,
  deployments: EventItem[]
): Promise<void> {
  const client = getDocumentClient();

  for (const deployment of deployments) {
    try {
      await client.send(
        new UpdateCommand(
          withTenantScope(tenantId, {
            TableName: TableNames.EVENTS,
            Key: { PK: deployment.PK, SK: deployment.SK },
            UpdateExpression:
              "SET correlatedIncidents = list_append(if_not_exists(correlatedIncidents, :emptyList), :incidentId)",
            ExpressionAttributeValues: {
              ":incidentId": [incidentId],
              ":emptyList": [],
            },
          })
        )
      );
    } catch (error) {
      console.error(
        `Failed to update deployment ${deployment.eventId} with incident ${incidentId}:`,
        error
      );
      // Continue processing other deployments
    }
  }
}

// ─── EventBridge Emission ──────────────────────────────────────────────────────

/**
 * Emits a correlation.created event to EventBridge for downstream processing
 * (DORA recomputation, recommendation generation).
 */
async function emitCorrelationEvent(
  tenantId: string,
  serviceId: string,
  correlationResult: CorrelationResult
): Promise<void> {
  const client = getEventBridgeClient();

  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: EVENT_SOURCES.CORRELATOR,
          DetailType: EVENT_DETAIL_TYPES.CORRELATION_CREATED,
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            tenantId,
            serviceId,
            incidentId: correlationResult.incidentId,
            correlatedDeployments: correlationResult.correlatedDeployments,
            status: correlationResult.status,
            correlatedAt: new Date().toISOString(),
          }),
        },
      ],
    })
  );
}
