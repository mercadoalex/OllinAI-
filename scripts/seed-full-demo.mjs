#!/usr/bin/env node
/**
 * Full Demo Data Seeder — Populates ALL DynamoDB tables with realistic data
 * for hackathon judges to review.
 *
 * Usage: node scripts/seed-full-demo.mjs
 *
 * Requires AWS credentials in environment (uses .env.local via dotenv)
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Load .env.local ───────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* ignore */ }

// ─── Config ────────────────────────────────────────────────────────────────────
const REGION = process.env.AWS_REGION || "us-east-2";
const TENANT_ID = process.env.DEFAULT_TENANT_ID || "b2e8fb74-b614-4135-8db5-30c06442d40d";

const TABLES = {
  EVENTS: "ollinai-events",
  INCIDENTS: "ollinai-incidents",
  METRICS: "ollinai-metrics",
  CONFIG: "ollinai-config",
  AUDIT: "ollinai-audit",
  ATTESTATIONS: "ollinai-attestations",
  ML: "ollinai-ml",
};

const SERVICES = ["api-gateway", "auth-service", "billing-service", "dashboard-ui", "payment-processor", "user-service", "notification-service"];
const AUTHORS = ["alex@ollinai.com", "alice@engineering.com", "bob@platform.com", "carol@devops.com", "dave@security.com"];
const TEAMS = ["platform-engineering", "backend", "devops", "security", "frontend"];
const ENVIRONMENTS = ["production", "staging", "development"];

// ─── Client Setup ──────────────────────────────────────────────────────────────
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

// ─── Helpers ───────────────────────────────────────────────────────────────────
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
const randomDateInLastDays = (days) => new Date(daysAgo(days).getTime() + Math.random() * (Date.now() - daysAgo(days).getTime()));

function randomRisk() {
  const r = Math.random();
  if (r < 0.4) return "low";
  if (r < 0.7) return "medium";
  if (r < 0.9) return "high";
  return "critical";
}

async function batchWrite(tableName, items) {
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await client.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: batch.map(Item => ({ PutRequest: { Item } })),
      },
    }));
  }
}

// ─── Data Generators ───────────────────────────────────────────────────────────

function generateEvents(count = 200) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const eventId = randomUUID();
    const service = randomChoice(SERVICES);
    const author = randomChoice(AUTHORS);
    const team = randomChoice(TEAMS);
    const timestamp = randomDateInLastDays(60);
    const iso = timestamp.toISOString();
    const risk = randomRisk();
    const commitSha = randomUUID().replace(/-/g, "").substring(0, 12);
    const hasPrediction = Math.random() < 0.3;

    const item = {
      PK: `TENANT#${TENANT_ID}#SVC#${service}`,
      SK: `DEPLOY#${iso}#${eventId}`,
      eventId,
      commitShas: [commitSha],
      author,
      services: [service],
      environment: randomChoice(ENVIRONMENTS),
      changeSize: {
        linesAdded: randomInt(5, 500),
        linesRemoved: randomInt(0, 200),
        filesChanged: randomInt(1, 30),
      },
      teamId: team,
      riskScore: risk,
      riskFactors: {
        changeFailureRate: +(Math.random() * 0.4).toFixed(3),
        changeSize: +(Math.random() * 0.3).toFixed(3),
        deploymentTiming: +(Math.random() * 0.2).toFixed(3),
        authorFailureRate: +(Math.random() * 0.2).toFixed(3),
      },
      correlatedIncidents: hasPrediction ? [`inc-${randomUUID().slice(0, 8)}`] : [],
      createdAt: iso,
      GSI1SK: `TS#${iso}`,
      GSI2PK: `TENANT#${TENANT_ID}#TEAM#${team}`,
      GSI2SK: `DEPLOY#${iso}`,
      GSI3PK: `TENANT#${TENANT_ID}#DEDUP`,
      GSI3SK: `${commitSha}#${service}#production`,
    };

    if (hasPrediction) item.predictionScore = +(0.3 + Math.random() * 0.6).toFixed(2);
    items.push(item);
  }
  return items;
}

function generateIncidents(count = 25) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const incidentId = randomUUID();
    const service = randomChoice(SERVICES);
    const detectionTime = randomDateInLastDays(60);
    const iso = detectionTime.toISOString();
    const isCorrelated = Math.random() < 0.6;
    const severity = randomChoice(["low", "medium", "high", "critical"]);
    const resolutionTime = Math.random() < 0.8
      ? new Date(detectionTime.getTime() + randomInt(15, 360) * 60 * 1000).toISOString()
      : undefined;

    items.push({
      PK: `TENANT#${TENANT_ID}#SVC#${service}`,
      SK: `INC#${iso}#${incidentId}`,
      incidentId,
      externalId: `PD-${randomInt(10000, 99999)}`,
      severity,
      detectionTimestamp: iso,
      resolutionTimestamp: resolutionTime,
      correlatedDeployments: isCorrelated ? [randomUUID()] : [],
      correlationStatus: isCorrelated ? "correlated" : "uncorrelated",
      durationMinutes: resolutionTime ? randomInt(15, 360) : undefined,
      GSI1PK: `TENANT#${TENANT_ID}`,
      GSI1SK: `INC#${iso}`,
    });
  }
  return items;
}

function generateMetrics() {
  const items = [];
  const scopes = [
    { type: "ALL", id: "ALL" },
    ...SERVICES.slice(0, 5).map(s => ({ type: "SVC", id: s })),
    ...TEAMS.slice(0, 3).map(t => ({ type: "TEAM", id: t })),
  ];
  const periods = [7, 14, 30, 60, 90];

  for (const scope of scopes) {
    for (const days of periods) {
      const periodStart = daysAgo(days).toISOString();
      const periodEnd = new Date().toISOString();

      items.push({
        PK: `TENANT#${TENANT_ID}#SCOPE#${scope.type}#${scope.id}`,
        SK: `PERIOD#${periodStart}#${periodEnd}`,
        deploymentFrequency: +(1.5 + Math.random() * 2.5).toFixed(1),
        leadTimeHours: +(2 + Math.random() * 8).toFixed(1),
        changeFailureRate: +(5 + Math.random() * 20).toFixed(1),
        mttrHours: +(0.5 + Math.random() * 5).toFixed(1),
        unresolvedCount: randomInt(0, 5),
        dataPoints: randomInt(10, 200),
        computedAt: new Date().toISOString(),
        previousDeploymentFrequency: +(1 + Math.random() * 2).toFixed(1),
        previousLeadTimeHours: +(3 + Math.random() * 10).toFixed(1),
        previousChangeFailureRate: +(8 + Math.random() * 25).toFixed(1),
        previousMttrHours: +(1 + Math.random() * 7).toFixed(1),
      });
    }
  }
  return items;
}

function generateAuditLogs(count = 50) {
  const items = [];
  const actions = [
    "integration.create", "integration.delete", "integration.update",
    "user.login", "user.logout", "user.password_change",
    "settings.update", "team.create", "team.update",
    "service.create", "deployment.blocked", "deployment.approved",
    "risk_weights.update", "correlation_window.update",
    "subscription.upgrade", "api_key.rotate",
  ];

  for (let i = 0; i < count; i++) {
    const auditId = randomUUID();
    const timestamp = randomDateInLastDays(60);
    const iso = timestamp.toISOString();
    const action = randomChoice(actions);
    const actor = randomChoice(AUTHORS);

    items.push({
      PK: `TENANT#${TENANT_ID}`,
      SK: `AUDIT#${iso}#${auditId}`,
      auditId,
      actor,
      action,
      targetResource: `${action.split(".")[0].toUpperCase()}#${randomUUID().slice(0, 8)}`,
      outcome: Math.random() < 0.95 ? "success" : "failure",
      timestamp: iso,
      ipAddress: `192.168.${randomInt(1, 254)}.${randomInt(1, 254)}`,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      metadata: {
        source: randomChoice(["dashboard", "api", "webhook", "system"]),
      },
    });
  }
  return items;
}

function generateAttestations(count = 30) {
  const items = [];
  const predicateTypes = [
    "https://slsa.dev/provenance/v1",
    "https://in-toto.io/attestation/v1",
    "https://ollinai.com/attestation/runtime/v1",
  ];

  for (let i = 0; i < count; i++) {
    const attestationId = randomUUID();
    const service = randomChoice(SERVICES);
    const timestamp = randomDateInLastDays(60);
    const iso = timestamp.toISOString();
    const commitSha = randomUUID().replace(/-/g, "").substring(0, 40);

    items.push({
      PK: `TENANT#${TENANT_ID}#SVC#${service}`,
      SK: `ATTEST#${iso}#${attestationId}`,
      attestationId,
      predicateType: randomChoice(predicateTypes),
      subject: {
        name: `${service}:${randomChoice(["latest", "v1.2.3", "sha-" + commitSha.slice(0, 7)])}`,
        digest: { sha256: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 32) },
      },
      predicate: {
        buildType: "https://github.com/actions/runner",
        builder: { id: `github-actions-${randomInt(1000, 9999)}` },
        invocation: {
          configSource: { uri: `https://github.com/mercadoalex/OllinAI-/blob/main/.github/workflows/ci.yml` },
        },
        materials: [
          { uri: `pkg:npm/@ollinai/${service}`, digest: { sha256: randomUUID().replace(/-/g, "") } },
        ],
      },
      signature: {
        algorithm: "Ed25519",
        keyId: `ollinai-signing-key-${randomInt(1, 5)}`,
        value: Buffer.from(randomUUID() + randomUUID()).toString("base64"),
      },
      verified: Math.random() < 0.9,
      commitSha,
      pipelineId: `run-${randomInt(1000, 9999)}`,
      createdAt: iso,
      GSI1PK: `TENANT#${TENANT_ID}`,
      GSI1SK: `ATTEST#${iso}`,
    });
  }
  return items;
}

function generateMLData(count = 40) {
  const items = [];

  // Feature vectors for training
  for (let i = 0; i < count; i++) {
    const vectorId = randomUUID();
    const service = randomChoice(SERVICES);
    const timestamp = randomDateInLastDays(60);
    const iso = timestamp.toISOString();

    items.push({
      PK: `TENANT#${TENANT_ID}#ML#FEATURES`,
      SK: `VECTOR#${iso}#${vectorId}`,
      vectorId,
      service,
      features: {
        changeSize: randomInt(1, 500),
        filesChanged: randomInt(1, 30),
        authorHistoricalFailureRate: +(Math.random() * 0.3).toFixed(3),
        serviceHistoricalFailureRate: +(Math.random() * 0.25).toFixed(3),
        timeSinceLastDeploy: randomInt(1, 72),
        isWeekend: Math.random() < 0.15,
        isAfterHours: Math.random() < 0.2,
        recentIncidentCount: randomInt(0, 3),
        dependencyChanges: randomInt(0, 10),
        testCoverage: +(60 + Math.random() * 35).toFixed(1),
      },
      label: Math.random() < 0.15 ? "incident" : "safe",
      predictionScore: +(Math.random()).toFixed(4),
      actualOutcome: Math.random() < 0.15 ? "incident" : "safe",
      createdAt: iso,
    });
  }

  // Model metadata
  items.push({
    PK: `TENANT#${TENANT_ID}#ML#MODEL`,
    SK: `VERSION#v1.3.2`,
    modelVersion: "v1.3.2",
    status: "active",
    accuracy: 0.78,
    precision: 0.72,
    recall: 0.81,
    f1Score: 0.76,
    trainedAt: daysAgo(7).toISOString(),
    trainingDataPoints: 1250,
    features: ["changeSize", "filesChanged", "authorFailureRate", "serviceFailureRate", "timeSinceLastDeploy", "isWeekend", "isAfterHours", "recentIncidentCount"],
    hyperparameters: {
      learningRate: 0.001,
      epochs: 50,
      batchSize: 32,
      regularization: "L2",
    },
    driftDetection: {
      lastCheck: daysAgo(1).toISOString(),
      driftScore: 0.04,
      threshold: 0.15,
      status: "stable",
    },
  });

  // Prediction log
  for (let i = 0; i < 20; i++) {
    const predId = randomUUID();
    const timestamp = randomDateInLastDays(14);
    const iso = timestamp.toISOString();
    const score = +(Math.random()).toFixed(4);
    const decision = score > 0.8 ? "blocked" : score > 0.6 ? "warned" : "approved";

    items.push({
      PK: `TENANT#${TENANT_ID}#ML#PREDICTIONS`,
      SK: `PRED#${iso}#${predId}`,
      predictionId: predId,
      deploymentId: randomUUID(),
      service: randomChoice(SERVICES),
      score,
      decision,
      modelVersion: "v1.3.2",
      factors: {
        changeSize: +(Math.random() * 0.3).toFixed(3),
        authorRisk: +(Math.random() * 0.2).toFixed(3),
        timing: +(Math.random() * 0.15).toFixed(3),
        serviceHistory: +(Math.random() * 0.25).toFixed(3),
      },
      actualOutcome: Math.random() < (score * 0.3) ? "incident" : "safe",
      createdAt: iso,
    });
  }

  return items;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding FULL demo data for hackathon...");
  console.log(`   Region: ${REGION}`);
  console.log(`   Tenant: ${TENANT_ID}`);
  console.log("");

  // Generate data
  const events = generateEvents(200);
  const incidents = generateIncidents(25);
  const metrics = generateMetrics();
  const audit = generateAuditLogs(50);
  const attestations = generateAttestations(30);
  const ml = generateMLData(40);

  // Write to DynamoDB
  console.log(`→ Events (${events.length} items)...`);
  await batchWrite(TABLES.EVENTS, events);
  console.log(`  ✅ Done`);

  console.log(`→ Incidents (${incidents.length} items)...`);
  await batchWrite(TABLES.INCIDENTS, incidents);
  console.log(`  ✅ Done`);

  console.log(`→ Metrics (${metrics.length} items)...`);
  await batchWrite(TABLES.METRICS, metrics);
  console.log(`  ✅ Done`);

  console.log(`→ Audit Logs (${audit.length} items)...`);
  await batchWrite(TABLES.AUDIT, audit);
  console.log(`  ✅ Done`);

  console.log(`→ Attestations (${attestations.length} items)...`);
  await batchWrite(TABLES.ATTESTATIONS, attestations);
  console.log(`  ✅ Done`);

  console.log(`→ ML Data (${ml.length} items)...`);
  await batchWrite(TABLES.ML, ml);
  console.log(`  ✅ Done`);

  console.log("");
  console.log("✅ Full demo seed complete!");
  console.log(`   Total items written: ${events.length + incidents.length + metrics.length + audit.length + attestations.length + ml.length}`);
  console.log("");
  console.log("   All tables now have data for hackathon judges.");
}

main().catch(err => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
