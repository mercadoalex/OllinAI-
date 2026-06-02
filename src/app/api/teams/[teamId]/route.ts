/**
 * Team Management API — Get, Update, Archive (Delete)
 *
 * GET    /api/teams/[teamId] — Get a specific team
 * PUT    /api/teams/[teamId] — Update a team
 * DELETE /api/teams/[teamId] — Archive a team (soft delete)
 *
 * Requirements: 6.1, 6.4, 6.6
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuthorization } from "@/lib/middleware/authorize";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { TeamConfigItem, ServiceConfigItem } from "@/lib/types/dynamo";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const UpdateTeamSchema = z.object({
  name: z
    .string()
    .min(1, "Team name is required")
    .max(100, "Team name must be 100 characters or fewer")
    .optional(),
  members: z
    .array(z.string().min(1))
    .max(200, "Maximum 200 members per team")
    .optional(),
});

// ─── Route Context ─────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

// ─── GET /api/teams/[teamId] ───────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  const result = await withAuthorization(request, {
    resource: "team",
    permission: "read",
  });
  if (result instanceof NextResponse) {
    return result;
  }

  const { session } = result;
  const tenantId = session.tenantId;
  const client = getDocumentClient();

  const getResult = await client.send(
    new GetCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Key: {
          PK: tenantConfigKey(tenantId),
          SK: `TEAM#${teamId}`,
        },
      })
    )
  );

  if (!getResult.Item) {
    return NextResponse.json(
      { error: `Team "${teamId}" not found` },
      { status: 404 }
    );
  }

  const entityData = getResult.Item.entityData as TeamConfigItem["entityData"];

  return NextResponse.json(
    {
      teamId: entityData.teamId,
      name: entityData.name,
      members: entityData.members,
      archived: entityData.archived,
      createdAt: entityData.createdAt,
      updatedAt: entityData.updatedAt,
    },
    { status: 200 }
  );
}

// ─── PUT /api/teams/[teamId] ───────────────────────────────────────────────────

export async function PUT(request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  const result = await withAuthorization(request, {
    resource: "team",
    permission: "update",
    getTeamId: () => teamId,
  });
  if (result instanceof NextResponse) {
    return result;
  }

  const { session } = result;
  const tenantId = session.tenantId;

  // Parse and validate payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = UpdateTeamSchema.safeParse(body);
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

  const data = validation.data;
  const client = getDocumentClient();

  // Fetch existing team
  const getResult = await client.send(
    new GetCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Key: {
          PK: tenantConfigKey(tenantId),
          SK: `TEAM#${teamId}`,
        },
      })
    )
  );

  if (!getResult.Item) {
    return NextResponse.json(
      { error: `Team "${teamId}" not found` },
      { status: 404 }
    );
  }

  const existingData = getResult.Item.entityData as TeamConfigItem["entityData"];

  if (existingData.archived) {
    return NextResponse.json(
      { error: "Cannot update an archived team" },
      { status: 422 }
    );
  }

  // Check name uniqueness if name is being changed
  if (data.name && data.name.toLowerCase() !== existingData.name.toLowerCase()) {
    const existingTeams = await client.send(
      new QueryCommand(
        withTenantScope(tenantId, {
          TableName: TableNames.CONFIG,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": tenantConfigKey(tenantId),
            ":skPrefix": "TEAM#",
          },
        })
      )
    );

    const nameConflict = (existingTeams.Items ?? []).some((item) => {
      const ed = item.entityData as TeamConfigItem["entityData"];
      return (
        ed.teamId !== teamId &&
        ed.name.toLowerCase() === data.name!.toLowerCase() &&
        !ed.archived
      );
    });

    if (nameConflict) {
      return NextResponse.json(
        { error: `A team with the name "${data.name}" already exists` },
        { status: 409 }
      );
    }
  }

  // Apply updates
  const now = new Date().toISOString();
  const updatedData: TeamConfigItem["entityData"] = {
    ...existingData,
    name: data.name ?? existingData.name,
    members: data.members ?? existingData.members,
    updatedAt: now,
  };

  const updatedItem: TeamConfigItem = {
    PK: tenantConfigKey(tenantId),
    SK: `TEAM#${teamId}`,
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

  return NextResponse.json(
    {
      teamId: updatedData.teamId,
      name: updatedData.name,
      members: updatedData.members,
      archived: updatedData.archived,
      createdAt: updatedData.createdAt,
      updatedAt: updatedData.updatedAt,
    },
    { status: 200 }
  );
}

// ─── DELETE /api/teams/[teamId] — Archive ──────────────────────────────────────

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  // Only tenant_admin can archive teams
  const result = await withAuthorization(request, {
    resource: "team",
    permission: "delete",
  });
  if (result instanceof NextResponse) {
    return result;
  }

  const { session } = result;
  const tenantId = session.tenantId;
  const client = getDocumentClient();

  // Fetch existing team
  const getResult = await client.send(
    new GetCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Key: {
          PK: tenantConfigKey(tenantId),
          SK: `TEAM#${teamId}`,
        },
      })
    )
  );

  if (!getResult.Item) {
    return NextResponse.json(
      { error: `Team "${teamId}" not found` },
      { status: 404 }
    );
  }

  const existingData = getResult.Item.entityData as TeamConfigItem["entityData"];

  if (existingData.archived) {
    return NextResponse.json(
      { error: "Team is already archived" },
      { status: 422 }
    );
  }

  // Check if team owns any services — reject archive if so (Requirement 6.6)
  const servicesResult = await client.send(
    new QueryCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": tenantConfigKey(tenantId),
          ":skPrefix": "SVC#",
        },
      })
    )
  );

  const ownedServices = (servicesResult.Items ?? [])
    .filter((item) => {
      const ed = item.entityData as ServiceConfigItem["entityData"];
      return ed.owningTeamId === teamId;
    })
    .map((item) => {
      const ed = item.entityData as ServiceConfigItem["entityData"];
      return { serviceId: ed.serviceId, name: ed.name };
    });

  if (ownedServices.length > 0) {
    return NextResponse.json(
      {
        error: "Cannot archive team that owns services. Reassign these services first.",
        services: ownedServices,
      },
      { status: 409 }
    );
  }

  // Archive the team (soft delete)
  const now = new Date().toISOString();
  const archivedData: TeamConfigItem["entityData"] = {
    ...existingData,
    archived: true,
    updatedAt: now,
  };

  const archivedItem: TeamConfigItem = {
    PK: tenantConfigKey(tenantId),
    SK: `TEAM#${teamId}`,
    entityData: archivedData,
  };

  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: archivedItem as unknown as Record<string, unknown>,
      })
    )
  );

  return NextResponse.json(
    {
      teamId: archivedData.teamId,
      name: archivedData.name,
      archived: true,
      updatedAt: now,
    },
    { status: 200 }
  );
}
