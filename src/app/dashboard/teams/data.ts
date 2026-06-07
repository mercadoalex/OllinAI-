export type TeamHealth = "healthy" | "degraded" | "critical"

export interface TeamMember {
  name: string
  email: string
}

export interface Team {
  id: string
  name: string
  members: TeamMember[]
  ownedServices: string[]
  deployFrequencyPerWeek: number
  changeFailureRate: number // 0-100
  mttrHours: number
  health: TeamHealth
}

// Deterministic palette for member initials
const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-indigo-100 text-indigo-700",
  "bg-cyan-100 text-cyan-700",
]

export function avatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const healthStyles: Record<TeamHealth, { dot: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", label: "Healthy" },
  degraded: { dot: "bg-amber-500", label: "Degraded" },
  critical: { dot: "bg-rose-500", label: "Critical" },
}

function member(name: string): TeamMember {
  const email = name.toLowerCase().replace(/\s+/g, ".") + "@ollin.ai"
  return { name, email }
}

export const teams: Team[] = [
  {
    id: "team-platform",
    name: "Platform Engineering",
    members: [
      member("Maya Chen"),
      member("Liam Patel"),
      member("Sofia Rossi"),
      member("Noah Kim"),
      member("Ava Johnson"),
    ],
    ownedServices: ["api-gateway", "edge-proxy", "auth-service"],
    deployFrequencyPerWeek: 18.4,
    changeFailureRate: 4.2,
    mttrHours: 0.8,
    health: "healthy",
  },
  {
    id: "team-backend",
    name: "Backend Team",
    members: [
      member("Diego Morales"),
      member("Priya Nair"),
      member("Tom Becker"),
      member("Elena Popov"),
    ],
    ownedServices: ["billing-service", "search-service", "notification-service", "ledger-service", "webhook-service"],
    deployFrequencyPerWeek: 11.2,
    changeFailureRate: 9.7,
    mttrHours: 2.4,
    health: "degraded",
  },
  {
    id: "team-frontend",
    name: "Frontend Team",
    members: [member("Hana Suzuki"), member("Marcus Lee"), member("Olivia Brown")],
    ownedServices: ["web-app", "design-system"],
    deployFrequencyPerWeek: 14.7,
    changeFailureRate: 6.1,
    mttrHours: 1.5,
    health: "healthy",
  },
  {
    id: "team-devops",
    name: "DevOps",
    members: [member("Ravi Shah"), member("Greta Olsen"), member("Jonas Weber"), member("Mei Tan")],
    ownedServices: ["ci-runner", "observability", "secrets-manager"],
    deployFrequencyPerWeek: 7.9,
    changeFailureRate: 15.3,
    mttrHours: 3.9,
    health: "critical",
  },
]
