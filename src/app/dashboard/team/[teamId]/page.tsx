/**
 * Team-Scoped Dashboard Page — Server Component
 *
 * Displays DORA metrics and deployment timeline filtered by team.
 * All visualizations are scoped to the selected team.
 *
 * Requirements: 9.2, 9.3, 9.9
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { tenantTeamKey } from "@/lib/dynamo/tenant-scope";
import { headers } from "next/headers";

export const revalidate = 30;

interface TeamDeployment {
  eventId: string;
  services: string[];
  author: string;
  environment: string;
  riskScore: string;
  createdAt: string;
  correlatedIncidents: string[];
}

interface TeamMetrics {
  deploymentFrequency: number | "insufficient_data";
  leadTimeHours: number | "insufficient_data";
  changeFailureRate: number | "insufficient_data";
  mttrHours: number | "insufficient_data";
}

export default async function TeamDashboardPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const tenantId = getServerTenantId();
  const deployments = tenantId ? await fetchTeamDeployments(tenantId, teamId) : [];
  const metrics = tenantId ? await fetchTeamMetrics(tenantId, teamId) : null;

  return (
    <main style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "8px" }}>
        Team: {teamId}
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        Deployment metrics and timeline scoped to this team.
      </p>

      {/* DORA Metrics Summary */}
      {metrics && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <MetricCard label="Deployment Frequency" value={metrics.deploymentFrequency} unit="/period" />
          <MetricCard label="Lead Time" value={metrics.leadTimeHours} unit=" hrs" />
          <MetricCard label="Change Failure Rate" value={metrics.changeFailureRate} unit="%" />
          <MetricCard label="MTTR" value={metrics.mttrHours} unit=" hrs" />
        </div>
      )}

      {/* Deployment Timeline */}
      <h2 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "12px" }}>
        Recent Deployments
      </h2>
      {deployments.length === 0 ? (
        <div style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>
          No deployments found for this team.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {deployments.map((d) => (
            <div
              key={d.eventId}
              style={{
                padding: "12px 16px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{d.services.join(", ")}</div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  {d.author} • {d.environment} • {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
              <span style={{ fontSize: "12px", fontWeight: 500 }}>{d.riskScore}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function MetricCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | "insufficient_data";
  unit: string;
}) {
  return (
    <div
      style={{
        padding: "16px",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        backgroundColor: "#fafafa",
      }}
    >
      <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 600 }}>
        {value === "insufficient_data" ? "—" : `${value}${unit}`}
      </div>
    </div>
  );
}

async function fetchTeamDeployments(
  tenantId: string,
  teamId: string
): Promise<TeamDeployment[]> {
  const client = getDocumentClient();
  const now = new Date();
  const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const pk = tenantTeamKey(tenantId, teamId);

  try {
    const result = await client.send(
      new QueryCommand({
        TableName: TableNames.EVENTS,
        IndexName: "GSI2-TeamView",
        KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":start": `DEPLOY#${periodStart.toISOString()}`,
          ":end": `DEPLOY#${now.toISOString()}`,
        },
        ScanIndexForward: false,
        Limit: 50,
      })
    );

    return (result.Items || []).map((item) => ({
      eventId: item.eventId as string,
      services: (item.services as string[]) || [],
      author: (item.author as string) || "unknown",
      environment: (item.environment as string) || "unknown",
      riskScore: (item.riskScore as string) || "indeterminate",
      createdAt: item.createdAt as string,
      correlatedIncidents: (item.correlatedIncidents as string[]) || [],
    }));
  } catch (error) {
    console.error("Failed to fetch team deployments:", error);
    return [];
  }
}

async function fetchTeamMetrics(
  tenantId: string,
  teamId: string
): Promise<TeamMetrics | null> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}#SCOPE#TEAM#${teamId}`;

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
      const item = result.Items[0];
      const INSUFFICIENT = -1;
      return {
        deploymentFrequency:
          item.deploymentFrequency === INSUFFICIENT ? "insufficient_data" : (item.deploymentFrequency as number),
        leadTimeHours:
          item.leadTimeHours === INSUFFICIENT ? "insufficient_data" : (item.leadTimeHours as number),
        changeFailureRate:
          item.changeFailureRate === INSUFFICIENT ? "insufficient_data" : (item.changeFailureRate as number),
        mttrHours:
          item.mttrHours === INSUFFICIENT ? "insufficient_data" : (item.mttrHours as number),
      };
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch team metrics:", error);
    return null;
  }
}

function getServerTenantId(): string | null {
  try {
    const headersList = headers();
    return headersList.get("x-tenant-id") || process.env.DEFAULT_TENANT_ID || null;
  } catch {
    return process.env.DEFAULT_TENANT_ID || null;
  }
}
