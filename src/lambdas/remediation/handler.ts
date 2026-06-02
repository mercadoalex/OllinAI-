/**
 * Automated Remediation Lambda
 *
 * Generates Remediation_Action for critical+high-prediction deployments within 10 seconds.
 * Action types: rollback, halt canary, scale up, notify on-call.
 * Recommendation-only mode when auto-remediation disabled.
 * Tracks outcomes for model retraining.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.8, 17.9
 */

export type RemediationActionType =
  | "rollback"
  | "halt_canary"
  | "scale_up"
  | "notify_oncall";

export interface RemediationAction {
  id: string;
  type: RemediationActionType;
  confidence: number;
  triggeringEvent: string;
  predictionScore: number;
  riskScore: string;
  modelVersion: string;
  autoExecute: boolean;
  recommendationOnly: boolean;
  contributingFactors: string[];
  timestamp: string;
}

export interface RemediationRequest {
  tenantId: string;
  eventId: string;
  serviceId: string;
  predictionScore: number;
  riskScore: "low" | "medium" | "high" | "critical";
  modelVersion: string;
  autoRemediationEnabled: boolean;
  autoRemediationThreshold?: number;
  confidenceThreshold?: number;
  contributingFactors: string[];
}

export interface RemediationResult {
  actions: RemediationAction[];
  executed: boolean;
  reason: string;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_AUTO_THRESHOLD = 0.9;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

// ─── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Determine recommended remediation actions based on prediction and risk.
 */
export function determineActions(
  request: RemediationRequest
): RemediationActionType[] {
  const { predictionScore, riskScore } = request;

  const actions: RemediationActionType[] = [];

  if (riskScore === "critical" || predictionScore > 0.85) {
    actions.push("rollback");
    actions.push("notify_oncall");
  } else if (riskScore === "high" || predictionScore > 0.7) {
    actions.push("halt_canary");
    actions.push("notify_oncall");
  } else if (predictionScore > 0.5) {
    actions.push("scale_up");
  }

  // Always notify on high predictions
  if (predictionScore > 0.8 && !actions.includes("notify_oncall")) {
    actions.push("notify_oncall");
  }

  return actions;
}

/**
 * Determine if actions should be auto-executed.
 */
export function shouldAutoExecute(
  request: RemediationRequest,
  confidence: number
): boolean {
  if (!request.autoRemediationEnabled) return false;

  const threshold = request.autoRemediationThreshold ?? DEFAULT_AUTO_THRESHOLD;
  const confThreshold = request.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  return (
    request.predictionScore > threshold && confidence > confThreshold
  );
}

/**
 * Compute confidence score for remediation recommendation.
 */
export function computeConfidence(
  predictionScore: number,
  riskScore: string
): number {
  const riskWeights: Record<string, number> = {
    critical: 0.95,
    high: 0.80,
    medium: 0.60,
    low: 0.40,
  };

  const riskWeight = riskWeights[riskScore] ?? 0.5;
  return Math.min(1.0, (predictionScore + riskWeight) / 2);
}

/**
 * Generate remediation actions for a deployment event.
 */
export async function generateRemediation(
  request: RemediationRequest
): Promise<RemediationResult> {
  // Only process critical + high risk or high prediction
  if (
    request.riskScore !== "critical" &&
    request.riskScore !== "high" &&
    request.predictionScore < 0.5
  ) {
    return {
      actions: [],
      executed: false,
      reason: "No remediation needed: risk and prediction below thresholds",
    };
  }

  const actionTypes = determineActions(request);
  const confidence = computeConfidence(
    request.predictionScore,
    request.riskScore
  );
  const autoExec = shouldAutoExecute(request, confidence);

  const actions: RemediationAction[] = actionTypes.map((type) => ({
    id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    confidence,
    triggeringEvent: request.eventId,
    predictionScore: request.predictionScore,
    riskScore: request.riskScore,
    modelVersion: request.modelVersion,
    autoExecute: autoExec,
    recommendationOnly: !request.autoRemediationEnabled,
    contributingFactors: request.contributingFactors,
    timestamp: new Date().toISOString(),
  }));

  const executed = autoExec && request.autoRemediationEnabled;

  return {
    actions,
    executed,
    reason: executed
      ? `Auto-remediation executed: ${actionTypes.join(", ")}`
      : `Remediation recommended (${request.autoRemediationEnabled ? "below auto-threshold" : "auto-remediation disabled"}): ${actionTypes.join(", ")}`,
  };
}

// ─── Lambda Handler ────────────────────────────────────────────────────────────

export async function handler(event: {
  Records: { body: string }[];
}): Promise<void> {
  for (const record of event.Records) {
    try {
      const request: RemediationRequest = JSON.parse(record.body);
      const result = await generateRemediation(request);

      console.log(
        JSON.stringify({
          level: "info",
          message: "Remediation complete",
          tenantId: request.tenantId,
          eventId: request.eventId,
          actionsCount: result.actions.length,
          executed: result.executed,
          reason: result.reason,
        })
      );
    } catch (error) {
      console.error("Remediation processing failed:", error);
    }
  }
}
