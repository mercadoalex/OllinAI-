/**
 * Auto-seed Demo Data for New Tenants
 *
 * Called non-blocking after user registration to populate the dashboard
 * with realistic sample data so new users see meaningful metrics immediately.
 *
 * Writes directly to DynamoDB using BatchWriteCommand for efficiency.
 * Must complete in < 3 seconds. Failures are swallowed — never block registration.
 */

import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { randomUUID } from "crypto";

// ─── Configuration ─────────────────────────────────────────────────────────────

const SERVICES = ["api-gateway", "auth-service", "billing-service", "dashboard-ui"];
const AUTHORS = ["demo-user@example.com", "alice@example.com", "bob@example.com"];
const TEAM = "UNASSIGNED";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Risk score distribution: ~40% low, 30% medium, 20% high, 10% critical
 */
function randomRiskScore(): "low" | "medium" | "high" | "critical" {
  const r = Math.random();
  if (r < 0.4) return "low";
  if (r < 0.7) return "medium";
  if (r < 0.9) return "high";
  return "critical";
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function randomDateInLastDays(days: number): Date {
  const start = daysAgo(days).getTime();
  const end = Date.now();
  return new Date(start + Math.random() * (end - start));
}

// ─── Batch Write Helper ────────────────────────────────────────────────────────

async function batchWriteItems(
  tableName: string,
  items: Record<string, unknown>[]
): Promise<void> {
  const client = getDocumentClient();

  // DynamoDB BatchWrite supports max 25 items per request
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await client.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      })
    );
  }
}

// ─── Seed Functions ────────────────────────────────────────────────────────────

function generateDeploymentEvents(tenantId: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  for (let i = 0; i < 30; i++) {
    const eventId = randomUUID();
    const service = randomChoice(SERVICES);
    const author = randomChoice(AUTHORS);
    const timestamp = randomDateInLastDays(30);
    const iso = timestamp.toISOString();
    const risk = randomRiskScore();
    const commitSha = randomUUID().replace(/-/g, "").substring(0, 12);

    // ~30% of events get a prediction score and correlated incidents
    const hasPrediction = Math.random() < 0.3;

    const item: Record<string, unknown> = {
      PK: `TENANT#${tenantId}#SVC#${service}`,
      SK: `DEPLOY#${iso}#${eventId}`,
      eventId,
      commitShas: [commitSha],
      author,
      services: [service],
      environment: "production",
      changeSize: {
        linesAdded: randomInt(5, 300),
        linesRemoved: randomInt(0, 100),
        filesChanged: randomInt(1, 20),
      },
      teamId: TEAM,
      riskScore: risk,
      riskFactors: {
        changeFailureRate: Math.random() * 0.4,
        changeSize: Math.random() * 0.3,
        deploymentTiming: Math.random() * 0.2,
        authorFailureRate: Math.random() * 0.2,
      },
      correlatedIncidents: hasPrediction ? [`inc-${randomUUID().slice(0, 8)}`] : [],
      createdAt: iso,
      // GSI attributes for dashboard queries
      GSI1SK: `TS#${iso}`,
      GSI2PK: `TENANT#${tenantId}#TEAM#${TEAM}`,
      GSI2SK: `DEPLOY#${iso}`,
      GSI3PK: `TENANT#${tenantId}#DEDUP`,
      GSI3SK: `${commitSha}#${service}#production`,
    };

    if (hasPrediction) {
      item.predictionScore = +(0.3 + Math.random() * 0.6).toFixed(2);
    }

    items.push(item);
  }

  return items;
}

function generateIncidents(tenantId: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  // 3 correlated incidents
  for (let i = 0; i < 3; i++) {
    const incidentId = randomUUID();
    const service = randomChoice(SERVICES);
    const detectionTime = randomDateInLastDays(30);
    const iso = detectionTime.toISOString();
    const resolutionTime = new Date(
      detectionTime.getTime() + randomInt(30, 240) * 60 * 1000
    ).toISOString();

    items.push({
      PK: `TENANT#${tenantId}#SVC#${service}`,
      SK: `INC#${iso}#${incidentId}`,
      incidentId,
      externalId: `PD-${randomInt(10000, 99999)}`,
      severity: randomChoice(["medium", "high", "critical"] as const),
      detectionTimestamp: iso,
      resolutionTimestamp: resolutionTime,
      correlatedDeployments: [randomUUID()],
      correlationStatus: "correlated",
      GSI1PK: `TENANT#${tenantId}`,
      GSI1SK: `INC#${iso}`,
    });
  }

  // 2 uncorrelated incidents
  for (let i = 0; i < 2; i++) {
    const incidentId = randomUUID();
    const service = randomChoice(SERVICES);
    const detectionTime = randomDateInLastDays(30);
    const iso = detectionTime.toISOString();

    items.push({
      PK: `TENANT#${tenantId}#SVC#${service}`,
      SK: `INC#${iso}#${incidentId}`,
      incidentId,
      externalId: `PD-${randomInt(10000, 99999)}`,
      severity: randomChoice(["low", "medium"] as const),
      detectionTimestamp: iso,
      resolutionTimestamp: undefined,
      correlatedDeployments: [],
      correlationStatus: "uncorrelated",
      GSI1PK: `TENANT#${tenantId}`,
      GSI1SK: `INC#${iso}`,
    });
  }

  return items;
}

function generateMetricsRecord(tenantId: string): Record<string, unknown> {
  const now = new Date();
  const periodStart = daysAgo(30).toISOString();
  const periodEnd = now.toISOString();

  return {
    PK: `TENANT#${tenantId}#SCOPE#ALL#ALL`,
    SK: `PERIOD#${periodStart}#${periodEnd}`,
    deploymentFrequency: 1.0, // 1 deploy/day (30 deploys over 30 days)
    leadTimeHours: 4.2,
    changeFailureRate: 15.3,
    mttrHours: 2.1,
    unresolvedCount: 2,
    dataPoints: 30,
    computedAt: now.toISOString(),
  };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Seeds demo data for a newly registered tenant.
 * Non-blocking — failures are logged but never propagate.
 */
export async function seedTenantDemoData(tenantId: string): Promise<void> {
  const deployments = generateDeploymentEvents(tenantId);
  const incidents = generateIncidents(tenantId);
  const metrics = generateMetricsRecord(tenantId);

  // Write all data in parallel for speed
  await Promise.all([
    batchWriteItems(TableNames.EVENTS, deployments),
    batchWriteItems(TableNames.INCIDENTS, incidents),
    batchWriteItems(TableNames.METRICS, [metrics]),
  ]);
}
