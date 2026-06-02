/**
 * Deployment Gate API
 *
 * Combines ML Prediction_Score + rule-based Risk_Score.
 * Returns: proceed (<0.5), warn (0.5-0.8), block (>0.8) — configurable per service.
 * Includes contributing factors and mitigations on "block".
 *
 * Requirements: 17.6, 17.7
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GateDecision = "proceed" | "warn" | "block";

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

// ─── Default Configuration ─────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: GateThresholds = {
  warnThreshold: 0.5,
  blockThreshold: 0.8,
};

// ─── Gate Logic ────────────────────────────────────────────────────────────────

/**
 * Combine ML prediction score and rule-based risk score.
 */
export function combineScores(
  predictionScore: number,
  riskScore: number
): number {
  // Weighted average: ML model gets slightly more weight when available
  return Math.min(1.0, predictionScore * 0.6 + riskScore * 0.4);
}

/**
 * Make a gate decision based on combined score and thresholds.
 */
export function makeGateDecision(
  combinedScore: number,
  thresholds: GateThresholds
): GateDecision {
  if (combinedScore > thresholds.blockThreshold) {
    return "block";
  }
  if (combinedScore >= thresholds.warnThreshold) {
    return "warn";
  }
  return "proceed";
}

/**
 * Generate mitigation suggestions for blocked deployments.
 */
export function generateMitigations(
  factors: string[],
  riskSeverity: string
): string[] {
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

/**
 * Evaluate the deployment gate.
 */
export function evaluateGate(request: GateRequest): GateResult {
  const thresholds: GateThresholds = {
    warnThreshold:
      request.customThresholds?.warnThreshold ?? DEFAULT_THRESHOLDS.warnThreshold,
    blockThreshold:
      request.customThresholds?.blockThreshold ?? DEFAULT_THRESHOLDS.blockThreshold,
  };

  const combinedScore = combineScores(
    request.predictionScore,
    request.riskScore
  );
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
    result.mitigations = generateMitigations(
      request.contributingFactors || [],
      request.riskSeverity
    );
  } else if (decision === "warn") {
    result.contributingFactors = request.contributingFactors || [];
  }

  return result;
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/gates/deploy — Evaluate deployment gate
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.serviceId || !body.eventId) {
      return NextResponse.json(
        { error: "serviceId and eventId are required" },
        { status: 400 }
      );
    }

    if (
      typeof body.predictionScore !== "number" ||
      typeof body.riskScore !== "number"
    ) {
      return NextResponse.json(
        { error: "predictionScore and riskScore must be numbers" },
        { status: 400 }
      );
    }

    const gateRequest: GateRequest = {
      serviceId: body.serviceId,
      eventId: body.eventId,
      predictionScore: Math.min(1, Math.max(0, body.predictionScore)),
      riskScore: Math.min(1, Math.max(0, body.riskScore)),
      riskSeverity: body.riskSeverity || "medium",
      contributingFactors: body.contributingFactors || [],
      customThresholds: body.customThresholds,
    };

    const result = evaluateGate(gateRequest);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
