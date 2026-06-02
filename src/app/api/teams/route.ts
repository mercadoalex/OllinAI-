/**
 * Team Management API — List and Create
 *
 * GET  /api/teams — List all teams for the authenticated tenant
 * POST /api/teams — Create a new team (requires tenant_admin)
 *
 * Requirements: 6.1, 6.4
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { withAuthorization } from "@/lib/middleware/authorize";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { TeamConfigItem } from "@/lib/types/dynamo";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const CreateTeamSchema = z.object({
  name: z
    .string()
    .min(1, "Team name is required")
    .max(100, "Team name must be 100 characters or fewer"),
  members: z
    .array(z.string().min(1))
    .max(200, "Maximum 200 members per team")
    .default([]),
});

// ─── GET /api/teams ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Authorize: any authenticated user can list teams (read permission)
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

  // Query all teams for this tenant (SK begins_with TEAM#)
  const params = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": tenantConfigKey(tenantId),
      ":skPrefix": "TEAM#",
    },
  });

  const queryResult = await client.send(new QueryCommand(params));

  const teams = (queryResult.Items ?? []).map((item) => {
    const entityData = item.entityData as TeamConfigItem["entityData"];
    return {
      teamId: entityData.teamId,
      name: entityData.name,
      members: entityData.members,
      archived: entityData.archived,
      createdAt: entityData.createdAt,
      updatedAt: entityData.updatedAt,
    };
  });

  return NextResponse.json({ data: teams }, { status: 200 });
}

// ─── POST /api/teams ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Authorize: only tenant_admin can create teams
  const result = await withAuthorization(request, {
    resource: "team",
    permission: "create",
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

  const validation = CreateTeamSchema.safeParse(body);
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

  // Check uniqueness: team name must be unique within tenant (case-insensitive)
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
    const entityData = item.entityData as TeamConfigItem["entityData"];
    return entityData.name.toLowerCase() === data.name.toLowerCase() && !entityData.archived;
  });

  if (nameConflict) {
    return NextResponse.json(
      { error: `A team with the name "${data.name}" already exists` },
      { status: 409 }
    );
  }

  // Check max 50 teams per tenant
  const activeTeams = (existingTeams.Items ?? []).filter((item) => {
    const entityData = item.entityData as TeamConfigItem["entityData"];
    return !entityData.archived;
  });

  if (activeTeams.length >= 50) {
    return NextResponse.json(
      { error: "Maximum of 50 active teams per tenant reached" },
      { status: 422 }
    );
  }

  // Create team
  const teamId = randomUUID();
  const now = new Date().toISOString();

  const teamItem: TeamConfigItem = {
    PK: tenantConfigKey(tenantId),
    SK: `TEAM#${teamId}`,
    entityData: {
      teamId,
      name: data.name,
      members: data.members,
      archived: false,
      createdAt: now,
      updatedAt: now,
    },
  };

  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: teamItem as unknown as Record<string, unknown>,
      })
    )
  );

  return NextResponse.json(
    {
      teamId,
      name: data.name,
      members: data.members,
      archived: false,
      createdAt: now,
      updatedAt: now,
    },
    { status: 201 }
  );
}
