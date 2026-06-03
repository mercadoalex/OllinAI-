/**
 * Service-Scoped Dashboard Page — Server Component
 *
 * Displays DORA metrics and deployment timeline filtered by service.
 * All visualizations are scoped to the selected service.
 *
 * Requirements: 9.2, 9.3, 9.9
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { tenantServiceKey } from "@/lib/dynamo/tenant-scope";
import { headers } from "next/headers";

export const revalidate = 30;

interface ServiceDeployment {
  eventId: string;
  author: string;
  environment: string;
  riskScore: string;
  createdAt: string;
  correlatedIncidents: string[];
}

interface ServiceMetrics {
  deploymentFrequency: number | "insufficient_data";
  leadTimeHours: number | "insufficient_data";
  changeFailureRate: number | "insufficient_data";
  mttrHours: number | "insufficient_data";
}

export default async function ServiceDashboardPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const tenantId = getServerTenantId();
  const deployments = tenantId ? await fetchServiceDeployments(tenantId, serviceId) : [];
  const metrics = tenantId ? await fetchServiceMetrics(tenantId, serviceId) : null;

  return (
    <main style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "8px" }}>
        Service: {serviceId}
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        Deployment metrics and timeline scoped to this service.
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
          No deployments found for this service.
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
                <div style={{ fontWeight: 500 }}>{d.author}</div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  {d.environment} • {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "12px", fontWeight: 500 }}>{d.riskScore}</span>
                {d.correlatedIncidents.length > 0 && (
                  <span style={{ fontSize: "11px", color: "#dc2626" }}>
                    ⚠ {d.correlatedIncidents.length}
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

async function fetchServiceDeployments(
  tenantId: string,
  serviceId: string
): Promise<ServiceDeployment[]> {
  const client = getDocumentClient();
  const now = new Date();
  const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const pk = tenantServiceKey(tenantId, serviceId);

  try {
    const result = await client.send(
      new QueryCommand({
        TableName: TableNames.EVENTS,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":start": `DEPLOY#${periodStart.toISOString()}`,
          ":end": `DEPLOY#${now.toISOString()}z`,
        },
        ScanIndexForward: false,
        Limit: 50,
      })
    );

    return (result.Items || []).map((item) => ({
      eventId: item.eventId as string,
      author: (item.author as string) || "unknown",
      environment: (item.environment as string) || "unknown",
      riskScore: (item.riskScore as string) || "indeterminate",
      createdAt: item.createdAt as string,
      correlatedIncidents: (item.correlatedIncidents as string[]) || [],
    }));
  } catch (error) {
    console.error("Failed to fetch service deployments:", error);
    return [];
  }
}

async function fetchServiceMetrics(
  tenantId: string,
  serviceId: string
): Promise<ServiceMetrics | null> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}#SCOPE#SERVICE#${serviceId}`;

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
    console.error("Failed to fetch service metrics:", error);
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
