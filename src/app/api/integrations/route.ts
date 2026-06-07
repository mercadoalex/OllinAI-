/**
 * Integration Management API — List and Create
 *
 * GET  /api/integrations — List all integrations for the tenant
 * POST /api/integrations — Create new integration (generates secret key)
 *
 * Requires tenant_admin role for all operations.
 * Secret key is returned ONLY on creation (one-time display).
 *
 * Requirements: 10.7
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { generateSecretKey } from "@/lib/webhooks/hmac";
import type { IntegrationConfigItem } from "@/lib/types/dynamo";

// ─── Constants ─────────────────────────────────────────────────────────────────

const VALID_INTEGRATION_TYPES = [
  "github_actions",
  "gitlab_ci",
  "jenkins",
  "circleci",
  "harness",
  "azure_devops",
  "argocd",
  "pagerduty",
  "opsgenie",
  "custom",
] as const;

type IntegrationType = (typeof VALID_INTEGRATION_TYPES)[number];

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const CreateIntegrationSchema = z.object({
  name: z
    .string()
    .min(1, "Integration name is required")
    .max(200, "Integration name must be 200 characters or fewer"),
  type: z.enum(VALID_INTEGRATION_TYPES, {
    errorMap: () => ({
      message: `Invalid integration type. Must be one of: ${VALID_INTEGRATION_TYPES.join(", ")}`,
    }),
  }),
});

// ─── GET Handler — List Integrations ───────────────────────────────────────────

export async function GET(request: NextRequest) {
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

  const params = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": pk,
      ":skPrefix": "INTEGRATION#",
    },
  });

  const result = await client.send(new QueryCommand(params));

  const integrations = (result.Items || []).map((item) => {
    const entityData = item.entityData as IntegrationConfigItem["entityData"];
    return {
      integrationId: entityData.integrationId,
      name: entityData.name,
      type: entityData.type,
      createdAt: entityData.createdAt,
      updatedAt: entityData.updatedAt,
      lastUsedAt: entityData.lastUsedAt || null,
    };
  });

  return NextResponse.json({ data: integrations }, { status: 200 });
}

// ─── POST Handler — Create Integration ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authResult = await withAuthorization(request, {
    resource: "integration",
    permission: "create",
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

  const validation = CreateIntegrationSchema.safeParse(body);
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

  const { name, type } = validation.data;
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);

  // Generate integration ID and secret key
  const integrationId = randomUUID();
  const secretKey = generateSecretKey();
  const now = new Date().toISOString();

  const integrationItem: IntegrationConfigItem = {
    PK: pk,
    SK: `INTEGRATION#${integrationId}`,
    entityData: {
      integrationId,
      name,
      type,
      secretKeyHash: secretKey,
      createdAt: now,
      updatedAt: now,
    },
  };

  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: integrationItem as unknown as Record<string, unknown>,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      })
    )
  );

  // Return the secret key ONLY on creation (one-time display)
  return NextResponse.json(
    {
      integrationId,
      name,
      type,
      secretKey,
      createdAt: now,
      updatedAt: now,
    },
    { status: 201 }
  );
}
