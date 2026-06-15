/**
 * Risk Metrics API
 *
 * GET /api/metrics/risk?from=DATE&to=DATE&team=X&service=Y
 *
 * Returns computed risk metrics (distribution, trend, per-service averages)
 * for the specified scope and time range.
 *
 * Authentication: Required
 * Tier: Pro+ (risk_score feature)
 *
 * Requirements: 7.1, 9.2, 9.6
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMetricQueryParams } from "@/app/api/metrics/shared";
import { computeRiskMetrics } from "@/lib/metrics/computers/risk";

// TODO: Add withTierGate when tier middleware is integrated

export async function GET(request: NextRequest) {
  try {
    const result = await parseMetricQueryParams(request);

    if (!result.success) {
      return result.response;
    }

    const metrics = await computeRiskMetrics(result.context);

    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    console.error("Risk metrics query failed:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve risk metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
