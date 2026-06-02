/**
 * Data Export API — Incidents (Enterprise)
 *
 * GET /api/v1/incidents — Paginated incidents with filters
 *
 * Filters: service, team, time range (from/to), severity
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
  tenantPrefix,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import { withRateLimit } from "@/lib/middleware/rate-limit";
import type { IncidentItem } from "@/lib/types/dynamo";

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
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const severity = searchParams.get("severity");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );

  try {
    const { items, totalCount } = await queryIncidents(tenantId, {
      service,
      from,
      to,
      severity,
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
    console.error("Incident export error:", error);
    return NextResponse.json(
      { error: "Failed to query incidents" },
      { status: 500 }
    );
  }
}

interface QueryFilters {
  service: string | null;
  from: string | null;
  to: string | null;
  severity: string | null;
  page: number;
  pageSize: number;
}

async function queryIncidents(
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
      TableName: TableNames.INCIDENTS,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :start AND :end",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":start": `INC#${fromDate}`,
        ":end": `INC#${toDate}z`,
      },
      ScanIndexForward: false,
    });
  } else {
    // Query using GSI-1 for time-range queries across all services
    const pk = tenantPrefix(tenantId);
    queryParams = withTenantScope(tenantId, {
      TableName: TableNames.INCIDENTS,
      IndexName: "GSI-1",
      KeyConditionExpression: "GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":start": `INC#${fromDate}`,
        ":end": `INC#${toDate}z`,
      },
      ScanIndexForward: false,
    });
  }

  // Add severity filter if specified
  if (filters.severity) {
    const validSeverities = ["low", "medium", "high", "critical"];
    if (validSeverities.includes(filters.severity)) {
      queryParams = {
        ...queryParams,
        FilterExpression: "severity = :severityFilter",
        ExpressionAttributeValues: {
          ...queryParams.ExpressionAttributeValues,
          ":severityFilter": filters.severity,
        },
      };
    }
  }

  const result = await client.send(new QueryCommand(queryParams));
  const allItems = (result.Items || []) as unknown as IncidentItem[];

  // Apply pagination
  const totalCount = allItems.length;
  const startIndex = (filters.page - 1) * filters.pageSize;
  const paginatedItems = allItems.slice(startIndex, startIndex + filters.pageSize);

  return {
    items: paginatedItems.map(formatIncidentForExport),
    totalCount,
  };
}

function formatIncidentForExport(item: IncidentItem): Record<string, unknown> {
  return {
    incidentId: item.incidentId,
    externalId: item.externalId,
    severity: item.severity,
    detectionTimestamp: item.detectionTimestamp,
    resolutionTimestamp: item.resolutionTimestamp || null,
    correlatedDeployments: item.correlatedDeployments || [],
    correlationStatus: item.correlationStatus,
  };
}
