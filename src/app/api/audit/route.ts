/**
 * Audit Log Query API (Enterprise)
 *
 * GET /api/audit — Paginated audit log query with filters
 *
 * Filters: actor, action, resource, time range (from/to)
 * Pagination: max 100 per page
 * Returns within 5 seconds for queries up to 90 days.
 * Enterprise tier only.
 *
 * Requirements: 12.4
 */

import { NextRequest, NextResponse } from "next/server";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { tenantAuditKey, withTenantScope } from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import type { AuditItem } from "@/lib/types/dynamo";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** Maximum query window: 90 days in milliseconds */
const MAX_QUERY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  // Auth check
  const authResult = await withAuthorization(request, {
    resource: "audit_log",
    permission: "read",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;

  // Tier gate: Enterprise only
  const tierResult = await withTierGate(tenantId, "audit_logs");
  if (tierResult instanceof NextResponse) {
    return tierResult;
  }

  // Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const actor = searchParams.get("actor");
  const action = searchParams.get("action");
  const resource = searchParams.get("resource");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );

  // Validate time range does not exceed 90 days for performance
  if (from && to) {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (toMs - fromMs > MAX_QUERY_WINDOW_MS) {
      return NextResponse.json(
        {
          error: "Time range exceeds maximum of 90 days. Use narrower filters for larger ranges.",
        },
        { status: 400 }
      );
    }
  }

  try {
    const { items, totalCount } = await queryAuditLogs(tenantId, {
      actor,
      action,
      resource,
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
    console.error("Audit log query error:", error);
    return NextResponse.json(
      { error: "Failed to query audit logs" },
      { status: 500 }
    );
  }
}

interface QueryFilters {
  actor: string | null;
  action: string | null;
  resource: string | null;
  from: string | null;
  to: string | null;
  page: number;
  pageSize: number;
}

async function queryAuditLogs(
  tenantId: string,
  filters: QueryFilters
): Promise<{ items: Record<string, unknown>[]; totalCount: number }> {
  const client = getDocumentClient();
  const pk = tenantAuditKey(tenantId);

  const now = new Date().toISOString();
  const fromDate = filters.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = filters.to || now;

  // Query DynamoDB using sort key range (AUDIT#{timestamp}#{auditId})
  const expressionValues: Record<string, unknown> = {
    ":pk": pk,
    ":start": `AUDIT#${fromDate}`,
    ":end": `AUDIT#${toDate}z`,
  };

  // Build filter expressions for actor, action, resource
  const filterParts: string[] = [];

  if (filters.actor) {
    filterParts.push("actor = :actor");
    expressionValues[":actor"] = filters.actor;
  }

  if (filters.action) {
    filterParts.push("contains(#actionAttr, :actionVal)");
    expressionValues[":actionVal"] = filters.action;
  }

  if (filters.resource) {
    filterParts.push("contains(targetResource, :resource)");
    expressionValues[":resource"] = filters.resource;
  }

  const queryParams = withTenantScope(tenantId, {
    TableName: TableNames.AUDIT,
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :start AND :end",
    ExpressionAttributeValues: expressionValues,
    ...(filterParts.length > 0 && {
      FilterExpression: filterParts.join(" AND "),
    }),
    ...(filters.action && {
      ExpressionAttributeNames: {
        "#actionAttr": "action",
      },
    }),
    ScanIndexForward: false, // Most recent first
  });

  const result = await client.send(new QueryCommand(queryParams));
  const allItems = (result.Items || []) as unknown as AuditItem[];

  // Apply pagination
  const totalCount = allItems.length;
  const startIndex = (filters.page - 1) * filters.pageSize;
  const paginatedItems = allItems.slice(startIndex, startIndex + filters.pageSize);

  return {
    items: paginatedItems.map(formatAuditForExport),
    totalCount,
  };
}

function formatAuditForExport(item: AuditItem): Record<string, unknown> {
  return {
    actor: item.actor,
    action: item.action,
    targetResource: item.targetResource,
    sourceIp: item.sourceIp,
    outcome: item.outcome,
    timestamp: item.timestamp,
  };
}
