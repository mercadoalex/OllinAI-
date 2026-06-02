/**
 * Incident Ingestion Webhook Endpoint
 *
 * POST /api/webhooks/incidents
 *
 * Receives incident payloads from alerting systems (PagerDuty, OpsGenie, etc.),
 * validates the HMAC signature and payload schema, persists to DynamoDB, and
 * enqueues for downstream processing (correlation, DORA recomputation).
 *
 * If the same externalId already exists for the tenant+service, the existing
 * record's resolutionTimestamp is updated rather than creating a new incident.
 *
 * Requirements: 2.1, 2.6, 2.8
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { verifySignature } from "@/lib/webhooks/hmac";
import { tenantServiceKey, tenantPrefix, tenantQuery, tenantPut, tenantUpdate } from "@/lib/dynamo/tenant-scope";
import { TableNames } from "@/lib/dynamo/client";
import { sendMessage, type SqsEventMessage } from "@/lib/sqs/client";
import type { IncidentItem } from "@/lib/types/dynamo";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const IncidentPayloadSchema = z.object({
  externalId: z.string().min(1, "externalId must be a non-empty string"),
  severity: z.enum(["low", "medium", "high", "critical"], {
    errorMap: () => ({ message: "severity must be one of: low, medium, high, critical" }),
  }),
  affectedService: z.string().min(1, "affectedService must be a non-empty string"),
  detectionTimestamp: z.string().regex(ISO_8601_REGEX, "detectionTimestamp must be a valid ISO 8601 timestamp"),
  resolutionTimestamp: z
    .string()
    .regex(ISO_8601_REGEX, "resolutionTimestamp must be a valid ISO 8601 timestamp")
    .optional(),
});

export type ValidatedIncidentPayload = z.infer<typeof IncidentPayloadSchema>;

// ─── Queue Names ───────────────────────────────────────────────────────────────

const INCIDENTS_QUEUE = "ollinai-incidents";

// ─── Headers ───────────────────────────────────────────────────────────────────

const SIGNATURE_HEADER = "x-ollinai-signature";
const TENANT_ID_HEADER = "x-ollinai-tenant-id";
const INTEGRATION_SECRET_HEADER = "x-ollinai-integration-secret";

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Extract headers
  const signature = request.headers.get(SIGNATURE_HEADER);
  const tenantId = request.headers.get(TENANT_ID_HEADER);
  const integrationSecret = request.headers.get(INTEGRATION_SECRET_HEADER);

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing required header: x-ollinai-tenant-id" },
      { status: 400 }
    );
  }

  if (!signature || !integrationSecret) {
    return NextResponse.json(
      { error: "Missing authentication headers" },
      { status: 401 }
    );
  }

  // 2. Read raw body for HMAC verification
  const rawBody = await request.text();

  // 3. Verify HMAC-SHA256 signature
  const isValid = verifySignature(integrationSecret, rawBody, signature);
  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 }
    );
  }

  // 4. Parse and validate payload with Zod
  let payload: ValidatedIncidentPayload;
  try {
    const body = JSON.parse(rawBody);
    const result = IncidentPayloadSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.errors.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      return NextResponse.json(
        { error: "Validation failed", fields: fieldErrors },
        { status: 400 }
      );
    }
    payload = result.data;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // 5. Check for existing incident with same externalId (for resolution updates)
  const existingIncident = await findExistingIncident(tenantId, payload.affectedService, payload.externalId);

  if (existingIncident) {
    // Update the existing incident's resolutionTimestamp
    if (payload.resolutionTimestamp) {
      await updateResolutionTimestamp(tenantId, existingIncident, payload.resolutionTimestamp);

      // Enqueue update event
      const sqsMessage: SqsEventMessage = {
        eventType: "incident.updated",
        entityId: existingIncident.incidentId,
        tenantId,
        producedAt: new Date().toISOString(),
        metadata: {
          serviceId: payload.affectedService,
          resolutionTimestamp: payload.resolutionTimestamp,
        },
      };
      await sendMessage(INCIDENTS_QUEUE, sqsMessage);

      return NextResponse.json(
        { incidentId: existingIncident.incidentId, status: "updated" },
        { status: 200 }
      );
    }

    // If no resolution timestamp and incident already exists, return existing
    return NextResponse.json(
      { incidentId: existingIncident.incidentId, status: "existing" },
      { status: 200 }
    );
  }

  // 6. Create new incident
  const incidentId = randomUUID();
  const pk = tenantServiceKey(tenantId, payload.affectedService);
  const sk = `INC#${payload.detectionTimestamp}#${incidentId}`;

  const item: IncidentItem = {
    PK: pk,
    SK: sk,
    incidentId,
    externalId: payload.externalId,
    severity: payload.severity,
    detectionTimestamp: payload.detectionTimestamp,
    resolutionTimestamp: payload.resolutionTimestamp,
    correlatedDeployments: [],
    correlationStatus: "pending",
    // GSI-1 attributes for time range queries
    GSI1PK: tenantPrefix(tenantId),
    GSI1SK: `INC#${payload.detectionTimestamp}`,
  };

  await tenantPut(tenantId, {
    TableName: TableNames.INCIDENTS,
    Item: item,
  });

  // 7. Enqueue to SQS for downstream processing
  const sqsMessage: SqsEventMessage = {
    eventType: "incident.created",
    entityId: incidentId,
    tenantId,
    producedAt: new Date().toISOString(),
    metadata: {
      serviceId: payload.affectedService,
      severity: payload.severity,
      detectionTimestamp: payload.detectionTimestamp,
    },
  };
  await sendMessage(INCIDENTS_QUEUE, sqsMessage);

  // 8. Return success
  return NextResponse.json(
    { incidentId, status: "created" },
    { status: 201 }
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds an existing incident with the same externalId for the given tenant and service.
 * Queries using the GSI-1 (time range) to find incidents, then filters by externalId.
 */
async function findExistingIncident(
  tenantId: string,
  serviceId: string,
  externalId: string
): Promise<IncidentItem | null> {
  const pk = tenantServiceKey(tenantId, serviceId);

  const result = await tenantQuery(tenantId, {
    TableName: TableNames.INCIDENTS,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    FilterExpression: "externalId = :externalId",
    ExpressionAttributeValues: {
      ":pk": pk,
      ":skPrefix": "INC#",
      ":externalId": externalId,
    },
  });

  if (result.Items && result.Items.length > 0) {
    return result.Items[0] as unknown as IncidentItem;
  }

  return null;
}

/**
 * Updates the resolutionTimestamp on an existing incident record.
 */
async function updateResolutionTimestamp(
  tenantId: string,
  incident: IncidentItem,
  resolutionTimestamp: string
): Promise<void> {
  await tenantUpdate(tenantId, {
    TableName: TableNames.INCIDENTS,
    Key: {
      PK: incident.PK,
      SK: incident.SK,
    },
    UpdateExpression: "SET resolutionTimestamp = :rt",
    ExpressionAttributeValues: {
      ":rt": resolutionTimestamp,
    },
  });
}
