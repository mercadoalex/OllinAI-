/**
 * Trend indicator computation utility.
 *
 * Compares a current metric value against a previous-period value and classifies
 * the direction as "improving", "degrading", or "stable" using the 10% threshold rule.
 */

import type { TrendIndicator } from "../utils";

/**
 * Compute a trend indicator by comparing the current period value to the previous period value.
 *
 * Rules:
 * - Compute the percentage change: ((current - previous) / |previous|) * 100
 * - If the change exceeds 10% in the favorable direction → "improving"
 * - If the change exceeds 10% in the unfavorable direction → "degrading"
 * - Otherwise → "stable"
 *
 * For lowerIsBetter=true: a decrease is favorable (improving).
 * For lowerIsBetter=false: an increase is favorable (improving).
 *
 * Edge cases:
 * - previous=0 and current=0 → stable with 0% change
 * - previous=0 and current≠0 → direction depends on lowerIsBetter
 *
 * @param current - The metric value for the current period
 * @param previous - The metric value for the previous period
 * @param lowerIsBetter - Whether a decrease in value is considered favorable
 * @returns TrendIndicator with direction and absolute percent change
 */
export function computeTrendIndicator(
  current: number,
  previous: number,
  lowerIsBetter: boolean
): TrendIndicator {
  // Both zero → stable
  if (previous === 0 && current === 0) {
    return { direction: "stable", percentChange: 0 };
  }

  // Previous is zero but current is not → treat as 100% change in the direction of current
  if (previous === 0) {
    // current > 0 means value increased; current < 0 means value decreased
    const increased = current > 0;
    const direction = lowerIsBetter
      ? increased
        ? "degrading"
        : "improving"
      : increased
        ? "improving"
        : "degrading";
    return { direction, percentChange: 100 };
  }

  const percentChange = ((current - previous) / Math.abs(previous)) * 100;
  const absChange = Math.abs(percentChange);

  if (absChange <= 10) {
    return { direction: "stable", percentChange: absChange };
  }

  // Determine if the movement is in the favorable direction
  const valueIncreased = current > previous;

  let direction: "improving" | "degrading";
  if (lowerIsBetter) {
    // Lower is better: decrease = improving, increase = degrading
    direction = valueIncreased ? "degrading" : "improving";
  } else {
    // Higher is better: increase = improving, decrease = degrading
    direction = valueIncreased ? "improving" : "degrading";
  }

  return { direction, percentChange: absChange };
}
