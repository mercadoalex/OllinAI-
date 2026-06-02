/**
 * DORA Metrics Query API
 *
 * GET /api/metrics/dora?team=X&service=Y&environment=Z&from=DATE&to=DATE
 *
 * Returns computed DORA metrics for the specified scope and time range.
 * Reads pre-computed metrics from the ollinai-metrics table (via DAX cache when available).
 * If no pre-computed metrics exist, computes them on-the-fly using the same logic
 * as the DORA computer Lambda.
 *
 * Filters:
 *   - team: Filter by team ID
 *   - service: Filter by service ID
 *   - environment: Filter by environment name
 *   - from: Start of time range (ISO 8601), defaults to 30 days ago
 *   - to: End of time range (ISO 8601), defaults to now
 *
 * Default time range: 30 days when no from/to specified.
 * Maximum queryable range: 365 days.
 *
 * Authentication: Required (any role can read metrics).
 * Tier gating: None (DORA metrics available on all tiers including Starter).
 *
 * Requirements: 3.5
 */

import { NextRequest, NextResponse } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { withAuthorization } from "@/lib/middleware/authorize";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantMetricsScopeKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import {
  computeAndStoreMetrics,
  INSUFFICIENT_DATA_SENTINEL,
} from "@/lambdas/dora-computer/handler";
import type { DORAMetrics } from "@/lib/types";
import type { MetricsItem } from "@/lib/types/dynamo";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Default period for DORA metrics queries (30 days in ms) */
const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Maximum queryable range (365 days in ms) */
const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

// ─── GET /api/metrics/dora ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Step 1: Authenticate — any role can read metrics
  const authResult = await withAuthorization(request, {
    resource: "settings",
    permission: "read",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;

  // Step 2: Parse and validate query parameters
  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team") || undefined;
  const service = searchParams.get("service") || undefined;
  const environment = searchParams.get("environment") || undefined;
  const fromParam = searchParams.get("from") || undefined;
  const toParam = searchParams.get("to") || undefined;

  // Step 3: Resolve time range with defaults
  const now = new Date();
  let periodEnd: Date;
  let periodStart: Date;

  if (toParam) {
    const parsedTo = new Date(toParam);
    if (isNaN(parsedTo.getTime())) {
      return NextResponse.json(
        { error: "Invalid 'to' parameter. Must be a valid ISO 8601 date." },
        { status: 400 }
      );
    }
    periodEnd = parsedTo;
  } else {
    periodEnd = now;
  }

  if (fromParam) {
    const parsedFrom = new Date(fromParam);
    if (isNaN(parsedFrom.getTime())) {
      return NextResponse.json(
        { error: "Invalid 'from' parameter. Must be a valid ISO 8601 date." },
        { status: 400 }
      );
    }
    periodStart = parsedFrom;
  } else {
    periodStart = new Date(periodEnd.getTime() - DEFAULT_PERIOD_MS);
  }

  // Step 4: Validate time range constraints
  if (periodStart >= periodEnd) {
    return NextResponse.json(
      { error: "'from' must be before 'to'." },
      { status: 400 }
    );
  }

  const rangeMs = periodEnd.getTime() - periodStart.getTime();
  if (rangeMs > MAX_RANGE_MS) {
    return NextResponse.json(
      { error: "Maximum queryable range is 365 days." },
      { status: 400 }
    );
  }

  // Step 5: Determine scope for the metrics query
  const { scopeType, scopeId } = resolveScope(team, service, environment);

  const periodStartISO = periodStart.toISOString();
  const periodEndISO = periodEnd.toISOString();

  try {
    // Step 6: Attempt to read pre-computed metrics from DAX/DynamoDB
    let metricsItem = await readCachedMetrics(
      tenantId,
      scopeType,
      scopeId,
      periodStartISO,
      periodEndISO
    );

    // Step 7: If no cached metrics, compute on-the-fly
    if (!metricsItem) {
      const serviceId = service || scopeId;
      const teamId = team || undefined;

      metricsItem = await computeAndStoreMetrics(
        tenantId,
        scopeType,
        scopeId,
        serviceId,
        teamId,
        periodStartISO,
        periodEndISO
      );
    }

    // Step 8: Transform to API response format
    const response = transformToAPIResponse(
      metricsItem,
      periodStartISO,
      periodEndISO,
      { team, service, environment }
    );

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("DORA metrics query failed:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve DORA metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves the scope type and ID based on the provided filters.
 * Priority: service > team > environment > ALL.
 */
function resolveScope(
  team?: string,
  service?: string,
  environment?: string
): { scopeType: "TEAM" | "SERVICE" | "ENVIRONMENT" | "ALL"; scopeId: string } {
  if (service) {
    return { scopeType: "SERVICE", scopeId: service };
  }
  if (team) {
    return { scopeType: "TEAM", scopeId: team };
  }
  if (environment) {
    return { scopeType: "ENVIRONMENT", scopeId: environment };
  }
  return { scopeType: "ALL", scopeId: "ALL" };
}

/**
 * Reads pre-computed metrics from the ollinai-metrics table.
 * Uses DAX cache when available (handled by the DynamoDB client factory).
 */
async function readCachedMetrics(
  tenantId: string,
  scopeType: "TEAM" | "SERVICE" | "ENVIRONMENT" | "ALL",
  scopeId: string,
  periodStart: string,
  periodEnd: string
): Promise<MetricsItem | null> {
  const client = getDocumentClient();

  const pk = tenantMetricsScopeKey(tenantId, scopeType, scopeId);
  const sk = `PERIOD#${periodStart}#${periodEnd}`;

  const result = await client.send(
    new GetCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.METRICS,
        Key: { PK: pk, SK: sk },
      })
    )
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as unknown as MetricsItem;
}

/**
 * Transforms a MetricsItem from DynamoDB into the DORAMetrics API response format.
 * Converts INSUFFICIENT_DATA_SENTINEL (-1) values to "insufficient_data" string.
 */
function transformToAPIResponse(
  item: MetricsItem,
  periodStart: string,
  periodEnd: string,
  filters: { team?: string; service?: string; environment?: string }
): DORAMetrics {
  return {
    deploymentFrequency:
      item.deploymentFrequency === INSUFFICIENT_DATA_SENTINEL
        ? "insufficient_data"
        : item.deploymentFrequency,
    leadTimeHours:
      item.leadTimeHours === INSUFFICIENT_DATA_SENTINEL
        ? "insufficient_data"
        : item.leadTimeHours,
    changeFailureRate:
      item.changeFailureRate === INSUFFICIENT_DATA_SENTINEL
        ? "insufficient_data"
        : item.changeFailureRate,
    mttrHours:
      item.mttrHours === INSUFFICIENT_DATA_SENTINEL
        ? "insufficient_data"
        : item.mttrHours,
    unresolvedIncidentCount: item.unresolvedCount,
    period: {
      start: periodStart,
      end: periodEnd,
    },
    filters: {
      ...(filters.team && { team: filters.team }),
      ...(filters.service && { service: filters.service }),
      ...(filters.environment && { environment: filters.environment }),
    },
  };
}
