/**
 * Collector API — Agent Telemetry Ingestion Endpoint
 *
 * Accepts telemetry batches from OllinAI agents (max 500 events per batch).
 * Also accepts Build_Attestation documents.
 * Authenticates via agent-specific token or integration key.
 * Persists telemetry to SQS `agent-telemetry` queue and attestations to DynamoDB.
 *
 * Requirements: 13.9, 13.6, 13.7
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "@/lib/dynamo/client";
import { sendMessage, type SqsEventMessage } from "@/lib/sqs/client";
import { tenantServiceKey } from "@/lib/dynamo/tenant-scope";
import { randomUUID } from "crypto";
import { validateAgentToken } from "@/lib/collector/auth";

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_EVENTS_PER_BATCH = 500;
const AGENT_TELEMETRY_QUEUE = "agent-telemetry";
const ATTESTATIONS_TABLE = "ollinai-attestations";

// ─── Zod Schemas ───────────────────────────────────────────────────────────────

const TelemetryEventSchema = z.object({
  type: z.string(),
}).passthrough();

const TelemetryBatchSchema = z.object({
  batch_id: z.string().min(1),
  tenant_id: z.string().min(1),
  service_id: z.string().min(1),
  pipeline_id: z.string().optional().nullable(),
  events: z.array(TelemetryEventSchema).max(MAX_EVENTS_PER_BATCH),
  dropped_event_count: z.number().int().min(0).default(0),
  agent_version: z.string().min(1),
  kernel_version: z.string().min(1),
  arch: z.string().min(1),
  degraded_mode: z.boolean().default(false),
  created_at_ns: z.number().int().min(0),
});

const BuildAttestationSchema = z.object({
  attestation_json: z.string().min(1),
  signature: z.string().min(1),
  public_key: z.string().min(1),
});

const CollectorRequestSchema = z.object({
  telemetry_batch: TelemetryBatchSchema.optional(),
  build_attestation: BuildAttestationSchema.optional(),
}).refine(
  (data) => data.telemetry_batch || data.build_attestation,
  { message: "At least one of telemetry_batch or build_attestation must be provided" }
);

type CollectorRequest = z.infer<typeof CollectorRequestSchema>;
type TelemetryBatchPayload = z.infer<typeof TelemetryBatchSchema>;
type BuildAttestationPayload = z.infer<typeof BuildAttestationSchema>;

// ─── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Authenticate
  const auth = validateAgentToken(request);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Unauthorized", detail: auth.error },
      { status: 401 }
    );
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parseResult = CollectorRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parseResult.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  const { telemetry_batch, build_attestation } = parseResult.data;

  // Validate tenant ID consistency
  if (telemetry_batch && telemetry_batch.tenant_id !== auth.tenantId) {
    return NextResponse.json(
      { error: "Tenant ID mismatch between token and payload" },
      { status: 403 }
    );
  }

  const results: { telemetry?: string; attestation?: string } = {};

  try {
    // Process telemetry batch
    if (telemetry_batch) {
      const messageId = await persistTelemetryBatch(telemetry_batch);
      results.telemetry = messageId;
    }

    // Process Build_Attestation
    if (build_attestation) {
      const attestationId = await persistBuildAttestation(
        auth.tenantId!,
        telemetry_batch?.service_id ?? "unknown",
        telemetry_batch?.pipeline_id ?? undefined,
        build_attestation
      );
      results.attestation = attestationId;
    }

    return NextResponse.json(
      {
        status: "accepted",
        batch_id: telemetry_batch?.batch_id,
        ...results,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Collector API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── Telemetry Persistence ─────────────────────────────────────────────────────

/**
 * Persists a telemetry batch to the SQS agent-telemetry queue.
 * Returns the SQS message ID.
 */
async function persistTelemetryBatch(
  batch: TelemetryBatchPayload
): Promise<string> {
  const message: SqsEventMessage = {
    eventType: "telemetry.batch",
    entityId: batch.batch_id,
    tenantId: batch.tenant_id,
    producedAt: new Date().toISOString(),
    metadata: {
      serviceId: batch.service_id,
      pipelineId: batch.pipeline_id ?? "",
      eventCount: String(batch.events.length),
      droppedCount: String(batch.dropped_event_count),
      agentVersion: batch.agent_version,
      degradedMode: String(batch.degraded_mode),
    },
  };

  return sendMessage(AGENT_TELEMETRY_QUEUE, message);
}

/**
 * Persists a Build_Attestation document to the ollinai-attestations DynamoDB table.
 * Returns the attestation ID.
 */
async function persistBuildAttestation(
  tenantId: string,
  serviceId: string,
  pipelineId: string | undefined,
  attestation: BuildAttestationPayload
): Promise<string> {
  const attestationId = randomUUID();
  const timestamp = new Date().toISOString();

  // Parse the attestation JSON to extract metadata
  let attestationMeta: Record<string, unknown> = {};
  try {
    attestationMeta = JSON.parse(attestation.attestation_json);
  } catch {
    // If we can't parse, store as-is
  }

  const client = getDocumentClient();
  const pk = tenantServiceKey(tenantId, serviceId);
  const sk = `ATTEST#${timestamp}#${attestationId}`;

  await client.send(
    new PutCommand({
      TableName: ATTESTATIONS_TABLE,
      Item: {
        PK: pk,
        SK: sk,
        attestationId,
        tenantId,
        serviceId,
        pipelineId: pipelineId ?? null,
        processCount: (attestationMeta as any)?.process_ancestry?.processes
          ? Object.keys((attestationMeta as any).process_ancestry.processes).length
          : 0,
        networkConnectionCount:
          Array.isArray((attestationMeta as any)?.network_connections)
            ? (attestationMeta as any).network_connections.length
            : 0,
        sensitiveFileWriteCount:
          Array.isArray((attestationMeta as any)?.sensitive_file_writes)
            ? (attestationMeta as any).sensitive_file_writes.length
            : 0,
        telemetryDigest: (attestationMeta as any)?.telemetry_digest ?? "",
        signaturePublicKey: attestation.public_key,
        signature: attestation.signature,
        attestationJson: attestation.attestation_json,
        generatedAt: (attestationMeta as any)?.generated_at_ns
          ? new Date(
              Number((attestationMeta as any).generated_at_ns) / 1_000_000
            ).toISOString()
          : timestamp,
        agentVersion: (attestationMeta as any)?.agent_version ?? "unknown",
        createdAt: timestamp,
      },
    })
  );

  return attestationId;
}
