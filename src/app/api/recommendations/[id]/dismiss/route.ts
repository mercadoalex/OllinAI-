/**
 * Recommendation Dismissal API
 *
 * POST /api/recommendations/{id}/dismiss
 * - Records dismissal of a recommendation
 * - Suppresses same category for same team+service for 14 days
 * - Requires authenticated user with team_lead or tenant_admin role
 *
 * Requirements: 5.5
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuthorization } from "@/lib/middleware/authorize";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RecommendationConfigItem } from "@/lib/types/dynamo";

const SUPPRESSION_DAYS = 14;

// ─── POST /api/recommendations/[id]/dismiss ────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Authorize: team_lead or tenant_admin can dismiss (requires "update" on recommendation)
  const result = await withAuthorization(request, {
    resource: "recommendation",
    permission: "update",
  });
  if (result instanceof NextResponse) {
    return result;
  }

  const { session } = result;
  const tenantId = session.tenantId;
  const recommendationId = params.id;

  if (!recommendationId || recommendationId.trim() === "") {
    return NextResponse.json(
      { error: "Recommendation ID is required" },
      { status: 400 }
    );
  }

  const client = getDocumentClient();

  // Find the recommendation by querying config items with SK prefix REC#{id}
  const queryParams = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    KeyConditionExpression: "PK = :pk AND SK = :sk",
    ExpressionAttributeValues: {
      ":pk": tenantConfigKey(tenantId),
      ":sk": `REC#${recommendationId}`,
    },
  });

  const queryResult = await client.send(new QueryCommand(queryParams));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return NextResponse.json(
      { error: `Recommendation "${recommendationId}" not found` },
      { status: 404 }
    );
  }

  const item = queryResult.Items[0] as unknown as RecommendationConfigItem;
  const entityData = item.entityData;

  // Check if already dismissed
  if (entityData.dismissedAt) {
    return NextResponse.json(
      { error: "Recommendation has already been dismissed" },
      { status: 409 }
    );
  }

  // Compute suppression end date (14 days from now)
  const now = new Date();
  const dismissedAt = now.toISOString();
  const suppressedUntil = new Date(
    now.getTime() + SUPPRESSION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // Update the recommendation record with dismissal and suppression
  const updateParams = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    Key: {
      PK: tenantConfigKey(tenantId),
      SK: `REC#${recommendationId}`,
    },
    UpdateExpression:
      "SET entityData.dismissedAt = :dismissedAt, entityData.suppressedUntil = :suppressedUntil",
    ExpressionAttributeValues: {
      ":dismissedAt": dismissedAt,
      ":suppressedUntil": suppressedUntil,
    },
    ReturnValues: "ALL_NEW" as const,
  });

  await client.send(new UpdateCommand(updateParams));

  return NextResponse.json(
    {
      id: recommendationId,
      dismissedAt,
      suppressedUntil,
      category: entityData.category,
      targetTeam: entityData.targetTeam,
      targetService: entityData.targetService,
    },
    { status: 200 }
  );
}
