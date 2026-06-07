export type Health = "healthy" | "degraded" | "at-risk"

export type Service = {
  id: string
  name: string
  team: string
  health: Health
  deployFrequency30d: number
  changeFailureRate30d: number // percentage 0-100
  lastDeploymentAt: string // ISO
  lastRiskScore: number // 0-100
  incidents30d: number
}

export const TEAMS = [
  "Platform",
  "Identity",
  "Payments",
  "Growth",
  "Infrastructure",
  "Data",
] as const

export const healthDot: Record<Health, string> = {
  healthy: "bg-green-500",
  degraded: "bg-amber-500",
  "at-risk": "bg-red-500",
}

export const healthLabel: Record<Health, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  "at-risk": "At risk",
}

export function riskBadge(score: number): string {
  if (score >= 75) return "bg-red-50 text-red-700 ring-red-600/20"
  if (score >= 50) return "bg-orange-50 text-orange-700 ring-orange-600/20"
  if (score >= 25) return "bg-amber-50 text-amber-700 ring-amber-600/20"
  return "bg-green-50 text-green-700 ring-green-600/20"
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString()
}

export const SERVICES: Service[] = [
  {
    id: "svc_1",
    name: "api-gateway",
    team: "Platform",
    health: "healthy",
    deployFrequency30d: 42,
    changeFailureRate30d: 4,
    lastDeploymentAt: hoursAgo(3),
    lastRiskScore: 18,
    incidents30d: 0,
  },
  {
    id: "svc_2",
    name: "auth-service",
    team: "Identity",
    health: "degraded",
    deployFrequency30d: 28,
    changeFailureRate30d: 11,
    lastDeploymentAt: hoursAgo(9),
    lastRiskScore: 54,
    incidents30d: 2,
  },
  {
    id: "svc_3",
    name: "billing-service",
    team: "Payments",
    health: "at-risk",
    deployFrequency30d: 16,
    changeFailureRate30d: 23,
    lastDeploymentAt: hoursAgo(21),
    lastRiskScore: 82,
    incidents30d: 4,
  },
  {
    id: "svc_4",
    name: "notification-service",
    team: "Growth",
    health: "healthy",
    deployFrequency30d: 35,
    changeFailureRate30d: 6,
    lastDeploymentAt: hoursAgo(31),
    lastRiskScore: 27,
    incidents30d: 1,
  },
  {
    id: "svc_5",
    name: "search-service",
    team: "Data",
    health: "degraded",
    deployFrequency30d: 22,
    changeFailureRate30d: 14,
    lastDeploymentAt: hoursAgo(54),
    lastRiskScore: 61,
    incidents30d: 2,
  },
  {
    id: "svc_6",
    name: "edge-proxy",
    team: "Infrastructure",
    health: "healthy",
    deployFrequency30d: 48,
    changeFailureRate30d: 3,
    lastDeploymentAt: hoursAgo(1),
    lastRiskScore: 12,
    incidents30d: 0,
  },
]
