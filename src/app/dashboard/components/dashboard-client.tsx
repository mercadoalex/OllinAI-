"use client";

/**
 * Dashboard Client Component
 *
 * Handles client-side polling (30-second interval) for near-real-time updates
 * and manages the time range selector state.
 *
 * Requirements: 8.1, 8.5, 8.7, 9.5 (30-second update), 9.7 (time range selector)
 */

import { useCallback, useEffect, useState } from "react";
import {
  DORAMetricsCard,
  DORAMetricValue,
  computeTrend,
} from "./dora-metrics-card";
import { RiskHistogram, RiskDistribution } from "./risk-histogram";
import {
  TimeRangeSelector,
  TimeRangeDays,
  TIME_RANGE_OPTIONS,
} from "./time-range-selector";
import { InsufficientData } from "./insufficient-data";
import { OnboardingBanner } from "./onboarding-banner";
import { MetricSection } from "./metric-section";
import { SectionNavBar, NavSection } from "./section-nav-bar";
import { RiskMetricsSection } from "./sections/risk-metrics-section";
import { CorrelationMetricsSection } from "./sections/correlation-metrics-section";
import { TeamPerformanceSection } from "./sections/team-performance-section";
import { ServiceHealthSection } from "./sections/service-health-section";
import { PredictionsSection } from "./sections/predictions-section";
import { BusinessImpactSection } from "./sections/business-impact-section";

/** Shape of DORA metrics response from the API */
interface DORAMetricsResponse {
  deploymentFrequency: number | "insufficient_data";
  leadTimeHours: number | "insufficient_data";
  changeFailureRate: number | "insufficient_data";
  mttrHours: number | "insufficient_data";
  unresolvedIncidentCount: number;
  period: { start: string; end: string };
  filters: { team?: string; service?: string; environment?: string };
}

/** Shape of deployment events response used to compute risk distribution */
interface DeploymentEventsResponse {
  data: Array<{
    eventId: string;
    riskScore?: "low" | "medium" | "high" | "critical" | "indeterminate";
  }>;
  pagination?: {
    totalCount: number;
  };
}

export interface DashboardInitialData {
  currentMetrics: DORAMetricsResponse | null;
  previousMetrics: DORAMetricsResponse | null;
  riskDistribution: RiskDistribution;
  totalEvents: number;
  maxRetentionDays: number;
}

export interface DashboardClientProps {
  initialData: DashboardInitialData;
  defaultTimeRange?: TimeRangeDays;
  currentTier?: string;
}

/** Polling interval in milliseconds (30 seconds) */
const POLLING_INTERVAL_MS = 30_000;

/** Minimum events required for meaningful visualization */
const MINIMUM_EVENTS = 3;

export function DashboardClient({
  initialData,
  defaultTimeRange = 30,
  currentTier = "enterprise",
}: DashboardClientProps) {
  const [timeRange, setTimeRange] = useState<TimeRangeDays>(defaultTimeRange);
  const [currentMetrics, setCurrentMetrics] = useState<DORAMetricsResponse | null>(
    initialData.currentMetrics
  );
  const [previousMetrics, setPreviousMetrics] = useState<DORAMetricsResponse | null>(
    initialData.previousMetrics
  );
  const [riskDistribution, setRiskDistribution] = useState<RiskDistribution>(
    initialData.riskDistribution
  );
  const [totalEvents, setTotalEvents] = useState(initialData.totalEvents);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (days: TimeRangeDays) => {
    try {
      const now = new Date();
      const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const previousFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

      const params = new URLSearchParams({
        from: from.toISOString(),
        to: now.toISOString(),
      });

      const prevParams = new URLSearchParams({
        from: previousFrom.toISOString(),
        to: from.toISOString(),
      });

      // Fetch current period and previous period metrics in parallel
      const [currentRes, prevRes] = await Promise.all([
        fetch(`/api/metrics/dora?${params}`),
        fetch(`/api/metrics/dora?${prevParams}`),
      ]);

      if (currentRes.ok) {
        const data: DORAMetricsResponse = await currentRes.json();
        setCurrentMetrics(data);
      }

      if (prevRes.ok) {
        const data: DORAMetricsResponse = await prevRes.json();
        setPreviousMetrics(data);
      }

      setError(null);
    } catch (err) {
      // Silently handle polling errors — display last known data
      console.error("Dashboard polling error:", err);
      setError("Unable to refresh data. Displaying cached results.");
    }
  }, []);

  // Handle time range changes
  const handleTimeRangeChange = useCallback(
    async (days: TimeRangeDays) => {
      setTimeRange(days);
      setIsLoading(true);
      await fetchData(days);
      setIsLoading(false);
    },
    [fetchData]
  );

  // Set up 30-second polling
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(timeRange);
    }, POLLING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchData, timeRange]);

  // Build DORA metrics display data
  const doraMetrics: DORAMetricValue[] = buildMetricsDisplay(
    currentMetrics,
    previousMetrics
  );

  const hasInsufficientData = totalEvents < MINIMUM_EVENTS;

  // Compute time range start for metric section API calls
  const timeRangeFrom = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

  // Navigation sections with tier availability
  const navSections: NavSection[] = [
    { id: "risk-metrics", label: "Risk Metrics", available: hasTier(currentTier, "pro") },
    { id: "correlation-metrics", label: "Correlation Metrics", available: hasTier(currentTier, "pro") },
    { id: "team-performance", label: "Team Performance", available: hasTier(currentTier, "pro") },
    { id: "service-health", label: "Service Health", available: hasTier(currentTier, "pro") },
    { id: "predictions", label: "Predictions", available: hasTier(currentTier, "enterprise") },
    { id: "business-impact", label: "Business Impact", available: hasTier(currentTier, "enterprise") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Onboarding resume banner (shown when onboarding was skipped) */}
      <OnboardingBanner />

      {/* Header with time range selector */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h1
            style={{
              margin: "0",
              fontSize: "24px",
              fontWeight: 700,
              color: "#111827",
            }}
          >
            Dashboard
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#6b7280" }}>
            DORA metrics and deployment risk overview
          </p>
        </div>
        <TimeRangeSelector
          selected={timeRange}
          onChange={handleTimeRangeChange}
          maxRetentionDays={initialData.maxRetentionDays}
        />
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div style={{ fontSize: "13px", color: "#6b7280" }}>
          Refreshing data…
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            backgroundColor: "#fef3c7",
            border: "1px solid #fbbf24",
            fontSize: "13px",
            color: "#92400e",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Insufficient data state */}
      {hasInsufficientData ? (
        <InsufficientData eventCount={totalEvents} minimumRequired={MINIMUM_EVENTS} />
      ) : (
        <>
          {/* DORA Metrics Section */}
          <section aria-labelledby="dora-metrics-heading">
            <h2
              id="dora-metrics-heading"
              style={{
                margin: "0 0 12px",
                fontSize: "16px",
                fontWeight: 600,
                color: "#374151",
              }}
            >
              DORA Metrics
            </h2>
            <DORAMetricsCard metrics={doraMetrics} />
          </section>

          {/* Risk Distribution Section */}
          <section aria-labelledby="risk-distribution-heading">
            <h2
              id="risk-distribution-heading"
              style={{
                margin: "0 0 12px",
                fontSize: "16px",
                fontWeight: 600,
                color: "#374151",
              }}
            >
              Risk Score Distribution
            </h2>
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                backgroundColor: "#ffffff",
              }}
            >
              <RiskHistogram distribution={riskDistribution} />
            </div>
          </section>
        </>
      )}

      {/* Advanced Metric Sections — progressive client-side loading */}
      <SectionNavBar sections={navSections} activeSection={navSections[0]?.id ?? ""} />

      <MetricSection
        id="risk-metrics"
        title="Risk Metrics"
        apiEndpoint={`/api/metrics/risk?from=${timeRangeFrom.toISOString()}&to=${new Date().toISOString()}`}
        tierRequired="pro"
        currentTier={currentTier}
      >
        {(data) => <RiskMetricsSection data={data as any} />}
      </MetricSection>

      <MetricSection
        id="correlation-metrics"
        title="Correlation Metrics"
        apiEndpoint={`/api/metrics/correlation?from=${timeRangeFrom.toISOString()}&to=${new Date().toISOString()}`}
        tierRequired="pro"
        currentTier={currentTier}
      >
        {(data) => <CorrelationMetricsSection data={data as any} />}
      </MetricSection>

      <MetricSection
        id="team-performance"
        title="Team Performance"
        apiEndpoint={`/api/metrics/team-performance?from=${timeRangeFrom.toISOString()}&to=${new Date().toISOString()}`}
        tierRequired="pro"
        currentTier={currentTier}
      >
        {(data) => <TeamPerformanceSection data={data as any} />}
      </MetricSection>

      <MetricSection
        id="service-health"
        title="Service Health"
        apiEndpoint={`/api/metrics/service-health?from=${timeRangeFrom.toISOString()}&to=${new Date().toISOString()}`}
        tierRequired="pro"
        currentTier={currentTier}
      >
        {(data) => <ServiceHealthSection data={data as any} />}
      </MetricSection>

      <MetricSection
        id="predictions"
        title="Predictions & Prevention"
        apiEndpoint={`/api/metrics/predictions?from=${timeRangeFrom.toISOString()}&to=${new Date().toISOString()}`}
        tierRequired="enterprise"
        currentTier={currentTier}
      >
        {(data) => <PredictionsSection data={data as any} />}
      </MetricSection>

      <MetricSection
        id="business-impact"
        title="Business Impact"
        apiEndpoint={`/api/metrics/business-impact?from=${timeRangeFrom.toISOString()}&to=${new Date().toISOString()}`}
        tierRequired="enterprise"
        currentTier={currentTier}
      >
        {(data) => <BusinessImpactSection data={data as any} />}
      </MetricSection>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Tier hierarchy for section visibility */
const TIER_HIERARCHY: Record<string, number> = {
  starter: 0,
  pro: 1,
  enterprise: 2,
};

function hasTier(currentTier: string, requiredTier: string): boolean {
  const current = TIER_HIERARCHY[currentTier.toLowerCase()] ?? 0;
  const required = TIER_HIERARCHY[requiredTier.toLowerCase()] ?? 0;
  return current >= required;
}

function buildMetricsDisplay(
  current: DORAMetricsResponse | null,
  previous: DORAMetricsResponse | null
): DORAMetricValue[] {
  if (!current) {
    return getEmptyMetrics();
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
  ];
}

function getEmptyMetrics(): DORAMetricValue[] {
  return [
    { label: "Deployment Frequency", value: "insufficient_data", unit: "/day", lowerIsBetter: false, trend: "stable" },
    { label: "Lead Time", value: "insufficient_data", unit: "hrs", lowerIsBetter: true, trend: "stable" },
    { label: "Change Failure Rate", value: "insufficient_data", unit: "%", lowerIsBetter: true, trend: "stable" },
    { label: "MTTR", value: "insufficient_data", unit: "hrs", lowerIsBetter: true, trend: "stable" },
  ];
}

function computeRiskDistribution(
  events: Array<{ riskScore?: string }>
): RiskDistribution {
  const dist: RiskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };

  for (const event of events) {
    const score = event.riskScore;
    if (score === "low" || score === "medium" || score === "high" || score === "critical") {
      dist[score]++;
    }
  }

  return dist;
}
