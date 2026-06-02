/**
 * Integration Management API — Get, Update, and Delete (single integration)
 *
 * GET    /api/integrations/[id] — Get single integration details
 * PUT    /api/integrations/[id] — Update integration (name, rotate key)
 * DELETE /api/integrations/[id] — Revoke/delete integration
 *
 * Requires tenant_admin role for all operations.
 * Secret key is returned ONLY on rotation (one-time display).
 *
 * Requirements: 10.7
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { QueryCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { generateSecretKey } from "@/lib/webhooks/hmac";
import type { IntegrationConfigItem } from "@/lib/types/dynamo";

// ─── Constants ─────────────────────────────────────────────────────────────────

const VALID_INTEGRATION_TYPES = [
  "github_actions",
  "gitlab_ci",
  "jenkins",
  "circleci",
  "pagerduty",
  "opsgenie",
  "custom",
] as const;

// ─── Zod Schema for Update ─────────────────────────────────────────────────────

const UpdateIntegrationSchema = z.object({
  name: z
    .string()
    .min(1, "Integration name is required")
    .max(200, "Integration name must be 200 characters or fewer")
    .optional(),
  type: z
    .enum(VALID_INTEGRATION_TYPES, {
      errorMap: () => ({
        message: `Invalid integration type. Must be one of: ${VALID_INTEGRATION_TYPES.join(", ")}`,
      }),
    })
    .optional(),
  rotateKey: z.boolean().optional(),
});

// ─── GET Handler — Get Single Integration ──────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const authResult = await withAuthorization(request, {
    resource: "integration",
    permission: "read",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);

  const result = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":sk": `INTEGRATION#${id}`,
        },
      })
    )
  );

  if (!result.Items || result.Items.length === 0) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  const item = result.Items[0];
  const entityData = item.entityData as IntegrationConfigItem["entityData"];

  // Never return the secretKeyHash on GET
  return NextResponse.json(
    {
      integrationId: entityData.integrationId,
      name: entityData.name,
      type: entityData.type,
      createdAt: entityData.createdAt,
      updatedAt: entityData.updatedAt,
      lastUsedAt: entityData.lastUsedAt || null,
    },
    { status: 200 }
  );
}

// ─── PUT Handler — Update Integration / Rotate Key ─────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const authResult = await withAuthorization(request, {
    resource: "integration",
    permission: "update",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = UpdateIntegrationSchema.safeParse(body);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const fieldPath = issue.path.join(".") || issue.path[0]?.toString() || "unknown";
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

  const { name, type, rotateKey } = validation.data;
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);

  // Fetch existing integration
  const existingResult = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":sk": `INTEGRATION#${id}`,
        },
      })
    )
  );

  if (!existingResult.Items || existingResult.Items.length === 0) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  const existingItem = existingResult.Items[0];
  const existingData = existingItem.entityData as IntegrationConfigItem["entityData"];

  // Build updated integration
  const now = new Date().toISOString();
  let newSecretKey: string | undefined;

  const updatedData: IntegrationConfigItem["entityData"] = {
    ...existingData,
    name: name || existingData.name,
    type: type || existingData.type,
    updatedAt: now,
  };

  // Rotate key if requested
  if (rotateKey) {
    newSecretKey = generateSecretKey();
    updatedData.secretKeyHash = newSecretKey;
  }

  const updatedItem: IntegrationConfigItem = {
    PK: pk,
    SK: `INTEGRATION#${id}`,
    entityData: updatedData,
  };

  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: updatedItem as unknown as Record<string, unknown>,
      })
    )
  );

  const response: Record<string, unknown> = {
    integrationId: updatedData.integrationId,
    name: updatedData.name,
    type: updatedData.type,
    createdAt: updatedData.createdAt,
    updatedAt: updatedData.updatedAt,
    lastUsedAt: updatedData.lastUsedAt || null,
  };

  // Return the new secret key ONLY on rotation (one-time display)
  if (newSecretKey) {
    response.secretKey = newSecretKey;
  }

  return NextResponse.json(response, { status: 200 });
}

// ─── DELETE Handler — Revoke/Delete Integration ────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const authResult = await withAuthorization(request, {
    resource: "integration",
    permission: "delete",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);

  // Verify integration exists before deleting
  const existingResult = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":sk": `INTEGRATION#${id}`,
        },
      })
    )
  );

  if (!existingResult.Items || existingResult.Items.length === 0) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  // Delete the integration record
  await client.send(
    new DeleteCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Key: {
          PK: pk,
          SK: `INTEGRATION#${id}`,
        },
      })
    )
  );

  return NextResponse.json(
    { message: "Integration revoked and deleted", integrationId: id },
    { status: 200 }
  );
}
