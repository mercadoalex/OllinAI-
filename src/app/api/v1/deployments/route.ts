/**
 * Data Export API — Deployment Events (Enterprise)
 *
 * GET /api/v1/deployments — Paginated deployment events with filters
 *
 * Filters: service, team, time range (from/to), risk score severity
 * Pagination: default page size 25, max 100
 * Gated behind Enterprise tier.
 *
 * Requirements: 11.1, 11.2, 11.5, 11.7
 */

import { NextRequest, NextResponse } from "next/server";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantServiceKey,
  tenantTeamKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import { withRateLimit } from "@/lib/middleware/rate-limit";
import type { EventItem } from "@/lib/types/dynamo";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  // Auth check
  const authResult = await withAuthorization(request, {
    resource: "api_export",
    permission: "read",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;

  // Tier gate: Enterprise only
  const tierResult = await withTierGate(tenantId, "api_access");
  if (tierResult instanceof NextResponse) {
    return tierResult;
  }

  // Rate limit check
  const rateLimitResult = await withRateLimit(tenantId);
  if (rateLimitResult instanceof NextResponse) {
    return rateLimitResult;
  }

  // Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const service = searchParams.get("service");
  const team = searchParams.get("team");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const risk = searchParams.get("risk");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );

  try {
    const { items, totalCount } = await queryDeployments(tenantId, {
      service,
      team,
      from,
      to,
      risk,
      page,
      pageSize,
    });

    return NextResponse.json(
      {
        data: items,
        pagination: {
          totalCount,
          currentPage: page,
          pageSize,
          hasMore: page * pageSize < totalCount,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Deployment export error:", error);
    return NextResponse.json(
      { error: "Failed to query deployment events" },
      { status: 500 }
    );
  }
}

interface QueryFilters {
  service: string | null;
  team: string | null;
  from: string | null;
  to: string | null;
  risk: string | null;
  page: number;
  pageSize: number;
}

async function queryDeployments(
  tenantId: string,
  filters: QueryFilters
): Promise<{ items: Record<string, unknown>[]; totalCount: number }> {
  const client = getDocumentClient();
  const now = new Date().toISOString();
  const fromDate = filters.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = filters.to || now;

  let queryParams;

  if (filters.service) {
    // Query by service using primary key
    const pk = tenantServiceKey(tenantId, filters.service);
    queryParams = withTenantScope(tenantId, {
      TableName: TableNames.EVENTS,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :start AND :end",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":start": `DEPLOY#${fromDate}`,
        ":end": `DEPLOY#${toDate}z`,
      },
      ScanIndexForward: false,
    });
  } else if (filters.team) {
    // Query by team using GSI-2
    const pk = tenantTeamKey(tenantId, filters.team);
    queryParams = withTenantScope(tenantId, {
      TableName: TableNames.EVENTS,
      IndexName: "GSI2-TeamView",
      KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":start": `DEPLOY#${fromDate}`,
        ":end": `DEPLOY#${toDate}z`,
      },
      ScanIndexForward: false,
    });
  } else {
    // Query all tenant deployments using GSI-2 with ALL team
    const pk = tenantTeamKey(tenantId, "ALL");
    queryParams = withTenantScope(tenantId, {
      TableName: TableNames.EVENTS,
      IndexName: "GSI2-TeamView",
      KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":start": `DEPLOY#${fromDate}`,
        ":end": `DEPLOY#${toDate}z`,
      },
      ScanIndexForward: false,
    });
  }

  // Add risk filter expression if specified
  if (filters.risk) {
    const validRisks = ["low", "medium", "high", "critical"];
    if (validRisks.includes(filters.risk)) {
      queryParams = {
        ...queryParams,
        FilterExpression: "riskScore = :riskFilter",
        ExpressionAttributeValues: {
          ...queryParams.ExpressionAttributeValues,
          ":riskFilter": filters.risk,
        },
      };
    }
  }

  const result = await client.send(new QueryCommand(queryParams));
  const allItems = (result.Items || []) as unknown as EventItem[];

  // Apply pagination
  const totalCount = allItems.length;
  const startIndex = (filters.page - 1) * filters.pageSize;
  const paginatedItems = allItems.slice(startIndex, startIndex + filters.pageSize);

  return {
    items: paginatedItems.map(formatEventForExport),
    totalCount,
  };
}

function formatEventForExport(item: EventItem): Record<string, unknown> {
  return {
    eventId: item.eventId,
    commitShas: item.commitShas,
    author: item.author,
    services: item.services,
    environment: item.environment,
    teamId: item.teamId,
    riskScore: item.riskScore || null,
    riskFactors: item.riskFactors || null,
    changeSize: item.changeSize || null,
    correlatedIncidents: item.correlatedIncidents || [],
    createdAt: item.createdAt,
  };
}
