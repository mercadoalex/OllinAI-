/**
 * Deployment Gate Logic — extracted for testability.
 */

export type GateDecision = "proceed" | "warn" | "block";

export interface GateThresholds {
  warnThreshold: number;
  blockThreshold: number;
}

export interface GateRequest {
  serviceId: string;
  eventId: string;
  predictionScore: number;
  riskScore: number;
  riskSeverity: "low" | "medium" | "high" | "critical";
  contributingFactors?: string[];
  customThresholds?: {
    warnThreshold?: number;
    blockThreshold?: number;
  };
}

export interface GateResult {
  decision: GateDecision;
  combinedScore: number;
  predictionScore: number;
  riskScore: number;
  riskSeverity: string;
  thresholds: GateThresholds;
  contributingFactors?: string[];
  mitigations?: string[];
  serviceId: string;
  evaluatedAt: string;
}

const DEFAULT_THRESHOLDS: GateThresholds = {
  warnThreshold: 0.5,
  blockThreshold: 0.8,
};

export function combineScores(predictionScore: number, riskScore: number): number {
  return Math.min(1.0, predictionScore * 0.6 + riskScore * 0.4);
}

export function makeGateDecision(combinedScore: number, thresholds: GateThresholds): GateDecision {
  if (combinedScore > thresholds.blockThreshold) return "block";
  if (combinedScore >= thresholds.warnThreshold) return "warn";
  return "proceed";
}

export function generateMitigations(factors: string[], riskSeverity: string): string[] {
  const mitigations: string[] = [];

  if (factors.includes("high_failure_rate") || factors.includes("changeFailureRate")) {
    mitigations.push("Add canary deployment to reduce blast radius");
    mitigations.push("Split change into smaller increments");
  }
  if (factors.includes("large_change_size") || factors.includes("changeSize")) {
    mitigations.push("Break deployment into smaller, reviewable chunks");
  }
  if (factors.includes("risky_timing") || factors.includes("deploymentTiming")) {
    mitigations.push("Reschedule deployment to normal business hours");
  }
  if (factors.includes("author_risk") || factors.includes("authorFailureRate")) {
    mitigations.push("Request additional code review");
  }
  if (riskSeverity === "critical") {
    mitigations.push("Consider rollback plan before proceeding");
    mitigations.push("Ensure on-call coverage during deployment");
  }

  return mitigations.length > 0
    ? mitigations
    : ["Review contributing factors and assess deployment readiness"];
}

export function evaluateGate(request: GateRequest): GateResult {
  const thresholds: GateThresholds = {
    warnThreshold: request.customThresholds?.warnThreshold ?? DEFAULT_THRESHOLDS.warnThreshold,
    blockThreshold: request.customThresholds?.blockThreshold ?? DEFAULT_THRESHOLDS.blockThreshold,
  };

  const combinedScore = combineScores(request.predictionScore, request.riskScore);
  const decision = makeGateDecision(combinedScore, thresholds);

  const result: GateResult = {
    decision,
    combinedScore,
    predictionScore: request.predictionScore,
    riskScore: request.riskScore,
    riskSeverity: request.riskSeverity,
    thresholds,
    serviceId: request.serviceId,
    evaluatedAt: new Date().toISOString(),
  };

  if (decision === "block") {
    result.contributingFactors = request.contributingFactors || [];
    result.mitigations = generateMitigations(request.contributingFactors || [], request.riskSeverity);
  } else if (decision === "warn") {
    result.contributingFactors = request.contributingFactors || [];
  }

  return result;
}
