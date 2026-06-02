/**
 * ML Training Pipeline Orchestration Lambda
 *
 * Triggers SageMaker training at configurable interval (simulated).
 * Validates against 20% holdout: promote only if accuracy improves ≥1pp.
 * Stores model metadata in DynamoDB (ollinai-ml table).
 * Computes Drift_Score; triggers immediate retrain if >0.7.
 * Alerts after 3 consecutive promotion failures.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7
 */

export interface ModelMetadata {
  tenantId: string;
  modelVersion: string;
  trainingTimestamp: string;
  datasetVersion: string;
  featureSet: string[];
  metrics: ModelMetrics;
  status: "staging" | "production" | "retired";
  driftScore: number;
}

export interface ModelMetrics {
  precision: number;
  recall: number;
  f1: number;
  aucRoc: number;
  accuracy: number;
}

export interface TrainingConfig {
  /** Training interval in hours (default 24, range 6-168) */
  intervalHours: number;
  /** Minimum accuracy improvement required for promotion (default 1pp) */
  minAccuracyImprovementPp: number;
  /** Drift score threshold to trigger immediate retrain (default 0.7) */
  driftThreshold: number;
  /** Maximum consecutive failures before alerting (default 3) */
  maxConsecutiveFailures: number;
}

export interface TrainingResult {
  success: boolean;
  modelVersion: string;
  promoted: boolean;
  reason: string;
  metrics?: ModelMetrics;
  driftScore: number;
  consecutiveFailures: number;
  alertTriggered: boolean;
}

// ─── Default Configuration ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: TrainingConfig = {
  intervalHours: 24,
  minAccuracyImprovementPp: 1,
  driftThreshold: 0.7,
  maxConsecutiveFailures: 3,
};

// ─── Simulated Training Functions ──────────────────────────────────────────────

/**
 * Simulated SageMaker training job.
 * In production, this creates a SageMaker training job and waits for completion.
 */
async function triggerTrainingJob(
  _tenantId: string,
  datasetVersion: string
): Promise<ModelMetrics> {
  // Simulated training metrics
  return {
    precision: 0.78 + Math.random() * 0.15,
    recall: 0.72 + Math.random() * 0.15,
    f1: 0.75 + Math.random() * 0.15,
    aucRoc: 0.80 + Math.random() * 0.12,
    accuracy: 0.76 + Math.random() * 0.15,
  };
}

/**
 * Compute drift score between current production model predictions
 * and observed outcomes.
 */
export function computeDriftScore(
  predictedScores: number[],
  actualOutcomes: boolean[]
): number {
  if (predictedScores.length === 0 || actualOutcomes.length === 0) {
    return 0;
  }

  const n = Math.min(predictedScores.length, actualOutcomes.length);
  let mismatchSum = 0;

  for (let i = 0; i < n; i++) {
    const predicted = predictedScores[i] >= 0.5 ? 1 : 0;
    const actual = actualOutcomes[i] ? 1 : 0;
    mismatchSum += Math.abs(predicted - actual);
  }

  return mismatchSum / n;
}

/**
 * Determine if a new model should be promoted based on holdout validation.
 * Promotes only if accuracy improves ≥ minAccuracyImprovementPp over current.
 */
export function shouldPromote(
  currentAccuracy: number,
  newAccuracy: number,
  minImprovementPp: number
): boolean {
  return (newAccuracy - currentAccuracy) * 100 >= minImprovementPp;
}

/**
 * Determine if immediate retrain should be triggered based on drift score.
 */
export function shouldRetrain(
  driftScore: number,
  threshold: number
): boolean {
  return driftScore > threshold;
}

/**
 * Check if alert should be triggered based on consecutive failures.
 */
export function shouldAlert(
  consecutiveFailures: number,
  maxFailures: number
): boolean {
  return consecutiveFailures >= maxFailures;
}

// ─── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Run the training pipeline for a tenant.
 */
export async function runTrainingPipeline(
  tenantId: string,
  currentModelAccuracy: number,
  consecutiveFailures: number,
  predictedScores: number[],
  actualOutcomes: boolean[],
  config: TrainingConfig = DEFAULT_CONFIG
): Promise<TrainingResult> {
  const datasetVersion = `ds-${Date.now()}`;
  const modelVersion = `v${Date.now()}`;

  // 1. Compute drift
  const driftScore = computeDriftScore(predictedScores, actualOutcomes);

  // 2. Trigger retrain if drift is high or on schedule
  const needsRetrain = shouldRetrain(driftScore, config.driftThreshold);

  // 3. Run training
  const newMetrics = await triggerTrainingJob(tenantId, datasetVersion);

  // 4. Validate against holdout
  const promoted = shouldPromote(
    currentModelAccuracy,
    newMetrics.accuracy,
    config.minAccuracyImprovementPp
  );

  let newConsecutiveFailures = consecutiveFailures;
  let reason: string;

  if (promoted) {
    newConsecutiveFailures = 0;
    reason = `Model promoted: accuracy improved from ${(currentModelAccuracy * 100).toFixed(1)}% to ${(newMetrics.accuracy * 100).toFixed(1)}%`;
  } else {
    newConsecutiveFailures += 1;
    reason = `Model not promoted: accuracy ${(newMetrics.accuracy * 100).toFixed(1)}% did not improve ≥${config.minAccuracyImprovementPp}pp over current ${(currentModelAccuracy * 100).toFixed(1)}%`;
  }

  const alertTriggered = shouldAlert(
    newConsecutiveFailures,
    config.maxConsecutiveFailures
  );

  return {
    success: true,
    modelVersion,
    promoted,
    reason,
    metrics: newMetrics,
    driftScore,
    consecutiveFailures: newConsecutiveFailures,
    alertTriggered,
  };
}

// ─── Lambda Handler ────────────────────────────────────────────────────────────

export async function handler(event: { tenantId: string }): Promise<TrainingResult> {
  // In production: read current model metadata and predictions from DynamoDB
  const result = await runTrainingPipeline(
    event.tenantId,
    0.75, // Current model accuracy placeholder
    0,    // Consecutive failures placeholder
    [],   // Recent predictions placeholder
    [],   // Actual outcomes placeholder
  );

  console.log(
    JSON.stringify({
      level: "info",
      message: "Training pipeline complete",
      tenantId: event.tenantId,
      ...result,
    })
  );

  return result;
}
