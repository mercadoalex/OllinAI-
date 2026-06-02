/**
 * DynamoDB item type definitions matching the OllinAI table schemas.
 *
 * Tables:
 * - ollinai-events: Deployment events with risk scores and correlations
 * - ollinai-incidents: Production incidents with correlation status
 * - ollinai-metrics: Computed DORA metrics per scope and period
 * - ollinai-config: Multi-purpose config (teams, services, integrations, subscriptions, etc.)
 * - ollinai-audit: Append-only audit log entries
 */

// ─── ollinai-events ────────────────────────────────────────────────────────────

/**
 * DynamoDB item for the ollinai-events table.
 * PK: TENANT#{tenantId}#SVC#{serviceId}
 * SK: DEPLOY#{timestamp}#{eventId}
 *
 * GSI-1 (Correlation lookup): PK=TENANT#{tenantId}#SVC#{serviceId}, SK=TS#{deploymentTimestamp}
 * GSI-2 (Team view): PK=TENANT#{tenantId}#TEAM#{teamId}, SK=DEPLOY#{timestamp}
 * GSI-3 (Deduplication): PK=TENANT#{tenantId}#DEDUP, SK={commitSha}#{service}#{env}
 */
export interface EventItem {
  /** Partition key: TENANT#{tenantId}#SVC#{serviceId} */
  PK: string;
  /** Sort key: DEPLOY#{timestamp}#{eventId} */
  SK: string;
  /** UUID event identifier */
  eventId: string;
  /** 1-50 commit SHAs */
  commitShas: string[];
  /** Author identifier */
  author: string;
  /** Affected service names */
  services: string[];
  /** Target environment */
  environment: string;
  /** Change size metadata */
  changeSize?: {
    linesAdded?: number;
    linesRemoved?: number;
    filesChanged?: number;
  };
  /** Owning team ID (or "UNASSIGNED") */
  teamId: string;
  /** Computed risk score classification */
  riskScore?: "low" | "medium" | "high" | "critical" | "indeterminate";
  /** Breakdown of individual risk factor values */
  riskFactors?: {
    changeFailureRate?: number;
    changeSize?: number;
    deploymentTiming?: number;
    authorFailureRate?: number;
    supplyChainAnomaly?: number;
    resourceAnomaly?: number;
  };
  /** IDs of incidents correlated with this deployment */
  correlatedIncidents?: string[];
  /** ML prediction score (0.0-1.0) */
  predictionScore?: number;
  /** Source of the prediction */
  predictionSource?: "rule_engine" | "ml_model";
  /** ISO 8601 creation timestamp */
  createdAt: string;

  // ─── GSI attributes ────────────────────────────────────────────────────────
  /** GSI-1 SK: TS#{deploymentTimestamp} */
  GSI1SK?: string;
  /** GSI-2 PK: TENANT#{tenantId}#TEAM#{teamId} */
  GSI2PK?: string;
  /** GSI-2 SK: DEPLOY#{timestamp} */
  GSI2SK?: string;
  /** GSI-3 PK: TENANT#{tenantId}#DEDUP */
  GSI3PK?: string;
  /** GSI-3 SK: {commitSha}#{service}#{env} */
  GSI3SK?: string;
}

// ─── ollinai-incidents ─────────────────────────────────────────────────────────

/**
 * DynamoDB item for the ollinai-incidents table.
 * PK: TENANT#{tenantId}#SVC#{serviceId}
 * SK: INC#{detectionTimestamp}#{incidentId}
 *
 * GSI-1 (Time range queries): PK=TENANT#{tenantId}, SK=INC#{detectionTimestamp}
 */
export interface IncidentItem {
  /** Partition key: TENANT#{tenantId}#SVC#{serviceId} */
  PK: string;
  /** Sort key: INC#{detectionTimestamp}#{incidentId} */
  SK: string;
  /** UUID incident identifier */
  incidentId: string;
  /** External system ID */
  externalId: string;
  /** Severity classification */
  severity: "low" | "medium" | "high" | "critical";
  /** ISO 8601 detection timestamp */
  detectionTimestamp: string;
  /** ISO 8601 resolution timestamp (null if unresolved) */
  resolutionTimestamp?: string;
  /** Ranked deployment event IDs correlated with this incident */
  correlatedDeployments?: string[];
  /** Whether correlation has been performed */
  correlationStatus: "correlated" | "uncorrelated" | "pending";

  // ─── GSI attributes ────────────────────────────────────────────────────────
  /** GSI-1 PK: TENANT#{tenantId} */
  GSI1PK?: string;
  /** GSI-1 SK: INC#{detectionTimestamp} */
  GSI1SK?: string;
}

// ─── ollinai-metrics ───────────────────────────────────────────────────────────

/**
 * DynamoDB item for the ollinai-metrics table.
 * PK: TENANT#{tenantId}#SCOPE#{scopeType}#{scopeId}
 * SK: PERIOD#{periodStart}#{periodEnd}
 *
 * scopeType: "TEAM" | "SERVICE" | "ENVIRONMENT" | "ALL"
 */
export interface MetricsItem {
  /** Partition key: TENANT#{tenantId}#SCOPE#{scopeType}#{scopeId} */
  PK: string;
  /** Sort key: PERIOD#{periodStart}#{periodEnd} */
  SK: string;
  /** Deployment count in the period */
  deploymentFrequency: number;
  /** Average lead time in hours */
  leadTimeHours: number;
  /** Change failure rate percentage (0-100) */
  changeFailureRate: number;
  /** Mean time to recovery in hours */
  mttrHours: number;
  /** Number of unresolved incidents */
  unresolvedCount: number;
  /** Number of data points used (for "insufficient data" check, minimum 3) */
  dataPoints: number;
  /** ISO 8601 last computation timestamp */
  computedAt: string;
}

// ─── ollinai-config ────────────────────────────────────────────────────────────

/**
 * DynamoDB item for the ollinai-config table.
 * PK: TENANT#{tenantId}
 * SK: Entity type prefix (TEAM#, SVC#, INTEGRATION#, SUBSCRIPTION#, USER#, etc.)
 *
 * This is a multi-purpose table storing all tenant configuration.
 */
export interface ConfigItem {
  /** Partition key: TENANT#{tenantId} */
  PK: string;
  /** Sort key: varies by entity type */
  SK: string;
  /** Entity-specific fields */
  entityData: Record<string, unknown>;
}

/** Team entity stored in ollinai-config with SK prefix TEAM#{teamId} */
export interface TeamConfigItem extends ConfigItem {
  entityData: {
    teamId: string;
    name: string;
    members: string[];
    archived: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

/** Service entity stored in ollinai-config with SK prefix SVC#{serviceId} */
export interface ServiceConfigItem extends ConfigItem {
  entityData: {
    serviceId: string;
    name: string;
    owningTeamId: string;
    ownershipHistory: {
      teamId: string;
      from: string; // ISO 8601
      to?: string;  // ISO 8601
    }[];
    createdAt: string;
    updatedAt: string;
  };
}

/** Integration entity stored in ollinai-config with SK prefix INTEGRATION#{integrationId} */
export interface IntegrationConfigItem extends ConfigItem {
  entityData: {
    integrationId: string;
    name: string;
    type: string;
    secretKeyHash: string;
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
  };
}

/** Subscription tier type */
export type SubscriptionTier = "starter" | "pro" | "enterprise";

/** Subscription entity stored in ollinai-config with SK SUBSCRIPTION#current */
export interface SubscriptionConfigItem extends ConfigItem {
  entityData: {
    tier: SubscriptionTier;
    activatedAt: string;
    previousTier?: SubscriptionTier;
    tierChangedAt?: string;
  };
}

/** Correlation window configuration stored with SK SETTINGS#correlation_window */
export interface CorrelationWindowConfigItem extends ConfigItem {
  entityData: {
    windowMinutes: number; // 5-1440 (5 min to 24 hours)
    updatedAt: string;
    updatedBy: string;
  };
}

/** Risk weight configuration stored with SK SETTINGS#risk_weights */
export interface RiskWeightsConfigItem extends ConfigItem {
  entityData: {
    changeFailureRate: number;
    changeSize: number;
    deploymentTiming: number;
    authorFailureRate: number;
    updatedAt: string;
    updatedBy: string;
  };
}

/** Recommendation stored in ollinai-config with SK prefix REC#{recommendationId} */
export interface RecommendationConfigItem extends ConfigItem {
  entityData: {
    id: string;
    category: "reduce_change_size" | "adjust_timing" | "increase_review" | "split_service" | "add_canary";
    targetService: string;
    targetTeam: string;
    triggeringMetrics: Record<string, number>;
    timeRangeEvaluated: { start: string; end: string };
    generatedAt: string;
    dismissedAt?: string;
    suppressedUntil?: string;
  };
}

// ─── ollinai-audit ─────────────────────────────────────────────────────────────

/**
 * DynamoDB item for the ollinai-audit table.
 * PK: TENANT#{tenantId}
 * SK: AUDIT#{timestamp}#{auditId}
 *
 * Append-only table: no delete/update operations exposed.
 * 365-day minimum retention regardless of tier.
 */
export interface AuditItem {
  /** Partition key: TENANT#{tenantId} */
  PK: string;
  /** Sort key: AUDIT#{timestamp}#{auditId} */
  SK: string;
  /** User ID of the actor */
  actor: string;
  /** Action performed (e.g., "team.create", "service.update", "api.export") */
  action: string;
  /** Resource identifier (e.g., "TEAM#team-123", "SVC#svc-456") */
  targetResource: string;
  /** Source IP address of the request */
  sourceIp: string;
  /** Outcome of the operation */
  outcome: "success" | "failure";
  /** ISO 8601 timestamp with millisecond precision */
  timestamp: string;
}
