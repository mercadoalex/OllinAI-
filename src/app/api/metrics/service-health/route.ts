/**
 * Service Health Metrics API
 *
 * GET /api/metrics/service-health?from=DATE&to=DATE&team=X&service=Y
 *
 * Returns computed service health metrics (services at risk, service-level DORA,
 * blast radius) for the specified scope and time range.
 *
 * Authentication: Required
 * Tier: Pro+ (risk_score feature)
 *
 * Requirements: 7.1, 9.2, 9.6
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMetricQueryParams } from "@/app/api/metrics/shared";
import { computeServiceHealth } from "@/lib/metrics/computers/service-health";

// TODO: Add withTierGate when tier middleware is integrated

export async function GET(request: NextRequest) {
  try {
    const result = await parseMetricQueryParams(request);

    if (!result.success) {
      return result.response;
    }

    const metrics = await computeServiceHealth(result.context);

    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    console.error("Service health metrics query failed:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve service health metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
