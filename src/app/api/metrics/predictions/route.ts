/**
 * Predictions & Prevention Metrics API
 *
 * GET /api/metrics/predictions?from=DATE&to=DATE&team=X&service=Y
 *
 * Returns computed prediction metrics (accuracy, blocked/warned counts,
 * false positive rate, early warning count) for the specified scope and time range.
 *
 * Authentication: Required
 * Tier: Enterprise only (aiops_predictions feature)
 *
 * Requirements: 7.1, 9.3, 9.6
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMetricQueryParams } from "@/app/api/metrics/shared";
import { computePredictions } from "@/lib/metrics/computers/predictions";

// TODO: Add withTierGate when tier middleware is integrated

export async function GET(request: NextRequest) {
  try {
    const result = await parseMetricQueryParams(request);

    if (!result.success) {
      return result.response;
    }

    const metrics = await computePredictions(result.context);

    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    console.error("Predictions metrics query failed:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve predictions metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
