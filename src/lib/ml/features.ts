/**
 * Feature Vector Construction for ML Inference
 *
 * Constructs Feature_Vectors from: change size, deployment timing, service failure
 * rate (30d), author failure rate (90d), time since last incident, dependency count,
 * eBPF anomaly score.
 *
 * Requirements: 15.10
 */

export interface FeatureVector {
  /** Number of files changed in the deployment */
  changeSizeFiles: number;
  /** Total lines changed (added + removed) */
  changeSizeLines: number;
  /** Hour of deployment (0-23 UTC) */
  deployHourOfDay: number;
  /** Day of week (0=Sunday, 6=Saturday) */
  deployDayOfWeek: number;
  /** Service failure rate over last 30 days (0.0-1.0) */
  serviceFailureRate30d: number;
  /** Author's failure rate over last 90 days (0.0-1.0) */
  authorFailureRate90d: number;
  /** Hours since last incident for this service */
  timeSinceLastIncident: number;
  /** Number of service dependencies */
  dependencyCount: number;
  /** eBPF anomaly score (0.0-1.0, optional) */
  ebpfAnomalyScore?: number;
}

export interface FeatureInput {
  /** Files changed in the deployment */
  filesChanged?: number;
  /** Lines added */
  linesAdded?: number;
  /** Lines removed */
  linesRemoved?: number;
  /** Deployment timestamp ISO 8601 */
  deploymentTimestamp: string;
  /** Total deployments for this service in last 30 days */
  serviceDeployments30d: number;
  /** Failed deployments for this service in last 30 days */
  serviceFailures30d: number;
  /** Total deployments by this author in last 90 days */
  authorDeployments90d: number;
  /** Failed deployments by this author in last 90 days */
  authorFailures90d: number;
  /** ISO 8601 timestamp of last incident for this service (null if none) */
  lastIncidentTimestamp: string | null;
  /** Number of downstream/upstream service dependencies */
  dependencyCount: number;
  /** eBPF anomaly score from agent telemetry (optional) */
  ebpfAnomalyScore?: number;
}

export interface FeatureValidationResult {
  valid: boolean;
  errors: string[];
  vector?: FeatureVector;
}

/**
 * Construct a feature vector from raw input data.
 * Normalizes and validates all features before returning.
 */
export function constructFeatureVector(input: FeatureInput): FeatureValidationResult {
  const errors: string[] = [];

  // Validate deployment timestamp
  const deployDate = new Date(input.deploymentTimestamp);
  if (isNaN(deployDate.getTime())) {
    errors.push("Invalid deploymentTimestamp");
  }

  // Validate non-negative counts
  if (input.serviceDeployments30d < 0) {
    errors.push("serviceDeployments30d must be non-negative");
  }
  if (input.serviceFailures30d < 0) {
    errors.push("serviceFailures30d must be non-negative");
  }
  if (input.authorDeployments90d < 0) {
    errors.push("authorDeployments90d must be non-negative");
  }
  if (input.authorFailures90d < 0) {
    errors.push("authorFailures90d must be non-negative");
  }
  if (input.dependencyCount < 0) {
    errors.push("dependencyCount must be non-negative");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const changeSizeFiles = Math.max(0, input.filesChanged ?? 0);
  const changeSizeLines =
    Math.max(0, input.linesAdded ?? 0) + Math.max(0, input.linesRemoved ?? 0);

  const deployHourOfDay = deployDate.getUTCHours();
  const deployDayOfWeek = deployDate.getUTCDay();

  // Compute failure rates (avoid division by zero)
  const serviceFailureRate30d =
    input.serviceDeployments30d > 0
      ? Math.min(1.0, input.serviceFailures30d / input.serviceDeployments30d)
      : 0;

  const authorFailureRate90d =
    input.authorDeployments90d > 0
      ? Math.min(1.0, input.authorFailures90d / input.authorDeployments90d)
      : 0;

  // Compute time since last incident in hours
  let timeSinceLastIncident = 720; // Default 30 days if no incident
  if (input.lastIncidentTimestamp) {
    const lastIncident = new Date(input.lastIncidentTimestamp);
    if (!isNaN(lastIncident.getTime())) {
      const diffMs = deployDate.getTime() - lastIncident.getTime();
      timeSinceLastIncident = Math.max(0, diffMs / (1000 * 60 * 60));
    }
  }

  const vector: FeatureVector = {
    changeSizeFiles,
    changeSizeLines,
    deployHourOfDay,
    deployDayOfWeek,
    serviceFailureRate30d,
    authorFailureRate90d,
    timeSinceLastIncident,
    dependencyCount: Math.max(0, input.dependencyCount),
    ...(input.ebpfAnomalyScore !== undefined && {
      ebpfAnomalyScore: Math.min(1.0, Math.max(0.0, input.ebpfAnomalyScore)),
    }),
  };

  return { valid: true, errors: [], vector };
}

/**
 * Normalize a feature vector to [0,1] ranges for ML model input.
 * Uses predefined scale factors based on observed distributions.
 */
export function normalizeFeatureVector(vector: FeatureVector): number[] {
  return [
    Math.min(1.0, vector.changeSizeFiles / 100), // Cap at 100 files
    Math.min(1.0, vector.changeSizeLines / 5000), // Cap at 5000 lines
    vector.deployHourOfDay / 23, // 0-23 -> 0-1
    vector.deployDayOfWeek / 6, // 0-6 -> 0-1
    vector.serviceFailureRate30d, // Already 0-1
    vector.authorFailureRate90d, // Already 0-1
    Math.min(1.0, vector.timeSinceLastIncident / 720), // Cap at 30 days
    Math.min(1.0, vector.dependencyCount / 50), // Cap at 50 deps
    vector.ebpfAnomalyScore ?? 0, // Already 0-1
  ];
}

/**
 * Rule-based fallback scoring when ML model is unavailable.
 * Uses a simple weighted formula matching the Risk Scoring Engine approach.
 */
export function ruleBasedScore(vector: FeatureVector): number {
  const weights = {
    serviceFailureRate: 0.30,
    authorFailureRate: 0.20,
    changeSize: 0.20,
    timing: 0.15,
    recency: 0.15,
  };

  // Normalize change size (files + lines combined)
  const changeSizeNorm = Math.min(
    1.0,
    (vector.changeSizeFiles / 50 + vector.changeSizeLines / 2000) / 2
  );

  // High-risk hours: late night (22-6) and weekends
  const isHighRiskHour =
    vector.deployHourOfDay >= 22 || vector.deployHourOfDay <= 6;
  const isWeekend = vector.deployDayOfWeek === 0 || vector.deployDayOfWeek === 6;
  const timingRisk = (isHighRiskHour ? 0.5 : 0) + (isWeekend ? 0.5 : 0);

  // Recent incident increases risk
  const recencyRisk = vector.timeSinceLastIncident < 24 ? 0.8 : vector.timeSinceLastIncident < 72 ? 0.4 : 0.1;

  const score =
    weights.serviceFailureRate * vector.serviceFailureRate30d +
    weights.authorFailureRate * vector.authorFailureRate90d +
    weights.changeSize * changeSizeNorm +
    weights.timing * timingRisk +
    weights.recency * recencyRisk;

  return Math.min(1.0, Math.max(0.0, score));
}
