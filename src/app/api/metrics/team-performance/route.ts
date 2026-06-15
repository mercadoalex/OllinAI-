/**
 * Team Performance Metrics API
 *
 * GET /api/metrics/team-performance?from=DATE&to=DATE&team=X&service=Y
 *
 * Returns computed team performance metrics (per-team CFR, deployment frequency,
 * risk profiles, org averages) for the specified scope and time range.
 *
 * Authentication: Required
 * Tier: Pro+ (risk_score feature)
 *
 * Requirements: 7.1, 9.2, 9.6
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMetricQueryParams } from "@/app/api/metrics/shared";
import { computeTeamPerformance } from "@/lib/metrics/computers/team-performance";

// TODO: Add withTierGate when tier middleware is integrated

export async function GET(request: NextRequest) {
  try {
    const result = await parseMetricQueryParams(request);

    if (!result.success) {
      return result.response;
    }

    const metrics = await computeTeamPerformance(result.context);

    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    console.error("Team performance metrics query failed:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve team performance metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
