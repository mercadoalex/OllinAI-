"use client"

import { useState, useEffect } from "react"
import {
  Settings,
  Users,
  CreditCard,
  Webhook,
  GitBranch,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Zap,
  X,
  GripVertical,
  TrendingUp,
  TrendingDown,
  Minus,
  Circle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

// ============================================================================
// Types
// ============================================================================

type TabId = "teams" | "integrations" | "billing"

interface Integration {
  id: string
  name: string
  type: "github_actions" | "gitlab_ci" | "custom"
  status: "active" | "inactive"
  lastEventAt: string | null
  secretKey: string
  createdAt: string
}

interface Team {
  id: string
  name: string
  description: string
  memberCount: number
  serviceCount: number
  metrics: {
    deploymentFrequency: number
    leadTimeHours: number
    changeFailureRate: number
    mttrHours: number
  }
}

interface Service {
  id: string
  name: string
  teamId: string | null
}

type PlanTier = "starter" | "pro" | "enterprise"

interface BillingPlan {
  tier: PlanTier
  name: string
  price: number
  features: string[]
  limits: {
    services: number
    apiCalls: number
    teams: number
    integrations: number
  }
}

// ============================================================================
// Mock Data Generation (deterministic for hydration safety)
// ============================================================================

function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const INTEGRATION_TYPES = ["github_actions", "gitlab_ci", "custom"] as const
const INTEGRATION_NAMES = [
  "Production Pipeline",
  "Staging Deploy",
  "CI/CD Webhook",
  "Release Automation",
  "Dev Environment",
]

function generateIntegrations(): Integration[] {
  const rand = seededRandom(12345)
  return INTEGRATION_NAMES.map((name, i) => ({
    id: `int-${String(i + 1).padStart(4, "0")}`,
    name,
    type: INTEGRATION_TYPES[Math.floor(rand() * 3)],
    status: rand() > 0.2 ? "active" : "inactive",
    lastEventAt:
      rand() > 0.3
        ? new Date(Date.parse("2026-06-03T00:00:00Z") - Math.floor(rand() * 7 * 24 * 60 * 60 * 1000)).toISOString()
        : null,
    secretKey: `ollin_${Array.from({ length: 32 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]
    ).join("")}`,
    createdAt: new Date(Date.parse("2026-01-01T00:00:00Z") + Math.floor(rand() * 150 * 24 * 60 * 60 * 1000)).toISOString(),
  }))
}

const TEAM_NAMES = ["Platform", "Frontend", "Backend", "Data", "Mobile", "DevOps"]

function generateTeams(): Team[] {
  const rand = seededRandom(54321)
  return TEAM_NAMES.map((name, i) => ({
    id: `team-${String(i + 1).padStart(4, "0")}`,
    name,
    description: `${name} engineering team`,
    memberCount: Math.floor(rand() * 12) + 3,
    serviceCount: Math.floor(rand() * 8) + 1,
    metrics: {
      deploymentFrequency: Math.round((rand() * 10 + 1) * 10) / 10,
      leadTimeHours: Math.round((rand() * 48 + 2) * 10) / 10,
      changeFailureRate: Math.round(rand() * 25 * 10) / 10,
      mttrHours: Math.round((rand() * 8 + 0.5) * 10) / 10,
    },
  }))
}

const SERVICE_NAMES = [
  "user-service",
  "payment-service",
  "notification-service",
  "analytics-service",
  "auth-service",
  "api-gateway",
  "search-service",
  "media-service",
  "recommendation-engine",
  "logging-service",
]

function generateServices(): Service[] {
  const rand = seededRandom(98765)
  const teams = generateTeams()
  return SERVICE_NAMES.map((name, i) => ({
    id: `svc-${String(i + 1).padStart(4, "0")}`,
    name,
    teamId: rand() > 0.2 ? teams[Math.floor(rand() * teams.length)].id : null,
  }))
}

const BILLING_PLANS: BillingPlan[] = [
  {
    tier: "starter",
    name: "Starter",
    price: 0,
    features: [
      "Up to 5 services",
      "10,000 API calls/month",
      "1 team",
      "2 integrations",
      "7-day data retention",
      "Community support",
    ],
    limits: { services: 5, apiCalls: 10000, teams: 1, integrations: 2 },
  },
  {
    tier: "pro",
    name: "Pro",
    price: 99,
    features: [
      "Up to 25 services",
      "100,000 API calls/month",
      "10 teams",
      "Unlimited integrations",
      "30-day data retention",
      "Priority support",
      "Custom dashboards",
      "Slack integration",
    ],
    limits: { services: 25, apiCalls: 100000, teams: 10, integrations: 999 },
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    price: 499,
    features: [
      "Unlimited services",
      "Unlimited API calls",
      "Unlimited teams",
      "Unlimited integrations",
      "90-day data retention",
      "24/7 dedicated support",
      "Custom dashboards",
      "All integrations",
      "SSO/SAML",
      "Audit logs",
      "SLA guarantee",
    ],
    limits: { services: 999, apiCalls: 999999, teams: 999, integrations: 999 },
  },
]

// ============================================================================
// Helper Functions
// ============================================================================

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date("2026-06-03T12:00:00Z")
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function generateSecretKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  const key = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  return `ollin_${key}`
}

// ============================================================================
// Tab Button Component
// ============================================================================

function TabButton({
  id,
  label,
  icon: Icon,
  isActive,
  onClick,
}: {
  id: TabId
  label: string
  icon: React.ElementType
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors",
        isActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

// ============================================================================
// Modal Component
// ============================================================================

function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ============================================================================
// Integrations Tab
// ============================================================================

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [mounted, setMounted] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newIntegration, setNewIntegration] = useState({
    name: "",
    type: "github_actions" as Integration["type"],
  })
  const [generatedKey, setGeneratedKey] = useState("")
  const [copiedKey, setCopiedKey] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, "success" | "failure">>({})
  const [rotatingId, setRotatingId] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
    setIntegrations(generateIntegrations())
  }, [])

  const handleAddIntegration = () => {
    setGeneratedKey(generateSecretKey())
    setShowAddModal(true)
  }

  const handleCreateIntegration = () => {
    if (!newIntegration.name.trim()) return
    const newInt: Integration = {
      id: `int-${String(integrations.length + 1).padStart(4, "0")}`,
      name: newIntegration.name,
      type: newIntegration.type,
      status: "active",
      lastEventAt: null,
      secretKey: generatedKey,
      createdAt: new Date().toISOString(),
    }
    setIntegrations([newInt, ...integrations])
    setShowAddModal(false)
    setNewIntegration({ name: "", type: "github_actions" })
    setGeneratedKey("")
  }

  const handleCopyKey = async (key: string) => {
    await navigator.clipboard.writeText(key)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  const handleTestConnection = async (id: string) => {
    setTestingId(id)
    await new Promise((r) => setTimeout(r, 1500))
    setTestResults((prev) => ({ ...prev, [id]: Math.random() > 0.2 ? "success" : "failure" }))
    setTestingId(null)
  }

  const handleRotateKey = async (id: string) => {
    setRotatingId(id)
    await new Promise((r) => setTimeout(r, 1000))
    setIntegrations((prev) =>
      prev.map((int) => (int.id === id ? { ...int, secretKey: generateSecretKey() } : int))
    )
    setRotatingId(null)
  }

  const handleRevoke = (id: string) => {
    setIntegrations((prev) => prev.filter((int) => int.id !== id))
    setTestResults((prev) => {
      const newResults = { ...prev }
      delete newResults[id]
      return newResults
    })
  }

  const getTypeIcon = (type: Integration["type"]) => {
    switch (type) {
      case "github_actions":
        return Circle
      case "gitlab_ci":
        return GitBranch
      default:
        return Webhook
    }
  }

  const getTypeName = (type: Integration["type"]) => {
    switch (type) {
      case "github_actions":
        return "GitHub Actions"
      case "gitlab_ci":
        return "GitLab CI"
      default:
        return "Custom Webhook"
    }
  }

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Webhook Integrations</h2>
          <p className="text-sm text-gray-500">Connect your CI/CD pipelines to track deployments</p>
        </div>
        <button
          onClick={handleAddIntegration}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Integration
        </button>
      </div>

      <div className="space-y-3">
        {integrations.map((integration) => {
          const TypeIcon = getTypeIcon(integration.type)
          const testResult = testResults[integration.id]

          return (
            <div
              key={integration.id}
              className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                  <TypeIcon className="h-5 w-5 text-gray-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{integration.name}</span>
                    <Badge variant={integration.status === "active" ? "low" : "outline"}>
                      {integration.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span>{getTypeName(integration.type)}</span>
                    <span>·</span>
                    <span>
                      {integration.lastEventAt
                        ? `Last event ${formatRelativeTime(integration.lastEventAt)}`
                        : "No events yet"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTestConnection(integration.id)}
                  disabled={testingId === integration.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                    testResult === "success"
                      ? "bg-emerald-100 text-emerald-700"
                      : testResult === "failure"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  )}
                >
                  {testingId === integration.id ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : testResult === "success" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : testResult === "failure" ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  {testingId === integration.id
                    ? "Testing..."
                    : testResult === "success"
                      ? "Connected"
                      : testResult === "failure"
                        ? "Failed"
                        : "Test"}
                </button>
                <button
                  onClick={() => handleRotateKey(integration.id)}
                  disabled={rotatingId === integration.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", rotatingId === integration.id && "animate-spin")} />
                  Rotate Key
                </button>
                <button
                  onClick={() => handleRevoke(integration.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Integration Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Integration">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={newIntegration.name}
              onChange={(e) => setNewIntegration((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Production Pipeline"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={newIntegration.type}
              onChange={(e) =>
                setNewIntegration((prev) => ({ ...prev, type: e.target.value as Integration["type"] }))
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              <option value="github_actions">GitHub Actions</option>
              <option value="gitlab_ci">GitLab CI</option>
              <option value="custom">Custom Webhook</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Secret Key</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-gray-100 rounded-lg text-sm font-mono text-gray-700 truncate">
                {generatedKey}
              </code>
              <button
                onClick={() => handleCopyKey(generatedKey)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                {copiedKey ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4 text-gray-500" />
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Save this key securely. You won&apos;t be able to see it again.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowAddModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateIntegration}
              disabled={!newIntegration.name.trim()}
              className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create Integration
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ============================================================================
// Teams Tab
// ============================================================================

function TeamsTab() {
  const [teams, setTeams] = useState<Team[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [mounted, setMounted] = useState(false)
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [teamForm, setTeamForm] = useState({ name: "", description: "" })

  useEffect(() => {
    setMounted(true)
    setTeams(generateTeams())
    setServices(generateServices())
  }, [])

  const handleOpenCreateModal = () => {
    setEditingTeam(null)
    setTeamForm({ name: "", description: "" })
    setShowTeamModal(true)
  }

  const handleOpenEditModal = (team: Team) => {
    setEditingTeam(team)
    setTeamForm({ name: team.name, description: team.description })
    setShowTeamModal(true)
  }

  const handleSaveTeam = () => {
    if (!teamForm.name.trim()) return

    if (editingTeam) {
      setTeams((prev) =>
        prev.map((t) =>
          t.id === editingTeam.id ? { ...t, name: teamForm.name, description: teamForm.description } : t
        )
      )
    } else {
      const newTeam: Team = {
        id: `team-${String(teams.length + 1).padStart(4, "0")}`,
        name: teamForm.name,
        description: teamForm.description,
        memberCount: 0,
        serviceCount: 0,
        metrics: {
          deploymentFrequency: 0,
          leadTimeHours: 0,
          changeFailureRate: 0,
          mttrHours: 0,
        },
      }
      setTeams([newTeam, ...teams])
    }
    setShowTeamModal(false)
  }

  const handleAssignService = (serviceId: string, teamId: string | null) => {
    setServices((prev) => prev.map((s) => (s.id === serviceId ? { ...s, teamId } : s)))
    // Update team service counts
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        serviceCount: services.filter((s) => (s.id === serviceId ? teamId === t.id : s.teamId === t.id)).length,
      }))
    )
  }

  const getTrend = (value: number, metric: string) => {
    // Simple heuristic for demo
    if (metric === "changeFailureRate" || metric === "leadTimeHours" || metric === "mttrHours") {
      return value < 10 ? "good" : value < 20 ? "neutral" : "bad"
    }
    return value > 5 ? "good" : value > 2 ? "neutral" : "bad"
  }

  const TrendIcon = ({ trend }: { trend: "good" | "neutral" | "bad" }) => {
    if (trend === "good") return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
    if (trend === "bad") return <TrendingDown className="h-3.5 w-3.5 text-red-600" />
    return <Minus className="h-3.5 w-3.5 text-gray-400" />
  }

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Teams</h2>
          <p className="text-sm text-gray-500">Organize services and track team performance</p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Team
        </button>
      </div>

      {/* Teams Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => (
          <div
            key={team.id}
            className="p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-medium text-gray-900">{team.name}</h3>
                <p className="text-sm text-gray-500">{team.description}</p>
              </div>
              <button
                onClick={() => handleOpenEditModal(team)}
                className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
              >
                <Settings className="h-4 w-4 text-gray-400" />
              </button>
            </div>

            <div className="flex items-center gap-4 mb-4 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600">
                <Users className="h-4 w-4" />
                <span>{team.memberCount} members</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-600">
                <Webhook className="h-4 w-4" />
                <span>{team.serviceCount} services</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Deploy Freq</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-gray-900">
                    {team.metrics.deploymentFrequency}/d
                  </span>
                  <TrendIcon trend={getTrend(team.metrics.deploymentFrequency, "deploymentFrequency")} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Lead Time</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-gray-900">{team.metrics.leadTimeHours}h</span>
                  <TrendIcon trend={getTrend(team.metrics.leadTimeHours, "leadTimeHours")} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">CFR</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-gray-900">{team.metrics.changeFailureRate}%</span>
                  <TrendIcon trend={getTrend(team.metrics.changeFailureRate, "changeFailureRate")} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">MTTR</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-gray-900">{team.metrics.mttrHours}h</span>
                  <TrendIcon trend={getTrend(team.metrics.mttrHours, "mttrHours")} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Service Assignment Section */}
      <div className="pt-6 border-t border-gray-200">
        <h3 className="text-md font-semibold text-gray-900 mb-4">Service Assignment</h3>
        <div className="space-y-2">
          {services.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <GripVertical className="h-4 w-4 text-gray-300" />
                <span className="font-mono text-sm text-gray-700">{service.name}</span>
              </div>
              <select
                value={service.teamId || ""}
                onChange={(e) => handleAssignService(service.id, e.target.value || null)}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <option value="">Unassigned</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Team Modal */}
      <Modal
        isOpen={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        title={editingTeam ? "Edit Team" : "Create Team"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Team Name</label>
            <input
              type="text"
              value={teamForm.name}
              onChange={(e) => setTeamForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Platform"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={teamForm.description}
              onChange={(e) => setTeamForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="e.g., Platform engineering team"
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowTeamModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveTeam}
              disabled={!teamForm.name.trim()}
              className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {editingTeam ? "Save Changes" : "Create Team"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ============================================================================
// Billing Tab
// ============================================================================

function BillingTab() {
  const [currentPlan] = useState<PlanTier>("pro")
  const [mounted, setMounted] = useState(false)

  // Usage data (deterministic)
  const usage = {
    services: 18,
    apiCalls: 67432,
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  const currentPlanData = BILLING_PLANS.find((p) => p.tier === currentPlan)!

  if (!mounted) {
    return (
      <div className="space-y-4">
        <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="p-6 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl text-white">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm text-gray-300">Current Plan</p>
            <h2 className="text-2xl font-bold">{currentPlanData.name}</h2>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">
              ${currentPlanData.price}
              <span className="text-sm font-normal text-gray-300">/mo</span>
            </p>
          </div>
        </div>

        {/* Usage Meters */}
        <div className="grid gap-4 md:grid-cols-2 mt-6">
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-300">Services Used</span>
              <span className="font-medium">
                {usage.services} / {currentPlanData.limits.services === 999 ? "∞" : currentPlanData.limits.services}
              </span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-400 rounded-full transition-all"
                style={{
                  width: `${Math.min((usage.services / currentPlanData.limits.services) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-300">API Calls This Month</span>
              <span className="font-medium">
                {(usage.apiCalls / 1000).toFixed(1)}k /{" "}
                {currentPlanData.limits.apiCalls === 999999
                  ? "∞"
                  : `${(currentPlanData.limits.apiCalls / 1000).toFixed(0)}k`}
              </span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all"
                style={{
                  width: `${Math.min((usage.apiCalls / currentPlanData.limits.apiCalls) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Plan Comparison */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Plans</h3>
        <div className="grid gap-4 md:grid-cols-3">
          {BILLING_PLANS.map((plan) => {
            const isCurrent = plan.tier === currentPlan
            const isUpgrade = BILLING_PLANS.findIndex((p) => p.tier === plan.tier) >
              BILLING_PLANS.findIndex((p) => p.tier === currentPlan)
            const isDowngrade = BILLING_PLANS.findIndex((p) => p.tier === plan.tier) <
              BILLING_PLANS.findIndex((p) => p.tier === currentPlan)

            return (
              <div
                key={plan.tier}
                className={cn(
                  "p-5 rounded-xl border-2 transition-colors",
                  isCurrent ? "border-gray-900 bg-gray-50" : "border-gray-200 bg-white hover:border-gray-300"
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gray-900">{plan.name}</h4>
                  {isCurrent && (
                    <Badge variant="default" className="bg-gray-900 text-white">
                      Current
                    </Badge>
                  )}
                </div>

                <p className="text-2xl font-bold text-gray-900 mb-4">
                  ${plan.price}
                  <span className="text-sm font-normal text-gray-500">/mo</span>
                </p>

                <ul className="space-y-2 mb-6">
                  {plan.features.slice(0, 6).map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      {feature}
                    </li>
                  ))}
                  {plan.features.length > 6 && (
                    <li className="text-sm text-gray-500">+ {plan.features.length - 6} more</li>
                  )}
                </ul>

                {!isCurrent && (
                  <button
                    className={cn(
                      "w-full py-2 px-4 text-sm font-medium rounded-lg transition-colors",
                      isUpgrade
                        ? "bg-gray-900 text-white hover:bg-gray-800"
                        : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                    )}
                  >
                    {isUpgrade ? "Upgrade" : "Downgrade"}
                  </button>
                )}
                {isCurrent && (
                  <button
                    disabled
                    className="w-full py-2 px-4 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed"
                  >
                    Current Plan
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Feature Comparison Table */}
      <div className="pt-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Feature Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-500">Feature</th>
                {BILLING_PLANS.map((plan) => (
                  <th
                    key={plan.tier}
                    className={cn(
                      "text-center py-3 px-4 font-medium",
                      plan.tier === currentPlan ? "text-gray-900 bg-gray-50" : "text-gray-500"
                    )}
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Services", key: "services" },
                { name: "API Calls/mo", key: "apiCalls" },
                { name: "Teams", key: "teams" },
                { name: "Integrations", key: "integrations" },
              ].map((row) => (
                <tr key={row.key} className="border-b border-gray-100">
                  <td className="py-3 px-4 text-gray-700">{row.name}</td>
                  {BILLING_PLANS.map((plan) => {
                    const value = plan.limits[row.key as keyof typeof plan.limits]
                    return (
                      <td
                        key={plan.tier}
                        className={cn(
                          "text-center py-3 px-4",
                          plan.tier === currentPlan ? "bg-gray-50 font-medium text-gray-900" : "text-gray-600"
                        )}
                      >
                        {value >= 999
                          ? "Unlimited"
                          : row.key === "apiCalls"
                            ? `${(value / 1000).toFixed(0)}k`
                            : value}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Settings Page
// ============================================================================

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("integrations")

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: "teams", label: "Teams", icon: Users },
    { id: "integrations", label: "Integrations", icon: Webhook },
    { id: "billing", label: "Billing", icon: CreditCard },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Manage your workspace configuration</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl w-fit mb-8">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              id={tab.id}
              label={tab.label}
              icon={tab.icon}
              isActive={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </div>

        {/* Tab Content */}
        <div className="max-w-5xl">
          {activeTab === "teams" && <TeamsTab />}
          {activeTab === "integrations" && <IntegrationsTab />}
          {activeTab === "billing" && <BillingTab />}
        </div>
      </div>
    </div>
  )
}
