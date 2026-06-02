/**
 * Service Management API — List and Create
 *
 * GET  /api/services — List all services for the tenant
 * POST /api/services — Create a new service
 *
 * Requirements: 6.2, 6.4
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
import type { ServiceConfigItem } from "@/lib/types/dynamo";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const CreateServiceSchema = z.object({
  name: z
    .string()
    .min(1, "Service name is required")
    .max(150, "Service name must be 150 characters or fewer"),
  owningTeamId: z.string().min(1).optional(),
});

// ─── GET Handler — List Services ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authResult = await withAuthorization(request, {
    resource: "service",
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
      ":skPrefix": "SVC#",
    },
  });

  const result = await client.send(new QueryCommand(params));

  const services = (result.Items || []).map((item) => {
    const entityData = item.entityData as ServiceConfigItem["entityData"];
    return {
      serviceId: entityData.serviceId,
      name: entityData.name,
      owningTeamId: entityData.owningTeamId,
      ownershipHistory: entityData.ownershipHistory,
      createdAt: entityData.createdAt,
      updatedAt: entityData.updatedAt,
    };
  });

  return NextResponse.json({ data: services }, { status: 200 });
}

// ─── POST Handler — Create Service ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authResult = await withAuthorization(request, {
    resource: "service",
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

  const validation = CreateServiceSchema.safeParse(body);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const fieldPath = issue.path.join(".") || issue.path[0] || "unknown";
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

  const { name, owningTeamId } = validation.data;
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);

  // Check for unique service name (case-insensitive) within tenant
  const existingResult = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skPrefix": "SVC#",
        },
      })
    )
  );

  const existingServices = existingResult.Items || [];
  const duplicateName = existingServices.find((item) => {
    const entityData = item.entityData as ServiceConfigItem["entityData"];
    return entityData.name.toLowerCase() === name.toLowerCase();
  });

  if (duplicateName) {
    return NextResponse.json(
      { error: "A service with this name already exists within the tenant" },
      { status: 409 }
    );
  }

  // If owningTeamId is provided, verify the team exists
  const resolvedOwningTeamId = owningTeamId || "UNASSIGNED";
  if (owningTeamId) {
    const teamResult = await client.send(
      new QueryCommand(
        withTenantScope(tenantId, {
          TableName: TableNames.CONFIG,
          KeyConditionExpression: "PK = :pk AND SK = :sk",
          ExpressionAttributeValues: {
            ":pk": pk,
            ":sk": `TEAM#${owningTeamId}`,
          },
        })
      )
    );

    if (!teamResult.Items || teamResult.Items.length === 0) {
      return NextResponse.json(
        { error: "Owning team not found", fields: { owningTeamId: ["Team does not exist"] } },
        { status: 400 }
      );
    }
  }

  // Create the service
  const serviceId = randomUUID();
  const now = new Date().toISOString();

  const initialOwnershipHistory = resolvedOwningTeamId !== "UNASSIGNED"
    ? [{ teamId: resolvedOwningTeamId, from: now }]
    : [];

  const serviceItem: ServiceConfigItem = {
    PK: pk,
    SK: `SVC#${serviceId}`,
    entityData: {
      serviceId,
      name,
      owningTeamId: resolvedOwningTeamId,
      ownershipHistory: initialOwnershipHistory,
      createdAt: now,
      updatedAt: now,
    },
  };

  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: serviceItem as unknown as Record<string, unknown>,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      })
    )
  );

  return NextResponse.json(
    {
      serviceId,
      name,
      owningTeamId: resolvedOwningTeamId,
      ownershipHistory: initialOwnershipHistory,
      createdAt: now,
      updatedAt: now,
    },
    { status: 201 }
  );
}
