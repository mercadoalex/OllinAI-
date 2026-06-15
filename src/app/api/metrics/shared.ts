/**
 * Shared API validation and response utilities for advanced metrics endpoints.
 *
 * Provides common request validation logic (time range parsing, 365-day max,
 * from < to check) and tenant ID extraction from the authenticated session.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import type { MetricComputeContext } from "@/lib/metrics/computers/types";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Default period for metrics queries (30 days in ms) */
const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Maximum queryable range (365 days in ms) */
const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ParseResult =
  | { success: true; context: MetricComputeContext }
  | { success: false; response: NextResponse };

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Parse and validate common metric query parameters from a request.
 *
 * Extracts `from`, `to`, `team`, `service` query params and validates:
 * - `from` and `to` are valid ISO dates (if provided)
 * - `from < to`
 * - Range does not exceed 365 days
 * - Defaults: `to` = now, `from` = 30 days before `to`
 *
 * Also extracts `tenantId` from the authenticated session.
 *
 * @returns A `ParseResult` containing either a valid `MetricComputeContext` or a 400/401 error response.
 */
export async function parseMetricQueryParams(
  request: NextRequest
): Promise<ParseResult> {
  // Step 1: Authenticate
  const authResult = await getAuthSession(request);
  if (authResult instanceof NextResponse) {
    return { success: false, response: authResult };
  }

  const tenantId = authResult.tenantId;

  // Step 2: Parse query parameters
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const team = searchParams.get("team") || undefined;
  const service = searchParams.get("service") || undefined;

  // Step 3: Resolve time range with defaults
  const now = new Date();
  let to: Date;
  let from: Date;

  if (toParam) {
    const parsedTo = new Date(toParam);
    if (isNaN(parsedTo.getTime())) {
      return {
        success: false,
        response: NextResponse.json(
          { error: "Invalid 'to' parameter. Must be a valid ISO 8601 date." },
          { status: 400 }
        ),
      };
    }
    to = parsedTo;
  } else {
    to = now;
  }

  if (fromParam) {
    const parsedFrom = new Date(fromParam);
    if (isNaN(parsedFrom.getTime())) {
      return {
        success: false,
        response: NextResponse.json(
          { error: "Invalid 'from' parameter. Must be a valid ISO 8601 date." },
          { status: 400 }
        ),
      };
    }
    from = parsedFrom;
  } else {
    from = new Date(to.getTime() - DEFAULT_PERIOD_MS);
  }

  // Step 4: Validate time range constraints
  if (from >= to) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "'from' must be before 'to'." },
        { status: 400 }
      ),
    };
  }

  const rangeMs = to.getTime() - from.getTime();
  if (rangeMs > MAX_RANGE_MS) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Maximum queryable range is 365 days." },
        { status: 400 }
      ),
    };
  }

  // Step 5: Build the MetricComputeContext
  const context: MetricComputeContext = {
    tenantId,
    from,
    to,
    ...(team && { teamId: team }),
    ...(service && { serviceId: service }),
  };

  return { success: true, context };
}
