"use client"

/**
 * Dashboard Client Component — Redesigned
 */

import { useCallback, useEffect, useState } from "react"
import {
  DORAMetricsCard,
  DORAMetricValue,
  computeTrend,
} from "./dora-metrics-card"
import { RiskHistogram, RiskDistribution } from "./risk-histogram"
import {
  TimeRangeSelector,
  TimeRangeDays,
} from "./time-range-selector"
import { InsufficientData } from "./insufficient-data"
import { DeploymentsTimeline, Deployment, generateMockDeployments } from "./deployments-timeline"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface DORAMetricsResponse {
  deploymentFrequency: number | "insufficient_data"
  leadTimeHours: number | "insufficient_data"
  changeFailureRate: number | "insufficient_data"
  mttrHours: number | "insufficient_data"
  unresolvedIncidentCount: number
  period: { start: string; end: string }
  filters: { team?: string; service?: string; environment?: string }
}

interface DeploymentEventsResponse {
  data: Array<{
    eventId: string
    riskScore?: "low" | "medium" | "high" | "critical" | "indeterminate"
  }>
  pagination?: {
    totalCount: number
  }
}

export interface DashboardInitialData {
  currentMetrics: DORAMetricsResponse | null
  previousMetrics: DORAMetricsResponse | null
  riskDistribution: RiskDistribution
  totalEvents: number
  maxRetentionDays: number
}

export interface DashboardClientProps {
  initialData: DashboardInitialData
  defaultTimeRange?: TimeRangeDays
}

const POLLING_INTERVAL_MS = 30_000
const MINIMUM_EVENTS = 3

// Demo data for showcasing the dashboard
const DEMO_METRICS: DORAMetricsResponse = {
  deploymentFrequency: 4.2,
  leadTimeHours: 18.5,
  changeFailureRate: 12.3,
  mttrHours: 2.1,
  unresolvedIncidentCount: 3,
  period: { start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), end: new Date().toISOString() },
  filters: {},
}

const DEMO_PREVIOUS_METRICS: DORAMetricsResponse = {
  deploymentFrequency: 3.8,
  leadTimeHours: 22.1,
  changeFailureRate: 15.7,
  mttrHours: 2.8,
  unresolvedIncidentCount: 5,
  period: { start: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), end: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
  filters: {},
}

const DEMO_RISK_DISTRIBUTION: RiskDistribution = {
  low: 45,
  medium: 28,
  high: 12,
  critical: 3,
}

export function DashboardClient({
  initialData,
  defaultTimeRange = 30,
}: DashboardClientProps) {
  // Use demo mode when there's insufficient real data
  const useDemoMode = initialData.totalEvents < MINIMUM_EVENTS
  
  const [timeRange, setTimeRange] = useState<TimeRangeDays>(defaultTimeRange)
  const [currentMetrics, setCurrentMetrics] = useState<DORAMetricsResponse | null>(
    useDemoMode ? DEMO_METRICS : initialData.currentMetrics
  )
  const [previousMetrics, setPreviousMetrics] = useState<DORAMetricsResponse | null>(
    useDemoMode ? DEMO_PREVIOUS_METRICS : initialData.previousMetrics
  )
  const [riskDistribution, setRiskDistribution] = useState<RiskDistribution>(
    useDemoMode ? DEMO_RISK_DISTRIBUTION : initialData.riskDistribution
  )
  const [totalEvents, setTotalEvents] = useState(useDemoMode ? 88 : initialData.totalEvents)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [deployments, setDeployments] = useState<Deployment[]>(() => generateMockDeployments(20))

  const fetchData = useCallback(async (days: TimeRangeDays) => {
    try {
      const now = new Date()
      const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      const previousFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000)

      const params = new URLSearchParams({
        from: from.toISOString(),
        to: now.toISOString(),
      })

      const prevParams = new URLSearchParams({
        from: previousFrom.toISOString(),
        to: from.toISOString(),
      })

      const [currentRes, prevRes, eventsRes] = await Promise.all([
        fetch(`/api/metrics/dora?${params}`),
        fetch(`/api/metrics/dora?${prevParams}`),
        fetch(`/api/v1/deployments?${params}&pageSize=100`),
      ])

      if (currentRes.ok) {
        const data: DORAMetricsResponse = await currentRes.json()
        setCurrentMetrics(data)
      }

      if (prevRes.ok) {
        const data: DORAMetricsResponse = await prevRes.json()
        setPreviousMetrics(data)
      }

      if (eventsRes.ok) {
        const data: DeploymentEventsResponse = await eventsRes.json()
        const dist = computeRiskDistribution(data.data)
        setRiskDistribution(dist)
        setTotalEvents(data.pagination?.totalCount ?? data.data.length)
      }
    } catch (err) {
      console.error("Dashboard polling error:", err)
    }
  }, [])

  const handleTimeRangeChange = useCallback(
    async (days: TimeRangeDays) => {
      setTimeRange(days)
      setIsLoading(true)
      await fetchData(days)
      setIsLoading(false)
      // Regenerate mock deployments for demo
      setDeployments(generateMockDeployments(20))
    },
    [fetchData]
  )

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await fetchData(timeRange)
    setDeployments(generateMockDeployments(20))
    setTimeout(() => setIsRefreshing(false), 500)
  }, [fetchData, timeRange])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(timeRange)
    }, POLLING_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [fetchData, timeRange])

  const doraMetrics: DORAMetricValue[] = buildMetricsDisplay(
    currentMetrics,
    previousMetrics
  )

  // Always show the dashboard (demo mode provides sample data when real data is insufficient)
  const hasInsufficientData = false

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            OllinAI — Change Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            DORA metrics and deployment risk overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "inline-flex items-center justify-center rounded-md border border-input bg-background p-2",
              "hover:bg-accent hover:text-accent-foreground transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            aria-label="Refresh data"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </button>
          <TimeRangeSelector
            selected={timeRange}
            onChange={handleTimeRangeChange}
            maxRetentionDays={initialData.maxRetentionDays}
          />
        </div>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="text-sm text-muted-foreground">Refreshing data…</div>
      )}

      {/* Insufficient data state */}
      {hasInsufficientData ? (
        <InsufficientData eventCount={totalEvents} minimumRequired={MINIMUM_EVENTS} />
      ) : (
        <div className="space-y-6">
          {/* DORA Metrics Section */}
          <section aria-labelledby="dora-metrics-heading">
            <h2 id="dora-metrics-heading" className="sr-only">
              DORA Metrics
            </h2>
            <DORAMetricsCard metrics={doraMetrics} />
          </section>

          {/* Risk Distribution and Recent Deployments */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <RiskHistogram 
                distribution={riskDistribution} 
                totalDeployments={totalEvents}
              />
            </div>
            <div className="lg:col-span-2">
              <DeploymentsTimeline 
                deployments={deployments} 
                isLoading={isLoading}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildMetricsDisplay(
  current: DORAMetricsResponse | null,
  previous: DORAMetricsResponse | null
): DORAMetricValue[] {
  if (!current) {
    return getEmptyMetrics()
  }

  return [
    {
      label: "Deployment Frequency",
      value: current.deploymentFrequency,
      unit: "/day",
      lowerIsBetter: false,
      previousValue: previous?.deploymentFrequency,
      trend: computeTrend(
        current.deploymentFrequency,
        previous?.deploymentFrequency ?? "insufficient_data",
        false
      ),
    },
    {
      label: "Lead Time",
      value: current.leadTimeHours,
      unit: "hrs",
      lowerIsBetter: true,
      previousValue: previous?.leadTimeHours,
      trend: computeTrend(
        current.leadTimeHours,
        previous?.leadTimeHours ?? "insufficient_data",
        true
      ),
    },
    {
      label: "Change Failure Rate",
      value: current.changeFailureRate,
      unit: "%",
      lowerIsBetter: true,
      previousValue: previous?.changeFailureRate,
      trend: computeTrend(
        current.changeFailureRate,
        previous?.changeFailureRate ?? "insufficient_data",
        true
      ),
    },
    {
      label: "MTTR",
      value: current.mttrHours,
      unit: "hrs",
      lowerIsBetter: true,
      previousValue: previous?.mttrHours,
      trend: computeTrend(
        current.mttrHours,
        previous?.mttrHours ?? "insufficient_data",
        true
      ),
    },
  ]
}

function getEmptyMetrics(): DORAMetricValue[] {
  return [
    { label: "Deployment Frequency", value: "insufficient_data", unit: "/day", lowerIsBetter: false, trend: "stable" },
    { label: "Lead Time", value: "insufficient_data", unit: "hrs", lowerIsBetter: true, trend: "stable" },
    { label: "Change Failure Rate", value: "insufficient_data", unit: "%", lowerIsBetter: true, trend: "stable" },
    { label: "MTTR", value: "insufficient_data", unit: "hrs", lowerIsBetter: true, trend: "stable" },
  ]
}

function computeRiskDistribution(
  events: Array<{ riskScore?: string }>
): RiskDistribution {
  const dist: RiskDistribution = { low: 0, medium: 0, high: 0, critical: 0 }

  for (const event of events) {
    const score = event.riskScore
    if (score === "low" || score === "medium" || score === "high" || score === "critical") {
      dist[score]++
    }
  }

  return dist
}
