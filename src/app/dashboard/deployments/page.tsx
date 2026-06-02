/**
 * Deployment Timeline Page — Server Component
 *
 * Displays a color-coded risk timeline of deployment events with
 * correlated incidents overlaid. Supports filtering by time range.
 *
 * Requirements: 9.2, 9.3, 9.9
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { headers } from "next/headers";

export const revalidate = 30;

interface DeploymentTimelineEntry {
  eventId: string;
  services: string[];
  author: string;
  environment: string;
  riskScore: "low" | "medium" | "high" | "critical" | "indeterminate";
  createdAt: string;
  correlatedIncidents: string[];
  teamId: string;
}

const RISK_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
  indeterminate: "#6b7280",
};

export default async function DeploymentsTimelinePage() {
  const tenantId = getServerTenantId();
  const deployments = tenantId ? await fetchDeployments(tenantId) : [];

  return (
    <main style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "16px" }}>
        Deployment Timeline
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        Color-coded deployment events with correlated incidents overlay.
      </p>

      {deployments.length === 0 ? (
        <div style={{ padding: "48px", textAlign: "center", color: "#6b7280" }}>
          No deployments found for the selected time range.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {deployments.map((deploy) => (
            <div
              key={deploy.eventId}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 16px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                borderLeft: `4px solid ${RISK_COLORS[deploy.riskScore] || RISK_COLORS.indeterminate}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>
                  {deploy.services.join(", ")}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  {deploy.author} • {deploy.environment} • {new Date(deploy.createdAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: 500,
                    backgroundColor: `${RISK_COLORS[deploy.riskScore]}20`,
                    color: RISK_COLORS[deploy.riskScore],
                  }}
                >
                  {deploy.riskScore}
                </span>
                {deploy.correlatedIncidents.length > 0 && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: 500,
                      backgroundColor: "#fef2f2",
                      color: "#dc2626",
                    }}
                  >
                    {deploy.correlatedIncidents.length} incident{deploy.correlatedIncidents.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

async function fetchDeployments(tenantId: string): Promise<DeploymentTimelineEntry[]> {
  const client = getDocumentClient();
  const now = new Date();
  const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    const result = await client.send(
      new QueryCommand({
        TableName: TableNames.EVENTS,
        IndexName: "GSI-2",
        KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}#TEAM#ALL`,
          ":start": `DEPLOY#${periodStart.toISOString()}`,
          ":end": `DEPLOY#${now.toISOString()}`,
        },
        ScanIndexForward: false,
        Limit: 100,
      })
    );

    return (result.Items || []).map((item) => ({
      eventId: item.eventId as string,
      services: (item.services as string[]) || [],
      author: (item.author as string) || "unknown",
      environment: (item.environment as string) || "unknown",
      riskScore: (item.riskScore as DeploymentTimelineEntry["riskScore"]) || "indeterminate",
      createdAt: item.createdAt as string,
      correlatedIncidents: (item.correlatedIncidents as string[]) || [],
      teamId: (item.teamId as string) || "UNASSIGNED",
    }));
  } catch (error) {
    console.error("Failed to fetch deployments:", error);
    return [];
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
