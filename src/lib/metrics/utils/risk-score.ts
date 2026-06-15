/**
 * Risk score computation utility.
 *
 * Maps categorical risk scores to numeric values and computes
 * arithmetic mean across a set of deployment events.
 */

import type { EventItem } from "@/lib/types/dynamo";
import { RISK_SCORE_NUMERIC } from "../computers/types";

/**
 * Compute the arithmetic mean of numeric risk scores for a set of events.
 *
 * - Maps each event's riskScore to its RISK_SCORE_NUMERIC value (low=1, medium=2, high=3, critical=4)
 * - Skips events with undefined or "indeterminate" risk scores
 * - Returns 0 if no valid risk scores exist
 *
 * @param events - Array of deployment events
 * @returns The arithmetic mean of valid risk scores, or 0 if none
 */
export function computeAverageRiskScore(events: EventItem[]): number {
  let sum = 0;
  let count = 0;

  for (const event of events) {
    if (!event.riskScore || event.riskScore === "indeterminate") {
      continue;
    }

    const numericValue = RISK_SCORE_NUMERIC[event.riskScore];
    if (numericValue !== undefined) {
      sum += numericValue;
      count++;
    }
  }

  if (count === 0) {
    return 0;
  }

  return sum / count;
}
