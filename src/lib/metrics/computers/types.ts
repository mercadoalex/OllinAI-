/**
 * Shared types and interfaces for the advanced dashboard metrics computation layer.
 *
 * These types define the contracts for metric computations across all six new
 * dashboard sections: Risk, Correlation, Team Performance, Service Health,
 * Predictions & Prevention, and Business Impact.
 */

import type { TrendIndicator } from "../utils";

// ─── Computation Context ───────────────────────────────────────────────────────

/**
 * Context passed to every metric computer function to scope queries
 * to the correct tenant, time range, and optional filters.
 */
export interface MetricComputeContext {
  /** Authenticated tenant identifier */
  tenantId: string;
  /** Start of the time range (inclusive) */
  from: Date;
  /** End of the time range (exclusive) */
  to: Date;
  /** Optional team filter */
  teamId?: string;
  /** Optional service filter */
  serviceId?: string;
}

// ─── Shared Result Types ───────────────────────────────────────────────────────

/**
 * Returned when fewer than the minimum required events exist for a meaningful
 * computation. Prevents rendering misleading metrics from sparse data.
 */
export interface InsufficientDataResult {
  type: "insufficient_data";
  /** Number of events actually found */
  eventCount: number;
  /** Minimum events required for computation (always 3) */
  minimumRequired: 3;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Numeric mapping for risk score severity levels.
 * Used to compute arithmetic averages of categorical risk scores.
 *
 * low=1, medium=2, high=3, critical=4
 */
export const RISK_SCORE_NUMERIC: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Minimum number of events required for meaningful metric computation */
export const MINIMUM_EVENTS_REQUIRED = 3;

// ─── API Response Interfaces ───────────────────────────────────────────────────

/**
 * Response shape for GET /api/metrics/risk
 */
export interface RiskMetricsResponse {
  /** Count of events per risk severity level */
  distribution: { low: number; medium: number; high: number; critical: number };
  /** Daily count of high/critical deployments over the time range */
  trend: Array<{ date: string; highCriticalCount: number }>;
  /** Top 10 services by average risk score (descending) */
  averageByService: Array<{
    serviceId: string;
    serviceName: string;
    averageScore: number;
    eventCount: number;
  }>;
  /** Time range for the computation */
  period: { start: string; end: string };
  /** Active filters */
  filters: { team?: string; service?: string };
}

/**
 * Response shape for GET /api/metrics/correlation
 */
export interface CorrelationMetricsResponse {
  /** Percentage of incidents that are correlated (0-100) */
  correlationRate: number;
  /** Average time from detection to correlation in seconds */
  averageTimeToCorrelation: number;
  /** Count of incidents with "uncorrelated" status */
  uncorrelatedCount: number;
  /** Trend indicator for correlation rate vs. previous period */
  correlationRateTrend: TrendIndicator;
  /** Trend indicator for uncorrelated count vs. previous period */
  uncorrelatedTrend: TrendIndicator;
  /** Time range for the computation */
  period: { start: string; end: string };
  /** Active filters */
  filters: { team?: string; service?: string };
  /** Informational note (e.g., "No incidents in selected period") */
  note?: string;
}

/**
 * Response shape for GET /api/metrics/team-performance
 */
export interface TeamPerformanceResponse {
  /** Per-team metrics */
  teams: Array<{
    teamId: string;
    teamName: string;
    changeFailureRate: number;
    deploymentFrequency: number;
    riskProfile: { low: number; medium: number; high: number; critical: number };
    eventCount: number;
    insufficientData: boolean;
  }>;
  /** Current sort field */
  sortBy: "changeFailureRate" | "deploymentFrequency" | "averageRiskScore";
  /** Current sort direction */
  sortOrder: "asc" | "desc";
  /** Organization-wide averages (present when no team filter is active) */
  orgAverages?: {
    changeFailureRate: number;
    deploymentFrequency: number;
  };
  /** Time range for the computation */
  period: { start: string; end: string };
}

/**
 * Response shape for GET /api/metrics/service-health
 */
export interface ServiceHealthResponse {
  /** Services with high/critical deployments in the last 7 days */
  servicesAtRisk: Array<{
    serviceId: string;
    serviceName: string;
    highCriticalCount: number;
    mostRecentRiskScore: "high" | "critical";
  }>;
  /** Per-service DORA metrics */
  serviceMetrics: Array<{
    serviceId: string;
    serviceName: string;
    deploymentFrequency: number;
    leadTimeHours: number;
    changeFailureRate: number;
    mttrHours: number;
    insufficientData: boolean;
  }>;
  /** Blast radius aggregate and per-incident detail */
  blastRadius: {
    average: number;
    maximum: number;
    incidents: Array<{
      incidentId: string;
      blastRadius: number;
      affectedServices: string[];
    }>;
  };
  /** Time range for the computation */
  period: { start: string; end: string };
  /** Active filters */
  filters: { team?: string; service?: string };
}

/**
 * Response shape for GET /api/metrics/predictions
 */
export interface PredictionsMetricsResponse {
  /** ML prediction accuracy percentage, or "ml_inactive" if no predictions exist */
  predictionAccuracy: number | "ml_inactive";
  /** Count of deployments blocked by the gate */
  blockedCount: number;
  /** Count of deployments warned by the gate */
  warnedCount: number;
  /** False positive rate percentage, or "ml_inactive" if no predictions exist */
  falsePositiveRate: number | "ml_inactive";
  /** Count of early warning events issued */
  earlyWarningCount: number;
  /** Trend indicator for prediction accuracy */
  predictionAccuracyTrend?: TrendIndicator;
  /** Trend indicator for false positive rate */
  falsePositiveRateTrend?: TrendIndicator;
  /** Time range for the computation */
  period: { start: string; end: string };
  /** Active filters */
  filters: { team?: string; service?: string };
  /** Informational note (e.g., "ML model inactive") */
  note?: string;
}

/**
 * Response shape for GET /api/metrics/business-impact
 */
export interface BusinessImpactResponse {
  /** Estimated downtime avoided in hours */
  estimatedDowntimeAvoided: number;
  /** SLA compliance percentage (0-100) */
  slaCompliancePercentage: number;
  /** Incident count trend indicator */
  incidentTrend: TrendIndicator;
  /** Time range for the computation */
  period: { start: string; end: string };
  /** Active filters */
  filters: { team?: string; service?: string };
  /** Informational notes for edge cases */
  notes?: {
    downtimeAvoided?: string;
    slaCompliance?: string;
  };
}
