import { relativeTime, fullTime } from "../deployments/utils"

export type GateDecision = "proceed" | "warn" | "block"
export type WarningLevel = "block" | "warn"
export type AnomalyType = "latency" | "error_rate" | "traffic" | "resource" | "deploy_frequency"

export type EarlyWarning = {
  id: string
  service: string
  predictionScore: number
  reason: string
  level: WarningLevel
}

export type GateRow = {
  id: string
  deploymentId: string
  service: string
  predictionScore: number
  riskScore: number
  combinedScore: number
  decision: GateDecision
  factors: string[]
}

export type Anomaly = {
  id: string
  type: AnomalyType
  description: string
  deviation: string
  service: string
  timestamp: string
}

export const modelStatus = {
  active: true,
  version: "v1.3.2",
}

export const summary = {
  accuracy: 0.913,
  accuracyTrend: 2.4,
  activeWarnings: 3,
  anomalies24h: 7,
  driftScore: 0.41,
}

export const earlyWarnings: EarlyWarning[] = [
  {
    id: "w1",
    service: "billing-service",
    predictionScore: 0.87,
    reason: "Elevated error-rate trend combined with a large schema migration in the pending deploy.",
    level: "block",
  },
  {
    id: "w2",
    service: "auth-service",
    predictionScore: 0.72,
    reason: "Deploy frequency spike detected; 4 deploys in the last 2 hours from the same author.",
    level: "warn",
  },
  {
    id: "w3",
    service: "search-service",
    predictionScore: 0.69,
    reason: "p99 latency drifting upward over the last 6 hours ahead of a planned release.",
    level: "warn",
  },
]

export const gateRows: GateRow[] = [
  {
    id: "g1",
    deploymentId: "dpl_9f2a7c41e8b3",
    service: "billing-service",
    predictionScore: 0.88,
    riskScore: 0.81,
    combinedScore: 0.85,
    decision: "block",
    factors: ["schema migration", "error-rate trend", "peak traffic window"],
  },
  {
    id: "g2",
    deploymentId: "dpl_3b8e1d05f7aa",
    service: "auth-service",
    predictionScore: 0.61,
    riskScore: 0.58,
    combinedScore: 0.59,
    decision: "warn",
    factors: ["deploy frequency", "off-hours"],
  },
  {
    id: "g3",
    deploymentId: "dpl_c47d92ba16ef",
    service: "api-gateway",
    predictionScore: 0.22,
    riskScore: 0.18,
    combinedScore: 0.2,
    decision: "proceed",
    factors: ["small diff", "high test coverage"],
  },
  {
    id: "g4",
    deploymentId: "dpl_5a0f63ce29d1",
    service: "notification-service",
    predictionScore: 0.34,
    riskScore: 0.29,
    combinedScore: 0.31,
    decision: "proceed",
    factors: ["config-only change"],
  },
  {
    id: "g5",
    deploymentId: "dpl_72be84af0c95",
    service: "search-service",
    predictionScore: 0.66,
    riskScore: 0.71,
    combinedScore: 0.69,
    decision: "warn",
    factors: ["latency drift", "index rebuild"],
  },
  {
    id: "g6",
    deploymentId: "dpl_18d4f9b2e7c0",
    service: "edge-proxy",
    predictionScore: 0.79,
    riskScore: 0.83,
    combinedScore: 0.81,
    decision: "block",
    factors: ["global blast radius", "no canary", "peak traffic window"],
  },
]

export const anomalies: Anomaly[] = [
  {
    id: "a1",
    type: "error_rate",
    description: "Error rate on billing-service exceeded baseline after checkout deploy.",
    deviation: "4.2σ",
    service: "billing-service",
    timestamp: "2026-06-07T13:42:00Z",
  },
  {
    id: "a2",
    type: "latency",
    description: "p99 latency on search-service climbing steadily over baseline.",
    deviation: "3.1σ",
    service: "search-service",
    timestamp: "2026-06-07T12:05:00Z",
  },
  {
    id: "a3",
    type: "traffic",
    description: "Unexpected traffic surge to api-gateway from a single region.",
    deviation: "2.8σ",
    service: "api-gateway",
    timestamp: "2026-06-07T10:18:00Z",
  },
  {
    id: "a4",
    type: "resource",
    description: "Memory utilization on auth-service approaching saturation.",
    deviation: "3.6σ",
    service: "auth-service",
    timestamp: "2026-06-07T08:51:00Z",
  },
  {
    id: "a5",
    type: "deploy_frequency",
    description: "Deploy frequency for notification-service well above weekly norm.",
    deviation: "2.5σ",
    service: "notification-service",
    timestamp: "2026-06-07T07:33:00Z",
  },
]

export const decisionStyles: Record<GateDecision, { label: string; badge: string; bar: string }> = {
  proceed: { label: "Proceed", badge: "bg-green-100 text-green-700", bar: "bg-green-500" },
  warn: { label: "Warn", badge: "bg-amber-100 text-amber-700", bar: "bg-amber-500" },
  block: { label: "Block", badge: "bg-red-100 text-red-700", bar: "bg-red-500" },
}

export function scoreColor(score: number): string {
  if (score >= 0.7) return "bg-red-500"
  if (score >= 0.4) return "bg-amber-500"
  return "bg-green-500"
}

export { relativeTime, fullTime }
