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
import { evaluateGate, GateRequest } from "@/lib/gates/gate-logic";

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
