/**
 * Seed Demo Data Script
 *
 * Populates DynamoDB tables with realistic sample data so the dashboard
 * displays meaningful DORA metrics, risk distributions, and deployment history.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-data.ts
 *
 * Prerequisites:
 *   - AWS credentials configured (same as .env.local)
 *   - DynamoDB tables must exist (created via Terraform)
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

// ─── Configuration ─────────────────────────────────────────────────────────────

const TENANT_ID = "demo-tenant";
const TEAM_ID = "platform-team";
const TEAM_NAME = "Platform Engineering";
const SERVICES = ["api-gateway", "auth-service", "billing-service", "dashboard-ui", "notification-service"];
const ENVIRONMENTS = ["production", "staging"];
const AUTHORS = ["alex@ollinai.com", "maria@ollinai.com", "carlos@ollinai.com", "sofia@ollinai.com"];
const REGION = process.env.AWS_REGION || "us-east-2";

const TABLE_EVENTS = "ollinai-events";
const TABLE_INCIDENTS = "ollinai-incidents";
const TABLE_METRICS = "ollinai-metrics";
const TABLE_CONFIG = "ollinai-config";

// ─── Client Setup ──────────────────────────────────────────────────────────────

const endpoint = process.env.DYNAMODB_ENDPOINT || undefined;

const baseClient = new DynamoDBClient({
  region: REGION,
  ...(endpoint ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {}),
});

const client = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomRiskScore(): "low" | "medium" | "high" | "critical" {
  const r = Math.random();
  if (r < 0.45) return "low";
  if (r < 0.75) return "medium";
  if (r < 0.92) return "high";
  return "critical";
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function randomDateBetween(start: Date, end: Date): Date {
  const s = start.getTime();
  const e = end.getTime();
  return new Date(s + Math.random() * (e - s));
}

// ─── Seed Functions ────────────────────────────────────────────────────────────

async function seedTenantConfig() {
  console.log("  → Creating tenant subscription...");
  await client.send(new PutCommand({
    TableName: TABLE_CONFIG,
    Item: {
      PK: `TENANT#${TENANT_ID}`,
      SK: "SUBSCRIPTION#current",
      entityData: {
        tier: "pro",
        activatedAt: daysAgo(90).toISOString(),
      },
    },
  }));

  console.log("  → Creating team...");
  await client.send(new PutCommand({
    TableName: TABLE_CONFIG,
    Item: {
      PK: `TENANT#${TENANT_ID}`,
      SK: `TEAM#${TEAM_ID}`,
      entityData: {
        teamId: TEAM_ID,
        name: TEAM_NAME,
        members: AUTHORS,
        archived: false,
        createdAt: daysAgo(90).toISOString(),
        updatedAt: daysAgo(1).toISOString(),
      },
    },
  }));

  console.log("  → Creating services...");
  for (const svc of SERVICES) {
    await client.send(new PutCommand({
      TableName: TABLE_CONFIG,
      Item: {
        PK: `TENANT#${TENANT_ID}`,
        SK: `SVC#${svc}`,
        entityData: {
          serviceId: svc,
          name: svc.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          owningTeamId: TEAM_ID,
          ownershipHistory: [{ teamId: TEAM_ID, from: daysAgo(90).toISOString() }],
          createdAt: daysAgo(90).toISOString(),
          updatedAt: daysAgo(1).toISOString(),
        },
      },
    }));
  }

  console.log("  → Creating integration...");
  await client.send(new PutCommand({
    TableName: TABLE_CONFIG,
    Item: {
      PK: `TENANT#${TENANT_ID}`,
      SK: "INTEGRATION#github-ci",
      entityData: {
        integrationId: "github-ci",
        name: "GitHub Actions",
        type: "github",
        secretKeyHash: "sha256:demo-hash-not-real",
        createdAt: daysAgo(60).toISOString(),
        updatedAt: daysAgo(1).toISOString(),
      },
    },
  }));
}

async function seedDeploymentEvents(): Promise<string[]> {
  console.log("  → Creating deployment events (last 60 days)...");
  const eventIds: string[] = [];
  const items: Record<string, unknown>[] = [];

  // Generate ~120 deployments over the last 60 days
  for (let i = 0; i < 120; i++) {
    const eventId = randomUUID();
    const service = randomChoice(SERVICES);
    const author = randomChoice(AUTHORS);
    const env = randomChoice(ENVIRONMENTS);
    const timestamp = randomDateBetween(daysAgo(60), new Date());
    const iso = timestamp.toISOString();
    const risk = randomRiskScore();
    const commitSha = randomUUID().replace(/-/g, "").substring(0, 12);

    eventIds.push(eventId);

    items.push({
      PK: `TENANT#${TENANT_ID}#SVC#${service}`,
      SK: `DEPLOY#${iso}#${eventId}`,
      eventId,
      commitShas: [commitSha],
      author,
      services: [service],
      environment: env,
      changeSize: {
        linesAdded: randomInt(5, 500),
        linesRemoved: randomInt(0, 200),
        filesChanged: randomInt(1, 30),
      },
      teamId: TEAM_ID,
      riskScore: risk,
      riskFactors: {
        changeFailureRate: Math.random() * 0.5,
        changeSize: Math.random() * 0.4,
        deploymentTiming: Math.random() * 0.3,
        authorFailureRate: Math.random() * 0.3,
      },
      correlatedIncidents: [],
      createdAt: iso,
      // GSI attributes
      GSI1SK: `TS#${iso}`,
      GSI2PK: `TENANT#${TENANT_ID}#TEAM#${TEAM_ID}`,
      GSI2SK: `DEPLOY#${iso}`,
      GSI3PK: `TENANT#${TENANT_ID}#DEDUP`,
      GSI3SK: `${commitSha}#${service}#${env}`,
    });
  }

  // Also create entries for the "ALL" team view (used by dashboard)
  for (const item of items) {
    const allTeamItem = {
      ...item,
      PK: item.PK, // keep original PK
      GSI2PK: `TENANT#${TENANT_ID}#TEAM#ALL`,
    };
    // We write only the original item; the GSI2PK covers both views
  }

  // Batch write in groups of 25
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await client.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_EVENTS]: batch.map((item) => ({
          PutRequest: { Item: item },
        })),
      },
    }));
  }

  console.log(`    Created ${items.length} deployment events`);
  return eventIds;
}

async function seedIncidents(eventIds: string[]) {
  console.log("  → Creating incidents (last 60 days)...");
  const items: Record<string, unknown>[] = [];

  // Generate ~15 incidents
  for (let i = 0; i < 15; i++) {
    const incidentId = randomUUID();
    const service = randomChoice(SERVICES);
    const detectionTime = randomDateBetween(daysAgo(60), new Date());
    const iso = detectionTime.toISOString();
    const severity = randomChoice(["low", "medium", "high", "critical"] as const);

    // 80% of incidents are resolved
    const resolved = Math.random() < 0.8;
    const resolutionTimestamp = resolved
      ? new Date(detectionTime.getTime() + randomInt(30, 480) * 60 * 1000).toISOString()
      : undefined;

    // Correlate with a random deployment
    const correlatedDeployments = Math.random() < 0.7
      ? [randomChoice(eventIds)]
      : [];

    items.push({
      PK: `TENANT#${TENANT_ID}#SVC#${service}`,
      SK: `INC#${iso}#${incidentId}`,
      incidentId,
      externalId: `PD-${randomInt(10000, 99999)}`,
      severity,
      detectionTimestamp: iso,
      resolutionTimestamp,
      correlatedDeployments,
      correlationStatus: correlatedDeployments.length > 0 ? "correlated" : "uncorrelated",
      GSI1PK: `TENANT#${TENANT_ID}`,
      GSI1SK: `INC#${iso}`,
    });
  }

  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await client.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_INCIDENTS]: batch.map((item) => ({
          PutRequest: { Item: item },
        })),
      },
    }));
  }

  console.log(`    Created ${items.length} incidents`);
}

async function seedDORAMetrics() {
  console.log("  → Creating DORA metrics...");

  const now = new Date();

  // Create metrics for multiple time ranges the dashboard uses
  const ranges = [
    { days: 7, label: "7d" },
    { days: 14, label: "14d" },
    { days: 30, label: "30d" },
    { days: 60, label: "60d" },
    { days: 90, label: "90d" },
  ];

  for (const { days } of ranges) {
    const periodStart = daysAgo(days).toISOString();
    const periodEnd = now.toISOString();

    // ALL scope (what the main dashboard queries)
    await client.send(new PutCommand({
      TableName: TABLE_METRICS,
      Item: {
        PK: `TENANT#${TENANT_ID}#SCOPE#ALL#ALL`,
        SK: `PERIOD#${periodStart}#${periodEnd}`,
        deploymentFrequency: +(120 / days).toFixed(2), // deploys per day
        leadTimeHours: +(randomInt(2, 48) + Math.random()).toFixed(1),
        changeFailureRate: +(randomInt(8, 22) + Math.random()).toFixed(1),
        mttrHours: +(randomInt(1, 8) + Math.random()).toFixed(1),
        unresolvedCount: randomInt(1, 4),
        dataPoints: randomInt(20, 120),
        computedAt: now.toISOString(),
      },
    }));

    // Per-team metrics
    await client.send(new PutCommand({
      TableName: TABLE_METRICS,
      Item: {
        PK: `TENANT#${TENANT_ID}#SCOPE#TEAM#${TEAM_ID}`,
        SK: `PERIOD#${periodStart}#${periodEnd}`,
        deploymentFrequency: +(120 / days).toFixed(2),
        leadTimeHours: +(randomInt(3, 36) + Math.random()).toFixed(1),
        changeFailureRate: +(randomInt(10, 20) + Math.random()).toFixed(1),
        mttrHours: +(randomInt(1, 6) + Math.random()).toFixed(1),
        unresolvedCount: randomInt(0, 3),
        dataPoints: randomInt(15, 80),
        computedAt: now.toISOString(),
      },
    }));

    // Per-service metrics
    for (const svc of SERVICES) {
      await client.send(new PutCommand({
        TableName: TABLE_METRICS,
        Item: {
          PK: `TENANT#${TENANT_ID}#SCOPE#SERVICE#${svc}`,
          SK: `PERIOD#${periodStart}#${periodEnd}`,
          deploymentFrequency: +(randomInt(10, 30) / days).toFixed(2),
          leadTimeHours: +(randomInt(1, 72) + Math.random()).toFixed(1),
          changeFailureRate: +(randomInt(5, 30) + Math.random()).toFixed(1),
          mttrHours: +(randomInt(1, 12) + Math.random()).toFixed(1),
          unresolvedCount: randomInt(0, 2),
          dataPoints: randomInt(5, 30),
          computedAt: now.toISOString(),
        },
      }));
    }
  }

  // Create "previous period" metrics for trend comparison
  for (const { days } of ranges) {
    const prevStart = daysAgo(days * 2).toISOString();
    const prevEnd = daysAgo(days).toISOString();

    await client.send(new PutCommand({
      TableName: TABLE_METRICS,
      Item: {
        PK: `TENANT#${TENANT_ID}#SCOPE#ALL#ALL`,
        SK: `PERIOD#${prevStart}#${prevEnd}`,
        deploymentFrequency: +(100 / days).toFixed(2), // slightly lower than current
        leadTimeHours: +(randomInt(4, 60) + Math.random()).toFixed(1),
        changeFailureRate: +(randomInt(12, 28) + Math.random()).toFixed(1),
        mttrHours: +(randomInt(2, 10) + Math.random()).toFixed(1),
        unresolvedCount: randomInt(2, 5),
        dataPoints: randomInt(15, 100),
        computedAt: daysAgo(days).toISOString(),
      },
    }));
  }

  console.log(`    Created metrics for ${ranges.length} time ranges × ${SERVICES.length + 2} scopes`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding OllinAI demo data...");
  console.log(`   Region: ${REGION}`);
  console.log(`   Endpoint: ${endpoint || "(production DynamoDB)"}`);
  console.log(`   Tenant: ${TENANT_ID}`);
  console.log("");

  try {
    await seedTenantConfig();
    const eventIds = await seedDeploymentEvents();
    await seedIncidents(eventIds);
    await seedDORAMetrics();

    console.log("");
    console.log("✅ Done! Demo data seeded successfully.");
    console.log("");
    console.log("   To view the dashboard, set DEFAULT_TENANT_ID=demo-tenant");
    console.log("   in your .env.local or Vercel environment variables,");
    console.log("   then visit: https://ollin-ai.vercel.app/dashboard");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
}

main();
