"use client"

/**
 * Incidents Management Page
 * 
 * Features:
 * - Header with filters (severity, service, correlation status, date range)
 * - Summary stats cards
 * - Data table with expandable rows
 * - Correlation timeline visualization
 * - Pagination
 */

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import {
  AlertCircle,
  Download,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  Link2,
  Eye,
  X,
  Clock,
  Loader2,
  Calendar,
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Types
type Severity = "low" | "medium" | "high" | "critical"
type CorrelationStatus = "correlated" | "uncorrelated" | "pending"

interface CorrelatedDeployment {
  id: string
  service: string
  author: string
  riskScore: number
  timestamp: string
}

interface Incident {
  id: string
  externalId: string
  severity: Severity
  service: string
  detectedAt: string
  resolvedAt: string | null
  correlationStatus: CorrelationStatus
  correlatedDeployments: CorrelatedDeployment[]
  description: string
}

// Demo data generation with seeded random
function seededRandom(seed: number) {
  const x = Math.sin(seed++) * 10000
  return x - Math.floor(x)
}

function generateIncidents(count: number): Incident[] {
  const services = ["api-gateway", "user-service", "payment-service", "notification-service", "analytics-service"]
  const severities: Severity[] = ["low", "medium", "high", "critical"]
  const correlationStatuses: CorrelationStatus[] = ["correlated", "uncorrelated", "pending"]
  const authors = ["alice", "bob", "charlie", "diana", "evan"]
  const descriptions = [
    "Database connection timeout",
    "Memory leak detected",
    "Service unavailable",
    "High latency observed",
    "Authentication failures",
    "Rate limit exceeded",
    "Disk space critical",
    "CPU utilization spike",
  ]

  const incidents: Incident[] = []
  const baseTime = new Date("2026-06-03T12:00:00Z").getTime()

  for (let i = 0; i < count; i++) {
    const seed = i * 1000
    const severity = severities[Math.floor(seededRandom(seed + 1) * severities.length)]
    const correlationStatus = correlationStatuses[Math.floor(seededRandom(seed + 2) * correlationStatuses.length)]
    const detectedAt = new Date(baseTime - seededRandom(seed + 3) * 7 * 24 * 60 * 60 * 1000)
    const isResolved = seededRandom(seed + 4) > 0.3
    const resolvedAt = isResolved 
      ? new Date(detectedAt.getTime() + seededRandom(seed + 5) * 4 * 60 * 60 * 1000)
      : null

    const correlatedDeployments: CorrelatedDeployment[] = []
    if (correlationStatus === "correlated") {
      const deploymentCount = Math.floor(seededRandom(seed + 6) * 3) + 1
      for (let j = 0; j < deploymentCount; j++) {
        correlatedDeployments.push({
          id: `deploy-${String(i * 10 + j).padStart(4, "0")}`,
          service: services[Math.floor(seededRandom(seed + 7 + j) * services.length)],
          author: authors[Math.floor(seededRandom(seed + 8 + j) * authors.length)],
          riskScore: Math.floor(seededRandom(seed + 9 + j) * 100),
          timestamp: new Date(detectedAt.getTime() - seededRandom(seed + 10 + j) * 60 * 60 * 1000).toISOString(),
        })
      }
    }

    incidents.push({
      id: `inc-${String(i + 1).padStart(4, "0")}`,
      externalId: `PD-${String(45000 + i).padStart(5, "0")}`,
      severity,
      service: services[Math.floor(seededRandom(seed + 11) * services.length)],
      detectedAt: detectedAt.toISOString(),
      resolvedAt: resolvedAt?.toISOString() ?? null,
      correlationStatus,
      correlatedDeployments,
      description: descriptions[Math.floor(seededRandom(seed + 12) * descriptions.length)],
    })
  }

  return incidents
}

// Utility functions
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatDuration(startDate: string, endDate: string | null): string {
  if (!endDate) return "Ongoing"
  
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffMs = end.getTime() - start.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

  if (diffMins < 60) return `${diffMins}m`
  return `${diffHours}h ${diffMins % 60}m`
}

function formatFullDate(dateString: string): string {
  return new Date(dateString).toISOString()
}

// Components
function SeverityDot({ severity }: { severity: Severity }) {
  const colors = {
    low: "bg-emerald-500",
    medium: "bg-amber-500",
    high: "bg-orange-500",
    critical: "bg-red-500",
  }

  return (
    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", colors[severity])} />
  )
}

function CorrelationBadge({ status, count }: { status: CorrelationStatus; count?: number }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        Pending
      </span>
    )
  }

  if (status === "correlated") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
        <Link2 className="h-3 w-3" />
        {count} deployment{count !== 1 ? "s" : ""}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      Uncorrelated
    </span>
  )
}

function RiskScoreBadge({ score }: { score: number }) {
  let variant: "low" | "medium" | "high" | "critical" = "low"
  if (score >= 80) variant = "critical"
  else if (score >= 60) variant = "high"
  else if (score >= 40) variant = "medium"

  return <Badge variant={variant}>{score}%</Badge>
}

function SummaryCard({ 
  title, 
  value, 
  accent 
}: { 
  title: string
  value: string | number
  accent?: "red" | "blue" | "green"
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className={cn(
          "mt-1 text-2xl font-bold",
          accent === "red" && "text-red-600",
          accent === "blue" && "text-blue-600",
          accent === "green" && "text-emerald-600",
          !accent && "text-gray-900"
        )}>
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function CorrelationTimeline({ 
  incident, 
  deployments 
}: { 
  incident: Incident
  deployments: CorrelatedDeployment[]
}) {
  const detectedAt = new Date(incident.detectedAt).getTime()
  const windowStart = detectedAt - 60 * 60 * 1000 // 60 min before
  const windowEnd = incident.resolvedAt 
    ? new Date(incident.resolvedAt).getTime()
    : detectedAt + 60 * 60 * 1000 // 60 min after if not resolved
  const totalDuration = windowEnd - windowStart

  const getPosition = (timestamp: string) => {
    const time = new Date(timestamp).getTime()
    return Math.max(0, Math.min(100, ((time - windowStart) / totalDuration) * 100))
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>Correlation Window (60 min)</span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Timeline
        </span>
      </div>
      
      <div className="relative h-8">
        {/* Timeline bar */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-200" />
        
        {/* Correlation window indicator */}
        <div 
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-blue-100 border border-blue-200"
          style={{ 
            left: `${getPosition(new Date(detectedAt - 60 * 60 * 1000).toISOString())}%`,
            right: `${100 - getPosition(incident.detectedAt)}%`
          }}
        />

        {/* Deployment markers */}
        {deployments.map((deployment, idx) => (
          <div
            key={deployment.id}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${getPosition(deployment.timestamp)}%` }}
            title={`${deployment.id} - ${deployment.service}`}
          >
            <div className="h-4 w-4 rounded-full bg-blue-500 border-2 border-white shadow-sm flex items-center justify-center">
              <span className="text-[8px] font-bold text-white">{idx + 1}</span>
            </div>
          </div>
        ))}

        {/* Incident detection marker */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${getPosition(incident.detectedAt)}%` }}
          title="Incident detected"
        >
          <div className="h-5 w-5 rounded-full bg-red-500 border-2 border-white shadow-sm flex items-center justify-center">
            <AlertCircle className="h-3 w-3 text-white" />
          </div>
        </div>

        {/* Resolution marker */}
        {incident.resolvedAt && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${getPosition(incident.resolvedAt)}%` }}
            title="Incident resolved"
          >
            <div className="h-5 w-5 rounded-full bg-emerald-500 border-2 border-white shadow-sm flex items-center justify-center">
              <Check className="h-3 w-3 text-white" />
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
          Deployment
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          Detection
        </span>
        {incident.resolvedAt && (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Resolution
          </span>
        )}
      </div>
    </div>
  )
}

function ExpandedRowContent({ incident }: { incident: Incident }) {
  if (incident.correlatedDeployments.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No correlated deployments found within the 60-minute correlation window.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Correlated Deployments List */}
      <div>
        <h4 className="text-sm font-medium text-gray-900 mb-2">
          Correlated Deployments ({incident.correlatedDeployments.length})
        </h4>
        <div className="space-y-2">
          {incident.correlatedDeployments.map((deployment) => (
            <div 
              key={deployment.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex items-center gap-3">
                <Link 
                  href={`/dashboard/deployments?id=${deployment.id}`}
                  className="text-sm font-mono font-medium text-blue-600 hover:underline"
                >
                  {deployment.id}
                </Link>
                <span className="text-sm text-gray-600">{deployment.service}</span>
                <span className="text-sm text-gray-400">by {deployment.author}</span>
              </div>
              <div className="flex items-center gap-3">
                <RiskScoreBadge score={deployment.riskScore} />
                <span className="text-xs text-gray-500">
                  {formatRelativeTime(deployment.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Visualization */}
      <CorrelationTimeline 
        incident={incident} 
        deployments={incident.correlatedDeployments} 
      />
    </div>
  )
}

function ActionsMenu({ 
  incident, 
  onClose 
}: { 
  incident: Incident
  onClose: () => void 
}) {
  return (
    <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
      <div className="py-1">
        <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <Eye className="h-4 w-4" />
          View Details
        </button>
        <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <Link2 className="h-4 w-4" />
          Link Deployment
        </button>
        <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
          <X className="h-4 w-4" />
          Dismiss
        </button>
      </div>
    </div>
  )
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (selected: string[]) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
      >
        {label}
        {selected.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-gray-500" />
      </button>
      
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="py-1">
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => toggleOption(option.value)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border",
                    selected.includes(option.value)
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300"
                  )}>
                    {selected.includes(option.value) && <Check className="h-3 w-3" />}
                  </span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Dropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption = options.find((o) => o.value === value)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
      >
        {selectedOption?.label || label}
        <ChevronDown className="h-4 w-4 text-gray-500" />
      </button>
      
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="py-1">
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center px-4 py-2 text-sm hover:bg-gray-50",
                    option.value === value ? "bg-gray-50 text-gray-900" : "text-gray-700"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
            option.value === value
              ? "bg-gray-900 text-white"
              : "text-gray-600 hover:text-gray-900"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// Main Page Component
export default function IncidentsPage() {
  const [mounted, setMounted] = useState(false)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionsMenuId, setActionsMenuId] = useState<string | null>(null)
  
  // Filters
  const [severityFilter, setSeverityFilter] = useState<string[]>([])
  const [serviceFilter, setServiceFilter] = useState("all")
  const [correlationFilter, setCorrelationFilter] = useState("all")
  const [dateRange, setDateRange] = useState("7d")
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 25

  useEffect(() => {
    setMounted(true)
    setIncidents(generateIncidents(47))
  }, [])

  // Filter incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      if (severityFilter.length > 0 && !severityFilter.includes(incident.severity)) {
        return false
      }
      if (serviceFilter !== "all" && incident.service !== serviceFilter) {
        return false
      }
      if (correlationFilter !== "all" && incident.correlationStatus !== correlationFilter) {
        return false
      }
      return true
    })
  }, [incidents, severityFilter, serviceFilter, correlationFilter])

  // Paginate
  const paginatedIncidents = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filteredIncidents.slice(start, start + itemsPerPage)
  }, [filteredIncidents, currentPage])

  const totalPages = Math.ceil(filteredIncidents.length / itemsPerPage)

  // Calculate stats
  const stats = useMemo(() => {
    const total = incidents.length
    const open = incidents.filter((i) => !i.resolvedAt).length
    const correlated = incidents.filter((i) => i.correlationStatus === "correlated").length
    
    // Calculate average MTTR for resolved incidents
    const resolvedIncidents = incidents.filter((i) => i.resolvedAt)
    const totalMttr = resolvedIncidents.reduce((acc, i) => {
      const detected = new Date(i.detectedAt).getTime()
      const resolved = new Date(i.resolvedAt!).getTime()
      return acc + (resolved - detected)
    }, 0)
    const avgMttrHours = resolvedIncidents.length > 0 
      ? (totalMttr / resolvedIncidents.length / (1000 * 60 * 60)).toFixed(1)
      : "0"

    const correlationRate = total > 0 
      ? Math.round((correlated / total) * 100)
      : 0

    return { total, open, avgMttrHours, correlationRate }
  }, [incidents])

  // Services for filter
  const services = useMemo(() => {
    const unique = [...new Set(incidents.map((i) => i.service))]
    return [{ value: "all", label: "All Services" }, ...unique.map((s) => ({ value: s, label: s }))]
  }, [incidents])

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="rounded-full bg-gray-100 p-4 mb-4">
          <AlertCircle className="h-8 w-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No incidents recorded yet</h2>
        <p className="text-gray-500 mb-4">
          Set up your incident webhook integration to start tracking production incidents.
        </p>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Configure Integration
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Incidents</h1>
          <p className="text-sm text-gray-500">
            Production incidents and deployment correlations
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <MultiSelect
          label="Severity"
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "critical", label: "Critical" },
          ]}
          selected={severityFilter}
          onChange={setSeverityFilter}
        />
        
        <Dropdown
          label="Service"
          options={services}
          value={serviceFilter}
          onChange={setServiceFilter}
        />

        <ToggleGroup
          options={[
            { value: "all", label: "All" },
            { value: "correlated", label: "Correlated" },
            { value: "uncorrelated", label: "Uncorrelated" },
            { value: "pending", label: "Pending" },
          ]}
          value={correlationFilter}
          onChange={setCorrelationFilter}
        />

        <Dropdown
          label="Date Range"
          options={[
            { value: "24h", label: "Last 24 hours" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
            { value: "90d", label: "Last 90 days" },
          ]}
          value={dateRange}
          onChange={setDateRange}
        />
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard title="Total Incidents" value={stats.total} />
        <SummaryCard title="Open / Unresolved" value={stats.open} accent="red" />
        <SummaryCard title="Average MTTR" value={`${stats.avgMttrHours}h`} />
        <SummaryCard title="Correlation Rate" value={`${stats.correlationRate}%`} accent="blue" />
      </div>

      {/* Data Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="w-8 px-4 py-3"></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Severity</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">External ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Service</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Detected</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Resolved</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Correlation</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedIncidents.map((incident) => {
                const isExpanded = expandedId === incident.id
                
                return (
                  <>
                    <tr 
                      key={incident.id}
                      className={cn(
                        "border-b border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer",
                        isExpanded && "bg-gray-50"
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : incident.id)}
                    >
                      <td className="px-4 py-3">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <SeverityDot severity={incident.severity} />
                          <span className="text-sm capitalize">{incident.severity}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <a 
                          href="#" 
                          className="text-sm font-mono text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {incident.externalId}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{incident.service}</td>
                      <td className="px-4 py-3">
                        <span 
                          className="text-sm text-gray-600"
                          title={formatFullDate(incident.detectedAt)}
                        >
                          {mounted ? formatRelativeTime(incident.detectedAt) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {incident.resolvedAt ? (
                          <span 
                            className="text-sm text-gray-600"
                            title={formatFullDate(incident.resolvedAt)}
                          >
                            {mounted ? formatRelativeTime(incident.resolvedAt) : "—"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            Open
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {incident.resolvedAt ? (
                          <span className="text-sm text-gray-600">
                            {formatDuration(incident.detectedAt, incident.resolvedAt)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Ongoing
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <CorrelationBadge 
                          status={incident.correlationStatus} 
                          count={incident.correlatedDeployments.length}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setActionsMenuId(actionsMenuId === incident.id ? null : incident.id)
                            }}
                            className="rounded p-1 hover:bg-gray-100"
                          >
                            <MoreHorizontal className="h-4 w-4 text-gray-500" />
                          </button>
                          {actionsMenuId === incident.id && (
                            <>
                              <div 
                                className="fixed inset-0 z-10" 
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActionsMenuId(null)
                                }}
                              />
                              <ActionsMenu 
                                incident={incident} 
                                onClose={() => setActionsMenuId(null)} 
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${incident.id}-expanded`}>
                        <td colSpan={9} className="bg-gray-50 border-b border-gray-200">
                          <ExpandedRowContent incident={incident} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <span className="text-sm text-gray-500">
            Showing {((currentPage - 1) * itemsPerPage) + 1}-{Math.min(currentPage * itemsPerPage, filteredIncidents.length)} of {filteredIncidents.length} incidents
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
