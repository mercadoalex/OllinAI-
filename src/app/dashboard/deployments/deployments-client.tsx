"use client"

/**
 * Deployments Detail Page Client Component
 * 
 * Features:
 * - Color-coded timeline visualization
 * - Expandable deployment cards with detailed info
 * - Filters for service, team, environment, risk level
 * - Pagination
 */

import { useState, useEffect, useCallback, useMemo } from "react"
import { 
  ChevronDown, 
  ChevronRight, 
  GitCommit, 
  User, 
  Server, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  AlertOctagon,
  Clock,
  Gauge,
  Brain,
  Shield,
  Lightbulb,
  ChevronLeft
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatDistanceToNow, formatDate } from "@/lib/date-utils"

// Types
export interface DeploymentDetail {
  id: string
  timestamp: string
  author: string
  environment: "production" | "staging" | "development"
  team: string
  commitShas: string[]
  servicesAffected: string[]
  riskScore: "low" | "medium" | "high" | "critical"
  riskBreakdown: {
    changeFailureRate: number
    changeSize: number
    deploymentTiming: number
    authorFailureRate: number
  }
  mlPrediction: {
    score: number
    confidence: number
  }
  gateDecision: "proceed" | "warn" | "block"
  correlatedIncidents: Array<{
    id: string
    title: string
    severity: "low" | "medium" | "high" | "critical"
  }>
  recommendations: string[]
}

interface Filters {
  service: string
  team: string
  environment: string
  riskLevels: Set<string>
}

// Risk color configuration
const RISK_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
}

const RISK_BG_COLORS: Record<string, string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-red-500",
}

const GATE_CONFIG = {
  proceed: { label: "Proceed", icon: CheckCircle, className: "bg-emerald-100 text-emerald-700" },
  warn: { label: "Warning", icon: AlertTriangle, className: "bg-amber-100 text-amber-700" },
  block: { label: "Blocked", icon: XCircle, className: "bg-red-100 text-red-700" },
}

const ENV_CONFIG = {
  production: { label: "Production", className: "bg-blue-100 text-blue-700" },
  staging: { label: "Staging", className: "bg-purple-100 text-purple-700" },
  development: { label: "Development", className: "bg-gray-100 text-gray-700" },
}

// Demo data generator with seeded randomness for hydration safety
function generateDemoDeployments(count: number, seed: number = 42): DeploymentDetail[] {
  const services = ["api-gateway", "auth-service", "payment-service", "user-service", "notification-service", "analytics-service"]
  const teams = ["Platform", "Payments", "Growth", "Infrastructure", "Mobile"]
  const authors = ["alice", "bob", "charlie", "david", "emma", "frank"]
  const environments: ("production" | "staging" | "development")[] = ["production", "staging", "development"]
  const riskScores: ("low" | "medium" | "high" | "critical")[] = ["low", "medium", "high", "critical"]
  const gateDecisions: ("proceed" | "warn" | "block")[] = ["proceed", "warn", "block"]
  
  // Seeded random number generator
  let state = seed
  const seededRandom = () => {
    state |= 0
    state = state + 0x6D2B79F5 | 0
    let t = Math.imul(state ^ state >>> 15, 1 | state)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  
  const deployments: DeploymentDetail[] = []
  const baseTime = new Date("2026-06-03T12:00:00.000Z").getTime()
  
  for (let i = 0; i < count; i++) {
    const riskScore = riskScores[Math.floor(seededRandom() * 4)]
    const hoursAgo = Math.floor(seededRandom() * 336) // Up to 14 days
    const numServices = Math.floor(seededRandom() * 3) + 1
    const numCommits = Math.floor(seededRandom() * 5) + 1
    const hasIncidents = seededRandom() > 0.7
    const numIncidents = hasIncidents ? Math.floor(seededRandom() * 3) + 1 : 0
    
    // Generate risk breakdown that adds up roughly
    const cfr = Math.floor(seededRandom() * 40)
    const cs = Math.floor(seededRandom() * 30)
    const dt = Math.floor(seededRandom() * 20)
    const afr = Math.floor(seededRandom() * 25)
    
    // Determine gate decision based on risk
    let gateDecision: "proceed" | "warn" | "block" = "proceed"
    if (riskScore === "critical") {
      gateDecision = seededRandom() > 0.3 ? "block" : "warn"
    } else if (riskScore === "high") {
      gateDecision = seededRandom() > 0.5 ? "warn" : "proceed"
    } else if (riskScore === "medium") {
      gateDecision = seededRandom() > 0.8 ? "warn" : "proceed"
    }
    
    const selectedServices: string[] = []
    for (let j = 0; j < numServices; j++) {
      const svc = services[Math.floor(seededRandom() * services.length)]
      if (!selectedServices.includes(svc)) selectedServices.push(svc)
    }
    
    const commits: string[] = []
    for (let j = 0; j < numCommits; j++) {
      commits.push(Math.floor(seededRandom() * 0xffffff).toString(16).padStart(7, '0'))
    }
    
    const incidents: DeploymentDetail["correlatedIncidents"] = []
    for (let j = 0; j < numIncidents; j++) {
      incidents.push({
        id: `INC-${1000 + Math.floor(seededRandom() * 9000)}`,
        title: ["Database connection timeout", "API latency spike", "Memory leak detected", "Service unavailable"][Math.floor(seededRandom() * 4)],
        severity: riskScores[Math.floor(seededRandom() * 4)],
      })
    }
    
    const recommendations: string[] = []
    if (riskScore === "high" || riskScore === "critical") {
      recommendations.push("Consider adding more comprehensive test coverage before deploying")
      if (seededRandom() > 0.5) recommendations.push("Review recent similar deployments that caused incidents")
      if (seededRandom() > 0.7) recommendations.push("Schedule deployment during lower-traffic hours")
    }
    
    deployments.push({
      id: `deploy-${i.toString().padStart(4, '0')}`,
      timestamp: new Date(baseTime - hoursAgo * 60 * 60 * 1000).toISOString(),
      author: authors[Math.floor(seededRandom() * authors.length)],
      environment: environments[Math.floor(seededRandom() * environments.length)],
      team: teams[Math.floor(seededRandom() * teams.length)],
      commitShas: commits,
      servicesAffected: selectedServices,
      riskScore,
      riskBreakdown: {
        changeFailureRate: cfr,
        changeSize: cs,
        deploymentTiming: dt,
        authorFailureRate: afr,
      },
      mlPrediction: {
        score: Math.round((seededRandom() * 0.6 + (riskScore === "critical" ? 0.3 : riskScore === "high" ? 0.2 : 0.1)) * 100) / 100,
        confidence: Math.round((0.7 + seededRandom() * 0.25) * 100) / 100,
      },
      gateDecision,
      correlatedIncidents: incidents,
      recommendations,
    })
  }
  
  return deployments.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

// Timeline Dot Component
function TimelineDot({ 
  deployment, 
  isSelected, 
  onClick 
}: { 
  deployment: DeploymentDetail
  isSelected: boolean
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative h-4 w-4 rounded-full transition-all duration-200",
        "hover:scale-125 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400",
        isSelected && "ring-2 ring-offset-2 ring-gray-900 scale-125"
      )}
      style={{ backgroundColor: RISK_COLORS[deployment.riskScore] }}
      title={`${deployment.id} - ${deployment.riskScore} risk`}
    >
      {deployment.correlatedIncidents.length > 0 && (
        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-600 animate-pulse" />
      )}
    </button>
  )
}

// Risk Breakdown Bar Component
function RiskBreakdownBar({ breakdown }: { breakdown: DeploymentDetail["riskBreakdown"] }) {
  const total = breakdown.changeFailureRate + breakdown.changeSize + breakdown.deploymentTiming + breakdown.authorFailureRate
  const normalizedTotal = total || 1
  
  const factors = [
    { label: "Change Failure Rate", value: breakdown.changeFailureRate, color: "bg-blue-500" },
    { label: "Change Size", value: breakdown.changeSize, color: "bg-purple-500" },
    { label: "Deployment Timing", value: breakdown.deploymentTiming, color: "bg-amber-500" },
    { label: "Author Failure Rate", value: breakdown.authorFailureRate, color: "bg-rose-500" },
  ]
  
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {factors.map((factor, i) => (
          <div
            key={factor.label}
            className={cn(factor.color, "transition-all duration-300")}
            style={{ width: `${(factor.value / normalizedTotal) * 100}%` }}
            title={`${factor.label}: ${factor.value}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {factors.map((factor) => (
          <div key={factor.label} className="flex items-center gap-1.5">
            <div className={cn("h-2.5 w-2.5 rounded-sm", factor.color)} />
            <span className="text-gray-600">{factor.label}</span>
            <span className="font-medium text-gray-900">{factor.value}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Expanded Deployment Card Component
function DeploymentCard({ 
  deployment, 
  isExpanded, 
  onToggle,
  mounted
}: { 
  deployment: DeploymentDetail
  isExpanded: boolean
  onToggle: () => void
  mounted: boolean
}) {
  const GateIcon = GATE_CONFIG[deployment.gateDecision].icon
  
  return (
    <Card className={cn(
      "transition-all duration-200 border-l-4",
      isExpanded && "shadow-md"
    )} style={{ borderLeftColor: RISK_COLORS[deployment.riskScore] }}>
      {/* Header - Always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left"
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">{deployment.id}</span>
                  <Badge variant={deployment.riskScore}>
                    {deployment.riskScore.charAt(0).toUpperCase() + deployment.riskScore.slice(1)}
                  </Badge>
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    GATE_CONFIG[deployment.gateDecision].className
                  )}>
                    <GateIcon className="h-3 w-3" />
                    {GATE_CONFIG[deployment.gateDecision].label}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {mounted ? formatDistanceToNow(new Date(deployment.timestamp)) : "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {deployment.author}
                  </span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    ENV_CONFIG[deployment.environment].className
                  )}>
                    {ENV_CONFIG[deployment.environment].label}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {deployment.correlatedIncidents.length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  <AlertOctagon className="mr-1 h-3 w-3" />
                  {deployment.correlatedIncidents.length} incident{deployment.correlatedIncidents.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </button>
      
      {/* Expanded Content */}
      {isExpanded && (
        <CardContent className="pt-0">
          <div className="grid gap-6 border-t border-gray-100 pt-4 lg:grid-cols-2">
            {/* Left Column */}
            <div className="space-y-5">
              {/* Commit SHAs */}
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <GitCommit className="h-4 w-4" />
                  Commits ({deployment.commitShas.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {deployment.commitShas.map((sha) => (
                    <code
                      key={sha}
                      className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700"
                    >
                      {sha}
                    </code>
                  ))}
                </div>
              </div>
              
              {/* Services Affected */}
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Server className="h-4 w-4" />
                  Services Affected ({deployment.servicesAffected.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {deployment.servicesAffected.map((service) => (
                    <span
                      key={service}
                      className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                    >
                      {service}
                    </span>
                  ))}
                </div>
              </div>
              
              {/* ML Prediction */}
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Brain className="h-4 w-4" />
                  ML Prediction
                </h4>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">Risk Score:</span>
                    <span className={cn(
                      "font-mono text-sm font-bold",
                      deployment.mlPrediction.score >= 0.7 ? "text-red-600" :
                      deployment.mlPrediction.score >= 0.4 ? "text-amber-600" : "text-emerald-600"
                    )}>
                      {deployment.mlPrediction.score.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">Confidence:</span>
                    <span className="font-mono text-sm font-medium text-gray-900">
                      {(deployment.mlPrediction.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Right Column */}
            <div className="space-y-5">
              {/* Risk Breakdown */}
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <AlertTriangle className="h-4 w-4" />
                  Risk Score Breakdown
                </h4>
                <RiskBreakdownBar breakdown={deployment.riskBreakdown} />
              </div>
              
              {/* Correlated Incidents */}
              {deployment.correlatedIncidents.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                    <AlertOctagon className="h-4 w-4" />
                    Correlated Incidents
                  </h4>
                  <div className="space-y-2">
                    {deployment.correlatedIncidents.map((incident) => (
                      <div
                        key={incident.id}
                        className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-medium text-gray-700">{incident.id}</code>
                          <span className="text-sm text-gray-600">{incident.title}</span>
                        </div>
                        <Badge variant={incident.severity} className="text-xs">
                          {incident.severity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Recommendations */}
          {deployment.recommendations.length > 0 && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800">
                <Lightbulb className="h-4 w-4" />
                Recommendations
              </h4>
              <ul className="space-y-1">
                {deployment.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// Checkbox component for filters
function Checkbox({ 
  checked, 
  onChange, 
  label,
  color
}: { 
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  color?: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <div className={cn(
        "flex h-4 w-4 items-center justify-center rounded border-2 transition-colors",
        checked ? "border-gray-900 bg-gray-900" : "border-gray-300 bg-white"
      )}>
        {checked && (
          <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {color && <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}
        <span className="text-sm text-gray-700">{label}</span>
      </div>
    </label>
  )
}

// Main Deployments Client Component
export function DeploymentsClient() {
  const [mounted, setMounted] = useState(false)
  const [deployments, setDeployments] = useState<DeploymentDetail[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [filters, setFilters] = useState<Filters>({
    service: "all",
    team: "all",
    environment: "all",
    riskLevels: new Set(["low", "medium", "high", "critical"]),
  })
  
  const pageSize = 10
  
  // Initialize data client-side only
  useEffect(() => {
    setMounted(true)
    setDeployments(generateDemoDeployments(50))
  }, [])
  
  // Extract unique values for filters
  const filterOptions = useMemo(() => {
    const services = new Set<string>()
    const teams = new Set<string>()
    
    deployments.forEach((d) => {
      d.servicesAffected.forEach((s) => services.add(s))
      teams.add(d.team)
    })
    
    return {
      services: Array.from(services).sort(),
      teams: Array.from(teams).sort(),
    }
  }, [deployments])
  
  // Filter deployments
  const filteredDeployments = useMemo(() => {
    return deployments.filter((d) => {
      if (filters.service !== "all" && !d.servicesAffected.includes(filters.service)) return false
      if (filters.team !== "all" && d.team !== filters.team) return false
      if (filters.environment !== "all" && d.environment !== filters.environment) return false
      if (!filters.riskLevels.has(d.riskScore)) return false
      return true
    })
  }, [deployments, filters])
  
  // Paginate
  const totalPages = Math.ceil(filteredDeployments.length / pageSize)
  const paginatedDeployments = filteredDeployments.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )
  
  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [filters])
  
  const toggleRiskLevel = useCallback((level: string, checked: boolean) => {
    setFilters((prev) => {
      const newLevels = new Set(prev.riskLevels)
      if (checked) {
        newLevels.add(level)
      } else {
        newLevels.delete(level)
      }
      return { ...prev, riskLevels: newLevels }
    })
  }, [])
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Deployment Timeline
        </h1>
        <p className="text-sm text-gray-500">
          Color-coded deployment events with risk analysis and incident correlation
        </p>
      </div>
      
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Service Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Service</label>
              <Select value={filters.service} onValueChange={(v) => setFilters((f) => ({ ...f, service: v }))}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {filterOptions.services.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Team Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Team</label>
              <Select value={filters.team} onValueChange={(v) => setFilters((f) => ({ ...f, team: v }))}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {filterOptions.teams.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Environment Toggle */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Environment</label>
              <Select value={filters.environment} onValueChange={(v) => setFilters((f) => ({ ...f, environment: v }))}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="development">Development</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Risk Level Checkboxes */}
            <div className="flex items-center gap-4 border-l border-gray-200 pl-4">
              <span className="text-sm font-medium text-gray-700">Risk</span>
              <Checkbox
                checked={filters.riskLevels.has("low")}
                onChange={(c) => toggleRiskLevel("low", c)}
                label="Low"
                color={RISK_COLORS.low}
              />
              <Checkbox
                checked={filters.riskLevels.has("medium")}
                onChange={(c) => toggleRiskLevel("medium", c)}
                label="Medium"
                color={RISK_COLORS.medium}
              />
              <Checkbox
                checked={filters.riskLevels.has("high")}
                onChange={(c) => toggleRiskLevel("high", c)}
                label="High"
                color={RISK_COLORS.high}
              />
              <Checkbox
                checked={filters.riskLevels.has("critical")}
                onChange={(c) => toggleRiskLevel("critical", c)}
                label="Critical"
                color={RISK_COLORS.critical}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Timeline Visualization */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Timeline</CardTitle>
            <span className="text-xs text-gray-500">
              {filteredDeployments.length} deployment{filteredDeployments.length !== 1 ? "s" : ""}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-gray-200" />
            
            {/* Timeline dots */}
            <div className="relative flex items-center justify-between px-2 py-4">
              {filteredDeployments.slice(0, 30).map((deployment) => (
                <TimelineDot
                  key={deployment.id}
                  deployment={deployment}
                  isSelected={expandedId === deployment.id}
                  onClick={() => setExpandedId(expandedId === deployment.id ? null : deployment.id)}
                />
              ))}
              {filteredDeployments.length > 30 && (
                <span className="ml-2 text-xs text-gray-500">+{filteredDeployments.length - 30} more</span>
              )}
            </div>
            
            {/* Timeline legend */}
            <div className="mt-2 flex items-center justify-center gap-4 text-xs">
              <span className="text-gray-400">Newer</span>
              <div className="h-px w-16 bg-gray-200" />
              <span className="text-gray-400">Older</span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Deployment Cards */}
      <div className="space-y-3">
        {paginatedDeployments.map((deployment) => (
          <DeploymentCard
            key={deployment.id}
            deployment={deployment}
            isExpanded={expandedId === deployment.id}
            onToggle={() => setExpandedId(expandedId === deployment.id ? null : deployment.id)}
            mounted={mounted}
          />
        ))}
        
        {paginatedDeployments.length === 0 && (
          <Card>
            <CardContent className="flex h-32 items-center justify-center text-sm text-gray-500">
              No deployments match the selected filters.
            </CardContent>
          </Card>
        )}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 pt-4">
          <p className="text-sm text-gray-500">
            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredDeployments.length)} of {filteredDeployments.length} deployments
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={cn(
                "inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-2",
                "hover:bg-gray-50 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                let pageNum: number
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  pageNum = i + 1
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = currentPage - 2 + i
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors",
                      currentPage === pageNum
                        ? "bg-gray-900 text-white"
                        : "hover:bg-gray-100 text-gray-700"
                    )}
                  >
                    {pageNum}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={cn(
                "inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-2",
                "hover:bg-gray-50 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
