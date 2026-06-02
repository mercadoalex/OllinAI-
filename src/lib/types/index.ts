/**
 * Core TypeScript interfaces and types for the OllinAI platform.
 *
 * These types define the contracts for webhook payloads, processing results,
 * metrics computation, recommendations, and API responses.
 */

// ─── Webhook Ingestion Payloads ────────────────────────────────────────────────

/**
 * Payload received from CI/CD pipelines via the deployment webhook endpoint.
 * POST /api/webhooks/deployments
 */
export interface DeploymentEventPayload {
  /** 1-50 commit SHAs included in this deployment */
  commitShas: string[];
  /** Author identifier (e.g., GitHub username, email) */
  author: string;
  /** 1-20 affected service names */
  services: string[];
  /** ISO 8601 timestamp of the deployment */
  deploymentTimestamp: string;
  /** Target environment (e.g., "production", "staging") */
  environment: string;
  /** Optional change size metadata */
  changeSize?: {
    linesAdded?: number;
    linesRemoved?: number;
    filesChanged?: number;
  };
}

/**
 * Payload received from incident management systems (PagerDuty, OpsGenie, etc.)
 * POST /api/webhooks/incidents
 */
export interface IncidentPayload {
  /** External system identifier for the incident */
  externalId: string;
  /** Incident severity level */
  severity: "low" | "medium" | "high" | "critical";
  /** The service affected by the incident */
  affectedService: string;
  /** ISO 8601 detection timestamp */
  detectionTimestamp: string;
  /** ISO 8601 resolution timestamp (null if unresolved) */
  resolutionTimestamp?: string;
}

// ─── Webhook Response ──────────────────────────────────────────────────────────

/**
 * Response returned by the deployment webhook endpoint on successful ingestion.
 */
export interface WebhookResponse {
  /** UUID assigned to the persisted event */
  eventId: string;
  /** Whether the event was newly created or already existed (deduplication) */
  status: "created" | "duplicate";
}

// ─── Correlation Engine ────────────────────────────────────────────────────────

/**
 * Result of the incident-to-deployment correlation process.
 */
export interface CorrelationResult {
  /** The incident that was correlated */
  incidentId: string;
  /** Deployments correlated to the incident, ranked by temporal proximity */
  correlatedDeployments: {
    /** UUID of the correlated deployment event */
    eventId: string;
    /** Time difference in milliseconds between deployment and incident detection */
    temporalProximityMs: number;
    /** Rank (1 = most recent/closest deployment) */
    rank: number;
  }[];
  /** Whether the incident was successfully correlated with deployments */
  status: "correlated" | "uncorrelated";
}

// ─── Risk Scoring ──────────────────────────────────────────────────────────────

/**
 * Individual risk factors contributing to an overall risk score.
 * Each factor is normalized to [0, 1].
 */
export interface RiskFactors {
  /** Historical change failure rate for the service (0-1), default weight 0.35 */
  changeFailureRate: number;
  /** Normalized change size metric (0-1), default weight 0.25 */
  changeSize: number;
  /** Time-of-day/day-of-week failure correlation (0-1), default weight 0.20 */
  deploymentTiming: number;
  /** Author's historical failure rate (0-1), default weight 0.20 */
  authorFailureRate: number;
  /** Phase 2: Supply chain anomaly score from eBPF agent (optional) */
  supplyChainAnomaly?: number;
  /** Phase 2: Resource anomaly score from eBPF agent (optional) */
  resourceAnomaly?: number;
}

/** Risk score severity classification */
export type RiskSeverity = "low" | "medium" | "high" | "critical";

/**
 * Computed risk score result for a deployment event.
 */
export interface RiskScoreResult {
  /** Categorical risk classification */
  score: RiskSeverity;
  /** Individual risk factor values */
  factors: RiskFactors;
  /** Weights applied to each factor (must sum to 1.0) */
  weights: Record<keyof RiskFactors, number>;
  /** Source of the risk computation */
  source: "rule_engine" | "ml_model";
}

// ─── DORA Metrics ──────────────────────────────────────────────────────────────

/**
 * Computed DORA metrics for a given scope (team, service, environment) and period.
 */
export interface DORAMetrics {
  /** Count of deployments per period, or "insufficient_data" if < 3 data points */
  deploymentFrequency: number | "insufficient_data";
  /** Average lead time in hours from first commit to deployment */
  leadTimeHours: number | "insufficient_data";
  /** Percentage of deployments with correlated incidents (0-100) */
  changeFailureRate: number | "insufficient_data";
  /** Average time to recovery in hours (resolved incidents only) */
  mttrHours: number | "insufficient_data";
  /** Count of unresolved incidents in the period */
  unresolvedIncidentCount: number;
  /** Time period for the metrics */
  period: {
    start: string; // ISO 8601
    end: string;   // ISO 8601
  };
  /** Applied filters */
  filters: {
    team?: string;
    service?: string;
    environment?: string;
  };
}

// ─── Recommendations ───────────────────────────────────────────────────────────

/** Categories of recommendations the system can generate */
export type RecommendationCategory =
  | "reduce_change_size"
  | "adjust_timing"
  | "increase_review"
  | "split_service"
  | "add_canary";

/**
 * An actionable recommendation generated for high/critical risk deployments.
 */
export interface Recommendation {
  /** Unique recommendation identifier */
  id: string;
  /** Type of recommendation */
  category: RecommendationCategory;
  /** Service the recommendation targets */
  targetService: string;
  /** Team the recommendation targets */
  targetTeam: string;
  /** Metric values that triggered this recommendation */
  triggeringMetrics: Record<string, number>;
  /** Time range that was evaluated */
  timeRangeEvaluated: {
    start: string; // ISO 8601
    end: string;   // ISO 8601
  };
  /** When the recommendation was generated */
  generatedAt: string; // ISO 8601
  /** When the recommendation was dismissed (if applicable) */
  dismissedAt?: string; // ISO 8601
  /** Suppression end date (recommendations of same category/team/service suppressed for 14 days) */
  suppressedUntil?: string; // ISO 8601
}

// ─── Paginated Response ────────────────────────────────────────────────────────

/**
 * Generic paginated API response wrapper.
 * Used for data export endpoints (Enterprise tier).
 */
export interface PaginatedResponse<T> {
  /** Array of records for the current page */
  data: T[];
  /** Pagination metadata */
  pagination: {
    /** Total number of records matching the query */
    totalCount: number;
    /** Current page number (1-indexed) */
    currentPage: number;
    /** Number of records per page (default 25, max 100) */
    pageSize: number;
    /** Whether more pages exist beyond the current page */
    hasMore: boolean;
  };
}
