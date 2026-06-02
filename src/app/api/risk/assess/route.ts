/**
 * Pre-Deployment Risk Assessment API
 *
 * POST /api/risk/assess — Compute a projected risk score for a proposed deployment
 * without persisting a Deployment_Event or modifying any data.
 *
 * Accepts proposed change metadata:
 *   - service: string (service being deployed to)
 *   - author: string (who is deploying)
 *   - changeSize: { filesChanged, linesAdded, linesRemoved }
 *   - plannedTimestamp: string (ISO 8601, when the deployment is planned)
 *
 * Returns:
 *   - score: "low" | "medium" | "high" | "critical"
 *   - factors: RiskFactors
 *   - weights: RiskWeights
 *   - numericScore: number
 *   - source: "rule_engine"
 *
 * Gated behind Pro or Enterprise tier (uses withTierGate for "risk_score" feature).
 * MUST NOT persist a Deployment_Event or modify any data.
 * MUST return within 5 seconds.
 *
 * Requirements: 4.6
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuthorization } from "@/lib/middleware/authorize";
import { withTierGate } from "@/lib/middleware/tier-gate";
import {
  computeRiskFactors,
  computeWeightedScore,
  classifyRisk,
  getRiskWeights,
} from "@/lambdas/risk-scorer/handler";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const RiskAssessRequestSchema = z.object({
  service: z
    .string({
      required_error: "service is required",
      invalid_type_error: "service must be a string",
    })
    .min(1, "service must not be empty")
    .max(150, "service must be at most 150 characters"),
  author: z
    .string({
      required_error: "author is required",
      invalid_type_error: "author must be a string",
    })
    .min(1, "author must not be empty"),
  changeSize: z.object(
    {
      filesChanged: z
        .number({ invalid_type_error: "filesChanged must be a number" })
        .int("filesChanged must be an integer")
        .min(0, "filesChanged must be non-negative")
        .default(0),
      linesAdded: z
        .number({ invalid_type_error: "linesAdded must be a number" })
        .int("linesAdded must be an integer")
        .min(0, "linesAdded must be non-negative")
        .default(0),
      linesRemoved: z
        .number({ invalid_type_error: "linesRemoved must be a number" })
        .int("linesRemoved must be an integer")
        .min(0, "linesRemoved must be non-negative")
        .default(0),
    },
    {
      required_error: "changeSize is required",
      invalid_type_error: "changeSize must be an object",
    }
  ),
  plannedTimestamp: z
    .string({
      required_error: "plannedTimestamp is required",
      invalid_type_error: "plannedTimestamp must be a string",
    })
    .refine(
      (val) => !isNaN(Date.parse(val)),
      "plannedTimestamp must be a valid ISO 8601 date"
    ),
});

// ─── POST /api/risk/assess ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Step 1: Authenticate — any role can assess risk
  const authResult = await withAuthorization(request, {
    resource: "settings",
    permission: "read",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;

  // Step 2: Tier gate — requires Pro or Enterprise (risk_score feature)
  const tierResult = await withTierGate(tenantId, "risk_score");
  if (tierResult instanceof NextResponse) {
    return tierResult;
  }

  // Step 3: Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = RiskAssessRequestSchema.safeParse(body);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const fieldPath = issue.path.join(".") || "unknown";
      if (!fieldErrors[fieldPath]) {
        fieldErrors[fieldPath] = [];
      }
      fieldErrors[fieldPath].push(issue.message);
    }
    return NextResponse.json(
      { error: "Validation failed", fields: fieldErrors },
      { status: 400 }
    );
  }

  const { service, author, changeSize, plannedTimestamp } = validation.data;

  // Step 4: Compute risk score using the same logic as the risk scorer Lambda
  // This MUST NOT persist any data — read-only computation
  try {
    const weights = await getRiskWeights(tenantId);

    const factors = await computeRiskFactors(
      tenantId,
      service,
      author,
      plannedTimestamp,
      {
        filesChanged: changeSize.filesChanged,
        linesAdded: changeSize.linesAdded,
        linesRemoved: changeSize.linesRemoved,
      }
    );

    const numericScore = computeWeightedScore(factors, weights);
    const score = classifyRisk(numericScore);

    return NextResponse.json(
      {
        score,
        factors,
        weights,
        numericScore,
        source: "rule_engine" as const,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Risk assessment computation failed:", error);
    return NextResponse.json(
      {
        error: "Risk assessment computation failed",
        details:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
