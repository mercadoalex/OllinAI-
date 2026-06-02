/**
 * Recommendations API — List active recommendations
 *
 * GET /api/recommendations — List active (non-dismissed) recommendations for the tenant
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
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { RecommendationConfigItem } from "@/lib/types/dynamo";

// ─── GET /api/recommendations ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Authorize: any authenticated user can list recommendations (read permission)
  const result = await withAuthorization(request, {
    resource: "recommendation",
    permission: "read",
  });
  if (result instanceof NextResponse) {
    return result;
  }

  const { session } = result;
  const tenantId = session.tenantId;
  const client = getDocumentClient();

  // Query all recommendations for this tenant (SK begins_with REC#)
  const params = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": tenantConfigKey(tenantId),
      ":skPrefix": "REC#",
    },
  });

  const queryResult = await client.send(new QueryCommand(params));

  // Filter to only active (non-dismissed) recommendations
  const now = new Date().toISOString();
  const recommendations = (queryResult.Items ?? [])
    .map((item) => {
      const entityData = (item as unknown as RecommendationConfigItem).entityData;
      return entityData;
    })
    .filter((rec) => !rec.dismissedAt);

  return NextResponse.json({ data: recommendations }, { status: 200 });
}
