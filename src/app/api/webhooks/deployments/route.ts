/**
 * Deployment Event Ingestion Webhook Endpoint
 *
 * POST /api/webhooks/deployments
 *
 * Receives deployment events from CI/CD pipelines, validates them,
 * persists to DynamoDB, and enqueues for async processing.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { verifySignature } from "@/lib/webhooks/hmac";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantServiceKey,
  tenantDedupKey,
  tenantTeamKey,
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { sendMessage, type SqsEventMessage } from "@/lib/sqs/client";
import { QueryCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { EventItem } from "@/lib/types/dynamo";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const DeploymentEventSchema = z.object({
  commitShas: z
    .array(z.string().min(1))
    .min(1, "At least one commit SHA is required")
    .max(50, "Maximum 50 commit SHAs allowed"),
  author: z.string().min(1, "Author identifier is required"),
  services: z
    .array(z.string().min(1))
    .min(1, "At least one service name is required")
    .max(20, "Maximum 20 services allowed"),
  deploymentTimestamp: z
    .string()
    .refine(
      (val) => !isNaN(Date.parse(val)),
      "deploymentTimestamp must be a valid ISO 8601 date"
    ),
  environment: z.string().min(1, "Environment is required"),
  changeSize: z
    .object({
      linesAdded: z.number().int().min(0).optional(),
      linesRemoved: z.number().int().min(0).optional(),
      filesChanged: z.number().int().min(0).optional(),
    })
    .optional(),
});

// ─── Queue Name ────────────────────────────────────────────────────────────────

const DEPLOYMENT_EVENTS_QUEUE = "ollinai-deployment-events";

// ─── Helper: Look up integration by key to get tenantId ────────────────────────

interface IntegrationLookupResult {
  tenantId: string;
  secretKey: string;
  integrationId: string;
}

/**
 * Looks up an integration by its ID from the X-OllinAI-Integration header.
 * Returns the tenantId and secret key for HMAC verification.
 */
async function lookupIntegration(
  integrationKey: string
): Promise<IntegrationLookupResult | null> {
  const client = getDocumentClient();

  // Integration records are stored in ollinai-config table
  // We need to scan by integration ID — in production this would use a GSI
  // For now, the integrationKey format is: {tenantId}:{integrationId}
  const parts = integrationKey.split(":");
  if (parts.length !== 2) return null;

  const [tenantId, integrationId] = parts;

  const result = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INTEGRATION#${integrationId}`,
      },
    })
  );

  if (!result.Item) return null;

  const entityData = result.Item.entityData as {
    integrationId: string;
    secretKeyHash: string;
  };

  return {
    tenantId,
    secretKey: entityData.secretKeyHash,
    integrationId: entityData.integrationId,
  };
}

// ─── Helper: Look up service ownership ─────────────────────────────────────────

/**
 * Looks up the owning team for a service. Returns "UNASSIGNED" if not found.
 * If the service doesn't exist, auto-creates it as UNASSIGNED.
 */
async function getServiceTeamId(
  tenantId: string,
  serviceName: string
): Promise<string> {
  const client = getDocumentClient();

  const result = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `SVC#${serviceName}`,
      },
    })
  );

  if (result.Item) {
    const entityData = result.Item.entityData as { owningTeamId?: string };
    return entityData.owningTeamId || "UNASSIGNED";
  }

  // Auto-create unregistered service as "UNASSIGNED"
  await client.send(
    new PutCommand({
      TableName: TableNames.CONFIG,
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `SVC#${serviceName}`,
        entityData: {
          serviceId: serviceName,
          name: serviceName,
          owningTeamId: "UNASSIGNED",
          ownershipHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      ConditionExpression: "attribute_not_exists(PK)",
    })
  ).catch((err) => {
    // Ignore conditional check failure (race condition: another request created it)
    if (err.name !== "ConditionalCheckFailedException") throw err;
  });

  return "UNASSIGNED";
}

// ─── Helper: Check deduplication via GSI-3 ─────────────────────────────────────

/**
 * Checks if a deployment event with the same commitSha + service + environment
 * already exists. Returns the existing eventId if found, null otherwise.
 */
async function checkDeduplication(
  tenantId: string,
  commitSha: string,
  service: string,
  environment: string
): Promise<string | null> {
  const client = getDocumentClient();
  const dedupPK = tenantDedupKey(tenantId);
  const dedupSK = `${commitSha}#${service}#${environment}`;

  const result = await client.send(
    new QueryCommand({
      TableName: TableNames.EVENTS,
      IndexName: "GSI3-Deduplication",
      KeyConditionExpression: "GSI3PK = :pk AND GSI3SK = :sk",
      ExpressionAttributeValues: {
        ":pk": dedupPK,
        ":sk": dedupSK,
      },
      Limit: 1,
    })
  );

  if (result.Items && result.Items.length > 0) {
    return result.Items[0].eventId as string;
  }

  return null;
}

// ─── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Extract headers for HMAC verification
  const signature = request.headers.get("x-ollinai-signature");
  const integrationKey = request.headers.get("x-ollinai-integration");

  if (!signature || !integrationKey) {
    return NextResponse.json(
      { error: "Missing signature or integration key header" },
      { status: 401 }
    );
  }

  // 2. Look up integration to get tenantId and secret
  const integration = await lookupIntegration(integrationKey);
  if (!integration) {
    return NextResponse.json(
      { error: "Invalid integration key" },
      { status: 401 }
    );
  }

  // 3. Verify HMAC signature
  const rawBody = await request.text();
  const isValid = verifySignature(integration.secretKey, rawBody, signature);
  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 }
    );
  }

  // 4. Parse and validate payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = DeploymentEventSchema.safeParse(payload);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const fieldPath = issue.path.join(".");
      if (!fieldErrors[fieldPath]) {
        fieldErrors[fieldPath] = [];
      }
      fieldErrors[fieldPath].push(issue.message);
    }
    return NextResponse.json(
      { error: "Validation failed", fields: fieldErrors },
      { status: 400 }
    );
  }

  const data = validation.data;
  const tenantId = integration.tenantId;

  // 5. Deduplication check — check first commitSha + first service + environment
  // Per the design: GSI-3 SK = {commitSha}#{service}#{env}
  // We check dedup for each combination of commitSha and service
  for (const commitSha of data.commitShas) {
    for (const service of data.services) {
      const existingEventId = await checkDeduplication(
        tenantId,
        commitSha,
        service,
        data.environment
      );
      if (existingEventId) {
        return NextResponse.json(
          { eventId: existingEventId, status: "duplicate" },
          { status: 200 }
        );
      }
    }
  }

  // 6. Look up service ownership for team association
  // Use the first service as the primary service for the partition key
  const primaryService = data.services[0];
  const teamId = await getServiceTeamId(tenantId, primaryService);

  // Also auto-create any other referenced services
  for (const service of data.services.slice(1)) {
    await getServiceTeamId(tenantId, service);
  }

  // 7. Generate event ID and persist to DynamoDB
  const eventId = randomUUID();
  const now = new Date().toISOString();
  const deploymentTs = data.deploymentTimestamp;

  const pk = tenantServiceKey(tenantId, primaryService);
  const sk = `DEPLOY#${deploymentTs}#${eventId}`;

  const eventItem: EventItem = {
    PK: pk,
    SK: sk,
    eventId,
    commitShas: data.commitShas,
    author: data.author,
    services: data.services,
    environment: data.environment,
    teamId,
    createdAt: now,
    // GSI-1: Correlation lookup
    GSI1SK: `TS#${deploymentTs}`,
    // GSI-2: Team view
    GSI2PK: tenantTeamKey(tenantId, teamId),
    GSI2SK: `DEPLOY#${deploymentTs}`,
    // GSI-3: Deduplication (one entry per commitSha+service+env combo)
    GSI3PK: tenantDedupKey(tenantId),
    GSI3SK: `${data.commitShas[0]}#${primaryService}#${data.environment}`,
  };

  if (data.changeSize) {
    eventItem.changeSize = data.changeSize;
  }

  const client = getDocumentClient();

  // Validate tenant scope before persisting
  withTenantScope(tenantId, {
    Item: { PK: eventItem.PK } as Record<string, unknown>,
  });

  await client.send(new PutCommand({
    TableName: TableNames.EVENTS,
    Item: eventItem as unknown as Record<string, unknown>,
  }));

  // 8. Enqueue event reference to SQS for async processing
  const sqsMessage: SqsEventMessage = {
    eventType: "deployment.created",
    entityId: eventId,
    tenantId,
    producedAt: now,
    metadata: {
      primaryService,
      environment: data.environment,
      teamId,
    },
  };

  await sendMessage(DEPLOYMENT_EVENTS_QUEUE, sqsMessage);

  // 9. Return HTTP 201 with eventId
  return NextResponse.json(
    { eventId, status: "created" },
    { status: 201 }
  );
}
