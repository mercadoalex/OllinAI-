/**
 * Correlation Metrics API
 *
 * GET /api/metrics/correlation?from=DATE&to=DATE&team=X&service=Y
 *
 * Returns computed correlation metrics (correlation rate, average time-to-correlation,
 * uncorrelated count, and trend indicators) for the specified scope and time range.
 *
 * Authentication: Required
 * Tier: Pro+ (incident_correlation feature)
 *
 * Requirements: 7.1, 9.2, 9.6
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMetricQueryParams } from "@/app/api/metrics/shared";
import { computeCorrelationMetrics } from "@/lib/metrics/computers/correlation";

// TODO: Add withTierGate when tier middleware is integrated

export async function GET(request: NextRequest) {
  try {
    const result = await parseMetricQueryParams(request);

    if (!result.success) {
      return result.response;
    }

    const metrics = await computeCorrelationMetrics(result.context);

    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    console.error("Correlation metrics query failed:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve correlation metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
