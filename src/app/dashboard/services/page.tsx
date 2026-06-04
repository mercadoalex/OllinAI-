"use client"

/**
 * Services Management and Monitoring Page
 * Service registry, ownership, and deployment health
 */

import { useState, useEffect, useMemo } from "react"
import {
  Search,
  Plus,
  LayoutGrid,
  List,
  AlertTriangle,
  Users,
  X,
  ChevronRight,
  Rocket,
  AlertCircle,
  ArrowRight,
  History,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Sparkline, generateSparklineData } from "@/components/sparkline"
import { formatDistanceToNow, formatDate } from "@/lib/date-utils"

// Types
type RiskLevel = "low" | "medium" | "high" | "critical"
type HealthStatus = "healthy" | "degraded" | "at_risk"

interface Service {
  id: string
  name: string
  description: string
  teamId: string
  teamName: string
  healthStatus: HealthStatus
  deployFrequency: number
  changeFailureRate: number
  leadTimeHours: number
  mttrHours: number
  lastDeploymentTimestamp: string
  lastDeploymentRisk: RiskLevel
  incidentCount30d: number
  riskScores: number[]
  recentDeployments: {
    id: string
    timestamp: string
    author: string
    riskScore: number
    environment: string
  }[]
  recentIncidents: {
    id: string
    severity: "low" | "medium" | "high" | "critical"
    detected: string
    duration: string
    correlated: boolean
  }[]
  riskFactorBreakdown: {
    changeFailureRate: number
    changeSize: number
    deploymentTiming: number
    authorFailureRate: number
  }
  gateThresholds: {
    warn: number
    block: number
  }
  ownershipHistory: {
    teamId: string
    teamName: string
    transferredAt: string
    transferredBy: string
  }[]
}

interface Team {
  id: string
  name: string
}

// Seeded random for consistent SSR/client rendering
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = state + 0x6D2B79F5 | 0
    let t = Math.imul(state ^ state >>> 15, 1 | state)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// Generate deterministic mock data
function generateMockServices(): Service[] {
  const serviceNames = [
    "user-service",
    "payment-service",
    "auth-service",
    "notification-service",
    "analytics-service",
    "inventory-service",
    "order-service",
    "shipping-service",
    "catalog-service",
    "search-service",
    "recommendation-service",
    "email-service",
  ]

  const teams: Team[] = [
    { id: "team-1", name: "Platform Team" },
    { id: "team-2", name: "Payments Team" },
    { id: "team-3", name: "Growth Team" },
    { id: "team-4", name: "Infrastructure" },
    { id: "unassigned", name: "UNASSIGNED" },
  ]

  const authors = ["alice", "bob", "charlie", "david", "eve", "frank"]
  const environments = ["Production", "Staging", "Development"]

  return serviceNames.map((name, index) => {
    const rand = seededRandom(index * 1000 + 42)
    
    const teamIndex = index < 10 ? index % 4 : 4 // Last 2 services unassigned
    const team = teams[teamIndex]
    
    const lastRiskScore = rand()
    const lastDeploymentRisk: RiskLevel = 
      lastRiskScore < 0.3 ? "low" :
      lastRiskScore < 0.55 ? "medium" :
      lastRiskScore < 0.75 ? "high" : "critical"
    
    const healthStatus: HealthStatus =
      lastDeploymentRisk === "critical" || lastDeploymentRisk === "high" ? "at_risk" :
      lastDeploymentRisk === "medium" ? "degraded" : "healthy"

    // Generate risk scores for sparkline
    const riskScores = Array.from({ length: 20 }, (_, i) => {
      const r = seededRandom(index * 1000 + i * 100)
      return Math.max(0, Math.min(1, 0.3 + r() * 0.5))
    })

    // Recent deployments
    const recentDeployments = Array.from({ length: 10 }, (_, i) => {
      const r = seededRandom(index * 1000 + i * 50 + 500)
      const daysAgo = i * 2 + Math.floor(r() * 3)
      const riskScore = Math.max(0, Math.min(1, 0.2 + r() * 0.6))
      return {
        id: `deploy-${String(index * 100 + i).padStart(4, "0")}`,
        timestamp: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
        author: authors[Math.floor(r() * authors.length)],
        riskScore,
        environment: environments[Math.floor(r() * environments.length)],
      }
    })

    // Recent incidents
    const incidentCount = Math.floor(rand() * 8)
    const recentIncidents = Array.from({ length: Math.min(5, incidentCount) }, (_, i) => {
      const r = seededRandom(index * 1000 + i * 30 + 800)
      const severities: ("low" | "medium" | "high" | "critical")[] = ["low", "medium", "high", "critical"]
      const daysAgo = i * 5 + Math.floor(r() * 7)
      return {
        id: `INC-${String(index * 100 + i + 1000).padStart(4, "0")}`,
        severity: severities[Math.floor(r() * severities.length)],
        detected: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
        duration: `${Math.floor(r() * 180) + 10}m`,
        correlated: r() > 0.4,
      }
    })

    // Ownership history
    const ownershipHistory = [
      {
        teamId: team.id,
        teamName: team.name,
        transferredAt: new Date(Date.now() - Math.floor(rand() * 180 + 30) * 24 * 60 * 60 * 1000).toISOString(),
        transferredBy: authors[Math.floor(rand() * authors.length)],
      },
    ]
    if (rand() > 0.6) {
      ownershipHistory.push({
        teamId: teams[(teamIndex + 1) % 4].id,
        teamName: teams[(teamIndex + 1) % 4].name,
        transferredAt: new Date(Date.now() - Math.floor(rand() * 365 + 180) * 24 * 60 * 60 * 1000).toISOString(),
        transferredBy: authors[Math.floor(rand() * authors.length)],
      })
    }

    return {
      id: `svc-${String(index + 1).padStart(3, "0")}`,
      name,
      description: `Handles ${name.replace("-service", "").replace("-", " ")} operations`,
      teamId: team.id,
      teamName: team.name,
      healthStatus,
      deployFrequency: Math.round((rand() * 15 + 1) * 10) / 10,
      changeFailureRate: Math.round(rand() * 25 * 10) / 10,
      leadTimeHours: Math.round((rand() * 48 + 2) * 10) / 10,
      mttrHours: Math.round((rand() * 8 + 0.5) * 10) / 10,
      lastDeploymentTimestamp: new Date(Date.now() - Math.floor(rand() * 72) * 60 * 60 * 1000).toISOString(),
      lastDeploymentRisk,
      incidentCount30d: incidentCount,
      riskScores,
      recentDeployments,
      recentIncidents,
      riskFactorBreakdown: {
        changeFailureRate: Math.round(rand() * 40),
        changeSize: Math.round(rand() * 30),
        deploymentTiming: Math.round(rand() * 20),
        authorFailureRate: Math.round(rand() * 25),
      },
      gateThresholds: {
        warn: 0.5,
        block: 0.8,
      },
      ownershipHistory,
    }
  })
}

const TEAMS: Team[] = [
  { id: "team-1", name: "Platform Team" },
  { id: "team-2", name: "Payments Team" },
  { id: "team-3", name: "Growth Team" },
  { id: "team-4", name: "Infrastructure" },
]

const RISK_COLORS: Record<RiskLevel, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
}

const HEALTH_DOT_COLORS: Record<HealthStatus, string> = {
  healthy: "bg-green-500",
  degraded: "bg-amber-500",
  at_risk: "bg-red-500",
}

const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  at_risk: "At Risk",
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
}

export default function ServicesPage() {
  const [mounted, setMounted] = useState(false)
  const [services, setServices] = useState<Service[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid")
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false)
  const [newServiceName, setNewServiceName] = useState("")
  const [newServiceTeam, setNewServiceTeam] = useState("")
  const [newServiceDescription, setNewServiceDescription] = useState("")
  const [nameError, setNameError] = useState("")

  useEffect(() => {
    setMounted(true)
    setServices(generateMockServices())
  }, [])

  const filteredServices = useMemo(() => {
    if (!searchQuery.trim()) return services
    const query = searchQuery.toLowerCase()
    return services.filter(s => 
      s.name.toLowerCase().includes(query) ||
      s.teamName.toLowerCase().includes(query)
    )
  }, [services, searchQuery])

  const stats = useMemo(() => {
    const total = services.length
    const atRisk = services.filter(s => 
      s.lastDeploymentRisk === "high" || s.lastDeploymentRisk === "critical"
    ).length
    const unassigned = services.filter(s => s.teamName === "UNASSIGNED").length
    return { total, atRisk, unassigned }
  }, [services])

  const handleRegisterService = () => {
    if (!newServiceName.trim()) {
      setNameError("Service name is required")
      return
    }
    if (newServiceName.length > 150) {
      setNameError("Service name must be 150 characters or less")
      return
    }
    if (services.some(s => s.name.toLowerCase() === newServiceName.toLowerCase())) {
      setNameError("A service with this name already exists")
      return
    }
    if (!newServiceTeam) {
      setNameError("Owning team is required")
      return
    }

    const team = TEAMS.find(t => t.id === newServiceTeam)
    const newService: Service = {
      id: `svc-${String(services.length + 1).padStart(3, "0")}`,
      name: newServiceName.trim(),
      description: newServiceDescription.trim() || `Handles ${newServiceName.replace("-service", "").replace("-", " ")} operations`,
      teamId: newServiceTeam,
      teamName: team?.name || "Unknown",
      healthStatus: "healthy",
      deployFrequency: 0,
      changeFailureRate: 0,
      leadTimeHours: 0,
      mttrHours: 0,
      lastDeploymentTimestamp: new Date().toISOString(),
      lastDeploymentRisk: "low",
      incidentCount30d: 0,
      riskScores: [],
      recentDeployments: [],
      recentIncidents: [],
      riskFactorBreakdown: {
        changeFailureRate: 0,
        changeSize: 0,
        deploymentTiming: 0,
        authorFailureRate: 0,
      },
      gateThresholds: { warn: 0.5, block: 0.8 },
      ownershipHistory: [{
        teamId: newServiceTeam,
        teamName: team?.name || "Unknown",
        transferredAt: new Date().toISOString(),
        transferredBy: "system",
      }],
    }

    setServices(prev => [...prev, newService])
    setIsRegisterModalOpen(false)
    setNewServiceName("")
    setNewServiceTeam("")
    setNewServiceDescription("")
    setNameError("")
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 pl-64">
        <div className="p-8">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  // Empty state
  if (services.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 pl-64">
        <div className="p-8">
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Rocket className="h-8 w-8 text-gray-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No services registered yet</h2>
            <p className="text-gray-500 max-w-md mb-6">
              Services are auto-created when deployment webhooks arrive, or you can register them manually.
            </p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsRegisterModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Register Service
              </button>
              <a 
                href="/dashboard/settings" 
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
              >
                View integration docs
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pl-64">
      <div className="p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Services</h1>
            <p className="text-sm text-gray-500 mt-1">
              Service registry, ownership, and deployment health
            </p>
          </div>
          <button
            onClick={() => setIsRegisterModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Register Service
          </button>
        </div>

        {/* Search and View Toggle */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search services..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center rounded-lg border border-gray-200 bg-white p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-2 rounded-md transition-colors",
                viewMode === "grid" 
                  ? "bg-gray-100 text-gray-900" 
                  : "text-gray-500 hover:text-gray-700"
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "p-2 rounded-md transition-colors",
                viewMode === "table" 
                  ? "bg-gray-100 text-gray-900" 
                  : "text-gray-500 hover:text-gray-700"
              )}
              aria-label="Table view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-medium text-gray-500">Total Services</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <p className="text-sm font-medium text-red-700">Services at Risk</p>
            </div>
            <p className="text-3xl font-bold text-red-700 mt-1">{stats.atRisk}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-medium text-amber-700">Unassigned Services</p>
            </div>
            <p className="text-3xl font-bold text-amber-700 mt-1">{stats.unassigned}</p>
          </div>
        </div>

        {/* Main Content */}
        {viewMode === "grid" ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredServices.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                onClick={() => setSelectedService(service)}
              />
            ))}
          </div>
        ) : (
          <ServicesTable
            services={filteredServices}
            onSelectService={setSelectedService}
          />
        )}

        {filteredServices.length === 0 && services.length > 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No services match your search.</p>
          </div>
        )}
      </div>

      {/* Service Detail Drawer */}
      {selectedService && (
        <ServiceDrawer
          service={selectedService}
          onClose={() => setSelectedService(null)}
          onUpdateThresholds={(warn, block) => {
            setServices(prev => prev.map(s => 
              s.id === selectedService.id 
                ? { ...s, gateThresholds: { warn, block } }
                : s
            ))
            setSelectedService(prev => prev ? { ...prev, gateThresholds: { warn, block } } : null)
          }}
        />
      )}

      {/* Register Service Modal */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/50" 
            onClick={() => setIsRegisterModalOpen(false)} 
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Register Service</h2>
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Service Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newServiceName}
                  onChange={(e) => {
                    setNewServiceName(e.target.value)
                    setNameError("")
                  }}
                  placeholder="e.g., user-service"
                  maxLength={150}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500",
                    nameError ? "border-red-300" : "border-gray-200"
                  )}
                />
                {nameError && (
                  <p className="text-xs text-red-600 mt-1">{nameError}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {newServiceName.length}/150 characters
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Owning Team <span className="text-red-500">*</span>
                </label>
                <select
                  value={newServiceTeam}
                  onChange={(e) => setNewServiceTeam(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a team...</option>
                  {TEAMS.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={newServiceDescription}
                  onChange={(e) => setNewServiceDescription(e.target.value)}
                  placeholder="What does this service do?"
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRegisterService}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Service Card Component
function ServiceCard({ 
  service, 
  onClick 
}: { 
  service: Service
  onClick: () => void 
}) {
  const riskColor = 
    service.lastDeploymentRisk === "low" ? "#22c55e" :
    service.lastDeploymentRisk === "medium" ? "#f59e0b" :
    service.lastDeploymentRisk === "high" ? "#f97316" : "#ef4444"

  return (
    <div 
      className="rounded-xl border border-gray-200 bg-white p-5 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn("h-2.5 w-2.5 rounded-full", HEALTH_DOT_COLORS[service.healthStatus])} />
          <h3 className="font-semibold text-gray-900">{service.name}</h3>
        </div>
        <span className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          RISK_COLORS[service.lastDeploymentRisk]
        )}>
          {service.lastDeploymentRisk}
        </span>
      </div>

      {/* Team */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-4">
        <Users className="h-3.5 w-3.5" />
        <span className={service.teamName === "UNASSIGNED" ? "text-amber-600 font-medium" : ""}>
          {service.teamName}
        </span>
      </div>

      {/* Mini DORA Metrics */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-gray-400">Deploy Freq (30d)</p>
          <p className="text-sm font-medium text-gray-900">{service.deployFrequency}/day</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Change Failure</p>
          <p className="text-sm font-medium text-gray-900">{service.changeFailureRate}%</p>
        </div>
      </div>

      {/* Last Deployment & Incidents */}
      <div className="flex items-center justify-between text-sm mb-4">
        <span className="text-gray-500">
          Last deploy: {formatDistanceToNow(new Date(service.lastDeploymentTimestamp))}
        </span>
        <span className="text-gray-500">
          {service.incidentCount30d} incident{service.incidentCount30d !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Risk Sparkline */}
      <div className="flex items-center justify-between">
        <Sparkline 
          data={service.riskScores} 
          color={riskColor}
          width={140}
          height={24}
        />
        <button className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
          View Details
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// Services Table Component
function ServicesTable({ 
  services, 
  onSelectService 
}: { 
  services: Service[]
  onSelectService: (service: Service) => void 
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Service</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Team</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Deploy Freq</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">CFR</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Last Deploy</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Last Risk</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Incidents</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {services.map((service) => (
            <tr 
              key={service.id}
              className="hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onSelectService(service)}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className={cn("h-2 w-2 rounded-full", HEALTH_DOT_COLORS[service.healthStatus])} />
                  <span className="font-medium text-gray-900">{service.name}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={cn(
                  "text-sm",
                  service.teamName === "UNASSIGNED" ? "text-amber-600 font-medium" : "text-gray-600"
                )}>
                  {service.teamName}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">{service.deployFrequency}/day</td>
              <td className="px-4 py-3 text-sm text-gray-600">{service.changeFailureRate}%</td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {formatDistanceToNow(new Date(service.lastDeploymentTimestamp))}
              </td>
              <td className="px-4 py-3">
                <span className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  RISK_COLORS[service.lastDeploymentRisk]
                )}>
                  {service.lastDeploymentRisk}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">{service.incidentCount30d}</td>
              <td className="px-4 py-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium",
                  service.healthStatus === "healthy" ? "text-green-700" :
                  service.healthStatus === "degraded" ? "text-amber-700" : "text-red-700"
                )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT_COLORS[service.healthStatus])} />
                  {HEALTH_LABELS[service.healthStatus]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Service Detail Drawer Component
function ServiceDrawer({ 
  service, 
  onClose,
  onUpdateThresholds 
}: { 
  service: Service
  onClose: () => void
  onUpdateThresholds: (warn: number, block: number) => void
}) {
  const [warnThreshold, setWarnThreshold] = useState(service.gateThresholds.warn)
  const [blockThreshold, setBlockThreshold] = useState(service.gateThresholds.block)
  const [showTransferModal, setShowTransferModal] = useState(false)

  const totalRiskFactors = 
    service.riskFactorBreakdown.changeFailureRate +
    service.riskFactorBreakdown.changeSize +
    service.riskFactorBreakdown.deploymentTiming +
    service.riskFactorBreakdown.authorFailureRate

  const handleThresholdSave = () => {
    onUpdateThresholds(warnThreshold, blockThreshold)
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className={cn("h-3 w-3 rounded-full", HEALTH_DOT_COLORS[service.healthStatus])} />
              <h2 className="text-xl font-semibold text-gray-900">{service.name}</h2>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{service.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Team & Transfer */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-400" />
              <span className={cn(
                "font-medium",
                service.teamName === "UNASSIGNED" ? "text-amber-600" : "text-gray-900"
              )}>
                {service.teamName}
              </span>
            </div>
            <button
              onClick={() => setShowTransferModal(true)}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Transfer Ownership
            </button>
          </div>

          {/* Ownership History */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-gray-400" />
              Ownership History
            </h3>
            <div className="space-y-3">
              {service.ownershipHistory.map((entry, index) => (
                <div key={index} className="flex items-center gap-3 text-sm">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <div>
                    <span className="font-medium text-gray-900">{entry.teamName}</span>
                    <span className="text-gray-500"> — transferred by {entry.transferredBy}</span>
                    <span className="text-gray-400 ml-2">
                      {formatDate(new Date(entry.transferredAt))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DORA Metrics */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">DORA Metrics (30 days)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500">Deploy Frequency</p>
                <p className="text-2xl font-bold text-gray-900">{service.deployFrequency}</p>
                <p className="text-xs text-gray-400">per day</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500">Lead Time</p>
                <p className="text-2xl font-bold text-gray-900">{service.leadTimeHours}</p>
                <p className="text-xs text-gray-400">hours</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500">Change Failure Rate</p>
                <p className="text-2xl font-bold text-gray-900">{service.changeFailureRate}%</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500">MTTR</p>
                <p className="text-2xl font-bold text-gray-900">{service.mttrHours}</p>
                <p className="text-xs text-gray-400">hours</p>
              </div>
            </div>
          </div>

          {/* Recent Deployments */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
              <Rocket className="h-4 w-4 text-gray-400" />
              Recent Deployments
            </h3>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Timestamp</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Author</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Risk</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Env</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {service.recentDeployments.slice(0, 10).map((deploy) => {
                    const riskLevel: RiskLevel = 
                      deploy.riskScore < 0.3 ? "low" :
                      deploy.riskScore < 0.55 ? "medium" :
                      deploy.riskScore < 0.75 ? "high" : "critical"
                    return (
                      <tr key={deploy.id}>
                        <td className="px-3 py-2 text-gray-600">
                          {formatDistanceToNow(new Date(deploy.timestamp))}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{deploy.author}</td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            RISK_COLORS[riskLevel]
                          )}>
                            {(deploy.riskScore * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{deploy.environment}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Incidents */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-gray-400" />
              Recent Incidents
            </h3>
            {service.recentIncidents.length === 0 ? (
              <p className="text-sm text-gray-500">No incidents in the last 30 days.</p>
            ) : (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Severity</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Detected</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Duration</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Correlated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {service.recentIncidents.map((incident) => (
                      <tr key={incident.id}>
                        <td className="px-3 py-2">
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            SEVERITY_COLORS[incident.severity]
                          )}>
                            {incident.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {formatDistanceToNow(new Date(incident.detected))}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{incident.duration}</td>
                        <td className="px-3 py-2">
                          {incident.correlated ? (
                            <span className="text-blue-600 text-xs font-medium">Yes</span>
                          ) : (
                            <span className="text-gray-400 text-xs">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Risk Factor Breakdown */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              Risk Factor Breakdown (avg. last 10 deploys)
            </h3>
            <div className="space-y-3">
              <div className="h-6 rounded-full overflow-hidden flex bg-gray-100">
                <div 
                  className="bg-blue-500 h-full" 
                  style={{ width: `${totalRiskFactors > 0 ? (service.riskFactorBreakdown.changeFailureRate / totalRiskFactors) * 100 : 25}%` }}
                  title={`Change Failure Rate: ${service.riskFactorBreakdown.changeFailureRate}%`}
                />
                <div 
                  className="bg-purple-500 h-full" 
                  style={{ width: `${totalRiskFactors > 0 ? (service.riskFactorBreakdown.changeSize / totalRiskFactors) * 100 : 25}%` }}
                  title={`Change Size: ${service.riskFactorBreakdown.changeSize}%`}
                />
                <div 
                  className="bg-amber-500 h-full" 
                  style={{ width: `${totalRiskFactors > 0 ? (service.riskFactorBreakdown.deploymentTiming / totalRiskFactors) * 100 : 25}%` }}
                  title={`Deployment Timing: ${service.riskFactorBreakdown.deploymentTiming}%`}
                />
                <div 
                  className="bg-red-500 h-full" 
                  style={{ width: `${totalRiskFactors > 0 ? (service.riskFactorBreakdown.authorFailureRate / totalRiskFactors) * 100 : 25}%` }}
                  title={`Author Failure Rate: ${service.riskFactorBreakdown.authorFailureRate}%`}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
                  <span className="text-gray-600">Change Failure Rate ({service.riskFactorBreakdown.changeFailureRate}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-purple-500" />
                  <span className="text-gray-600">Change Size ({service.riskFactorBreakdown.changeSize}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                  <span className="text-gray-600">Deployment Timing ({service.riskFactorBreakdown.deploymentTiming}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                  <span className="text-gray-600">Author Failure Rate ({service.riskFactorBreakdown.authorFailureRate}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Custom Gate Thresholds */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Custom Gate Thresholds</h3>
            <div className="space-y-4 p-4 rounded-lg border border-gray-200 bg-gray-50">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-700">Warn Threshold</label>
                  <span className="text-sm font-medium text-amber-600">{warnThreshold.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={warnThreshold}
                  onChange={(e) => setWarnThreshold(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-700">Block Threshold</label>
                  <span className="text-sm font-medium text-red-600">{blockThreshold.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={blockThreshold}
                  onChange={(e) => setBlockThreshold(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                />
              </div>
              <button
                onClick={handleThresholdSave}
                className="w-full mt-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Save Thresholds
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transfer Ownership Modal */}
      {showTransferModal && (
        <TransferOwnershipModal
          service={service}
          onClose={() => setShowTransferModal(false)}
        />
      )}
    </>
  )
}

// Transfer Ownership Modal
function TransferOwnershipModal({ 
  service, 
  onClose 
}: { 
  service: Service
  onClose: () => void 
}) {
  const [selectedTeam, setSelectedTeam] = useState("")

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Transfer Ownership</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Transfer <span className="font-medium">{service.name}</span> to a new team.
        </p>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            New Owning Team
          </label>
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a team...</option>
            {TEAMS.filter(t => t.id !== service.teamId).map(team => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            disabled={!selectedTeam}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Transfer
          </button>
        </div>
      </div>
    </div>
  )
}
