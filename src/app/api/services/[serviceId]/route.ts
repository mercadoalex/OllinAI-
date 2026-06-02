/**
 * Service Management API — Get and Update (Ownership Change)
 *
 * GET /api/services/[serviceId] — Get a single service
 * PUT /api/services/[serviceId] — Update service ownership
 *
 * Requirements: 6.2, 6.3, 6.5
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ServiceConfigItem } from "@/lib/types/dynamo";

// ─── Zod Schema for Update ─────────────────────────────────────────────────────

const UpdateServiceSchema = z.object({
  name: z
    .string()
    .min(1, "Service name is required")
    .max(150, "Service name must be 150 characters or fewer")
    .optional(),
  owningTeamId: z.string().min(1, "Owning team ID is required"),
});

// ─── GET Handler — Get Single Service ──────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params;

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

  const result = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":sk": `SVC#${serviceId}`,
        },
      })
    )
  );

  if (!result.Items || result.Items.length === 0) {
    return NextResponse.json(
      { error: "Service not found" },
      { status: 404 }
    );
  }

  const item = result.Items[0];
  const entityData = item.entityData as ServiceConfigItem["entityData"];

  return NextResponse.json(
    {
      serviceId: entityData.serviceId,
      name: entityData.name,
      owningTeamId: entityData.owningTeamId,
      ownershipHistory: entityData.ownershipHistory,
      createdAt: entityData.createdAt,
      updatedAt: entityData.updatedAt,
    },
    { status: 200 }
  );
}

// ─── PUT Handler — Update Service (Ownership Change) ───────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params;

  const authResult = await withAuthorization(request, {
    resource: "service",
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

  const validation = UpdateServiceSchema.safeParse(body);
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

  // Fetch existing service
  const existingResult = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":sk": `SVC#${serviceId}`,
        },
      })
    )
  );

  if (!existingResult.Items || existingResult.Items.length === 0) {
    return NextResponse.json(
      { error: "Service not found" },
      { status: 404 }
    );
  }

  const existingItem = existingResult.Items[0];
  const existingData = existingItem.entityData as ServiceConfigItem["entityData"];

  // If name is being changed, check uniqueness (case-insensitive)
  if (name && name.toLowerCase() !== existingData.name.toLowerCase()) {
    const allServicesResult = await client.send(
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

    const duplicateName = (allServicesResult.Items || []).find((item) => {
      const entityData = item.entityData as ServiceConfigItem["entityData"];
      return (
        entityData.name.toLowerCase() === name.toLowerCase() &&
        entityData.serviceId !== serviceId
      );
    });

    if (duplicateName) {
      return NextResponse.json(
        { error: "A service with this name already exists within the tenant" },
        { status: 409 }
      );
    }
  }

  // Verify the new owning team exists (unless setting to UNASSIGNED)
  if (owningTeamId !== "UNASSIGNED") {
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

  // Build the ownership history update
  const now = new Date().toISOString();
  const ownershipHistory = [...existingData.ownershipHistory];

  // If ownership is changing, close the current ownership period and open a new one
  if (existingData.owningTeamId !== owningTeamId) {
    // Close the current active ownership entry (the one without a `to` date)
    const activeEntryIndex = ownershipHistory.findIndex((entry) => !entry.to);
    if (activeEntryIndex !== -1) {
      ownershipHistory[activeEntryIndex] = {
        ...ownershipHistory[activeEntryIndex],
        to: now,
      };
    }

    // Add new ownership entry (only if not UNASSIGNED)
    if (owningTeamId !== "UNASSIGNED") {
      ownershipHistory.push({ teamId: owningTeamId, from: now });
    }
  }

  // Perform the update
  const updatedName = name || existingData.name;

  const updateParams = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    Key: {
      PK: pk,
      SK: `SVC#${serviceId}`,
    },
    UpdateExpression:
      "SET entityData.#name = :name, entityData.owningTeamId = :owningTeamId, entityData.ownershipHistory = :ownershipHistory, entityData.updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#name": "name",
    },
    ExpressionAttributeValues: {
      ":name": updatedName,
      ":owningTeamId": owningTeamId,
      ":ownershipHistory": ownershipHistory,
      ":updatedAt": now,
    },
    ReturnValues: "ALL_NEW" as const,
  });

  const updateResult = await client.send(new UpdateCommand(updateParams));

  const updatedEntityData = (updateResult.Attributes?.entityData ||
    {}) as ServiceConfigItem["entityData"];

  return NextResponse.json(
    {
      serviceId: updatedEntityData.serviceId || serviceId,
      name: updatedEntityData.name || updatedName,
      owningTeamId: updatedEntityData.owningTeamId || owningTeamId,
      ownershipHistory: updatedEntityData.ownershipHistory || ownershipHistory,
      createdAt: updatedEntityData.createdAt || existingData.createdAt,
      updatedAt: updatedEntityData.updatedAt || now,
    },
    { status: 200 }
  );
}
