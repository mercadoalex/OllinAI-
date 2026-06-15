/**
 * Business Impact Metrics API
 *
 * GET /api/metrics/business-impact?from=DATE&to=DATE&team=X&service=Y
 *
 * Returns computed business impact metrics (estimated downtime avoided,
 * SLA compliance percentage, incident trend) for the specified scope and time range.
 *
 * Authentication: Required
 * Tier: Enterprise only (aiops_predictions feature)
 *
 * Requirements: 7.1, 9.3, 9.6
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMetricQueryParams } from "@/app/api/metrics/shared";
import { computeBusinessImpact } from "@/lib/metrics/computers/business-impact";

// TODO: Add withTierGate when tier middleware is integrated

export async function GET(request: NextRequest) {
  try {
    const result = await parseMetricQueryParams(request);

    if (!result.success) {
      return result.response;
    }

    const metrics = await computeBusinessImpact(result.context);

    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    console.error("Business impact metrics query failed:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve business impact metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
