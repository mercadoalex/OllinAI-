/**
 * Data Export API — DORA Metrics (Enterprise)
 *
 * GET /api/v1/metrics — DORA metrics export with filters
 *
 * Filters: service, team, time range (from/to)
 * Pagination: default page size 25, max 100
 * Gated behind Enterprise tier.
 *
 * Requirements: 11.1, 11.2, 11.5, 11.7
 */

import { NextRequest, NextResponse } from "next/server";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { tenantMetricsScopeKey, withTenantScope } from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import { withRateLimit } from "@/lib/middleware/rate-limit";
import type { MetricsItem } from "@/lib/types/dynamo";

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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );

  try {
    const { items, totalCount } = await queryMetrics(tenantId, {
      service,
      team,
      from,
      to,
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
    console.error("Metrics export error:", error);
    return NextResponse.json(
      { error: "Failed to query metrics" },
      { status: 500 }
    );
  }
}

interface QueryFilters {
  service: string | null;
  team: string | null;
  from: string | null;
  to: string | null;
  page: number;
  pageSize: number;
}

async function queryMetrics(
  tenantId: string,
  filters: QueryFilters
): Promise<{ items: Record<string, unknown>[]; totalCount: number }> {
  const client = getDocumentClient();

  // Determine scope
  let scopeType: "TEAM" | "SERVICE" | "ALL";
  let scopeId: string;

  if (filters.service) {
    scopeType = "SERVICE";
    scopeId = filters.service;
  } else if (filters.team) {
    scopeType = "TEAM";
    scopeId = filters.team;
  } else {
    scopeType = "ALL";
    scopeId = "ALL";
  }

  const pk = tenantMetricsScopeKey(tenantId, scopeType, scopeId);

  // Build time-based SK filter
  let skCondition = "begins_with(SK, :skPrefix)";
  const expressionValues: Record<string, unknown> = {
    ":pk": pk,
    ":skPrefix": "PERIOD#",
  };

  if (filters.from || filters.to) {
    const fromDate = filters.from || "2000-01-01T00:00:00Z";
    const toDate = filters.to || "2099-12-31T23:59:59Z";
    skCondition = "SK BETWEEN :start AND :end";
    expressionValues[":start"] = `PERIOD#${fromDate}`;
    expressionValues[":end"] = `PERIOD#${toDate}z`;
    delete expressionValues[":skPrefix"];
  }

  const queryParams = withTenantScope(tenantId, {
    TableName: TableNames.METRICS,
    KeyConditionExpression: `PK = :pk AND ${skCondition}`,
    ExpressionAttributeValues: expressionValues,
    ScanIndexForward: false,
  });

  const result = await client.send(new QueryCommand(queryParams));
  const allItems = (result.Items || []) as unknown as MetricsItem[];

  // Apply pagination
  const totalCount = allItems.length;
  const startIndex = (filters.page - 1) * filters.pageSize;
  const paginatedItems = allItems.slice(startIndex, startIndex + filters.pageSize);

  return {
    items: paginatedItems.map(formatMetricsForExport),
    totalCount,
  };
}

function formatMetricsForExport(item: MetricsItem): Record<string, unknown> {
  const INSUFFICIENT = -1;

  // Extract period from SK: PERIOD#{start}#{end}
  const skParts = item.SK.replace("PERIOD#", "").split("#");
  const periodStart = skParts[0] || "";
  const periodEnd = skParts[1] || "";

  return {
    deploymentFrequency:
      item.deploymentFrequency === INSUFFICIENT ? "insufficient_data" : item.deploymentFrequency,
    leadTimeHours:
      item.leadTimeHours === INSUFFICIENT ? "insufficient_data" : item.leadTimeHours,
    changeFailureRate:
      item.changeFailureRate === INSUFFICIENT ? "insufficient_data" : item.changeFailureRate,
    mttrHours:
      item.mttrHours === INSUFFICIENT ? "insufficient_data" : item.mttrHours,
    unresolvedIncidentCount: item.unresolvedCount,
    period: {
      start: periodStart,
      end: periodEnd,
    },
    computedAt: item.computedAt,
  };
}
