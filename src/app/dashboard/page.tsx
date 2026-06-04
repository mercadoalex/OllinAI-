/**
 * Dashboard Summary Page — Server Component
 *
 * Server-rendered dashboard with 30-second ISR revalidation.
 * Fetches initial DORA metrics and risk score distribution from DynamoDB,
 * then hands off to client components for polling-based updates.
 *
 * Requirements: 9.1, 9.4, 9.5, 9.7, 9.8
 */

import { headers } from "next/headers";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { DashboardClient, DashboardInitialData } from "./components/dashboard-client";
import type { RiskDistribution } from "./components/risk-histogram";
import type { MetricsItem } from "@/lib/types/dynamo";

// ISR: revalidate every 30 seconds
export const revalidate = 30;

/** Default time range: 30 days */
const DEFAULT_DAYS = 30;

/** Retention period mapping by tier */
const TIER_RETENTION_DAYS: Record<string, number> = {
  starter: 30,
  pro: 90,
  enterprise: 365,
};

export default async function DashboardPage() {
  const initialData = await fetchDashboardData();

  return (
    <main style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <DashboardClient initialData={initialData} defaultTimeRange={DEFAULT_DAYS} />
    </main>
  );
}

// ─── Server-side Data Fetching ─────────────────────────────────────────────────

async function fetchDashboardData(): Promise<DashboardInitialData> {
  try {
    // In a production setup, we'd extract the tenantId from the session.
    // For now, attempt to read from headers or use a default.
    const tenantId = getServerTenantId();

    if (!tenantId) {
      return getEmptyDashboardData();
    }

    const now = new Date();
    const periodStart = new Date(now.getTime() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
    const previousStart = new Date(periodStart.getTime() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);

    const periodStartISO = periodStart.toISOString();
    const periodEndISO = now.toISOString();
    const previousStartISO = previousStart.toISOString();

    // Fetch current and previous period metrics, and deployment events in parallel
    const [currentMetrics, previousMetrics, riskData] = await Promise.all([
      fetchMetricsFromDB(tenantId, periodStartISO, periodEndISO),
      fetchMetricsFromDB(tenantId, previousStartISO, periodStartISO),
      fetchRiskDistribution(tenantId, periodStartISO, periodEndISO),
    ]);

    const maxRetentionDays = await getRetentionDays(tenantId);

    return {
      currentMetrics: currentMetrics
        ? transformMetricsItem(currentMetrics, periodStartISO, periodEndISO)
        : null,
      previousMetrics: previousMetrics
        ? transformMetricsItem(previousMetrics, previousStartISO, periodStartISO)
        : null,
      riskDistribution: riskData.distribution,
      totalEvents: riskData.totalEvents,
      maxRetentionDays,
    };
  } catch (error) {
    console.error("Failed to fetch dashboard data:", error);
    return getEmptyDashboardData();
  }
}

/**
 * Fetches pre-computed DORA metrics from the ollinai-metrics table.
 */
async function fetchMetricsFromDB(
  tenantId: string,
  periodStart: string,
  periodEnd: string
): Promise<MetricsItem | null> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}#SCOPE#ALL#ALL`;
  const sk = `PERIOD#${periodStart}#${periodEnd}`;

  try {
    const result = await client.send(
      new QueryCommand({
        TableName: TableNames.METRICS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skPrefix": "PERIOD#",
        },
        ScanIndexForward: false,
        Limit: 1,
      })
    );

    if (result.Items && result.Items.length > 0) {
      return result.Items[0] as unknown as MetricsItem;
    }
    return null;
  } catch (error) {
    console.error("Metrics fetch error:", error);
    return null;
  }
}

/**
 * Fetches deployment events and computes risk score distribution.
 */
async function fetchRiskDistribution(
  tenantId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ distribution: RiskDistribution; totalEvents: number }> {
  const client = getDocumentClient();
  const distribution: RiskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
  let totalEvents = 0;

  try {
    // Query events using the GSI-2 (team view) or scan with tenant prefix
    // For the "ALL" scope, we query by tenant prefix on the events table
    const result = await client.send(
      new QueryCommand({
        TableName: TableNames.EVENTS,
        IndexName: "GSI2-TeamView",
        KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}#TEAM#ALL`,
          ":start": `DEPLOY#${periodStart}`,
          ":end": `DEPLOY#${periodEnd}`,
        },
        ProjectionExpression: "riskScore",
        Limit: 10000,
      })
    );

    if (result.Items) {
      totalEvents = result.Items.length;
      for (const item of result.Items) {
        const score = item.riskScore as string | undefined;
        if (score === "low" || score === "medium" || score === "high" || score === "critical") {
          distribution[score]++;
        }
      }
    }
  } catch (error) {
    // If the GSI query fails (e.g., no "ALL" team), try a simpler approach
    // In practice, this would use a scan or a different GSI
    console.error("Risk distribution fetch error:", error);
  }

  return { distribution, totalEvents };
}

/**
 * Gets the tenant's retention period based on their subscription tier.
 */
async function getRetentionDays(tenantId: string): Promise<number> {
  const client = getDocumentClient();

  try {
    const result = await client.send(
      new QueryCommand({
        TableName: TableNames.CONFIG,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}`,
          ":sk": "SUBSCRIPTION#current",
        },
        Limit: 1,
      })
    );

    if (result.Items && result.Items.length > 0) {
      const item = result.Items[0];
      const entityData = item.entityData as { tier?: string } | undefined;
      const tier = entityData?.tier || "starter";
      return TIER_RETENTION_DAYS[tier] || 30;
    }
  } catch (error) {
    console.error("Retention days fetch error:", error);
  }

  return 30; // Default to starter tier retention
}

/**
 * Extracts tenant ID from request headers (set by auth middleware).
 * In production, this would come from the authenticated session.
 */
function getServerTenantId(): string | null {
  try {
    const headersList = headers();
    return headersList.get("x-tenant-id") || process.env.DEFAULT_TENANT_ID || null;
  } catch {
    return process.env.DEFAULT_TENANT_ID || null;
  }
}

/**
 * Transforms a MetricsItem into the API response shape for the client component.
 */
function transformMetricsItem(
  item: MetricsItem,
  periodStart: string,
  periodEnd: string
) {
  const INSUFFICIENT = -1; // Sentinel value used in the metrics table

  return {
    deploymentFrequency:
      item.deploymentFrequency === INSUFFICIENT
        ? ("insufficient_data" as const)
        : item.deploymentFrequency,
    leadTimeHours:
      item.leadTimeHours === INSUFFICIENT
        ? ("insufficient_data" as const)
        : item.leadTimeHours,
    changeFailureRate:
      item.changeFailureRate === INSUFFICIENT
        ? ("insufficient_data" as const)
        : item.changeFailureRate,
    mttrHours:
      item.mttrHours === INSUFFICIENT
        ? ("insufficient_data" as const)
        : item.mttrHours,
    unresolvedIncidentCount: item.unresolvedCount,
    period: { start: periodStart, end: periodEnd },
    filters: {},
  };
}

function getEmptyDashboardData(): DashboardInitialData {
  return {
    currentMetrics: null,
    previousMetrics: null,
    riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
    totalEvents: 0,
    maxRetentionDays: 30,
  };
}
