/**
 * Shared utility functions and types for the advanced dashboard metrics computation layer.
 *
 * This barrel export re-exports from individual utility modules as they are implemented:
 * - trend.ts: Trend indicator computation (improving/degrading/stable)
 * - filters.ts: Event filter application (conjunction of team, service, time range)
 * - risk-score.ts: Risk score numeric mapping and average computation
 * - time-grouping.ts: Event grouping by day with zero-fill for empty days
 */

// ─── Shared Types ──────────────────────────────────────────────────────────────

/**
 * Direction and magnitude of a metric trend compared to the previous period.
 * Uses the 10% threshold rule: >10% favorable = improving, >10% unfavorable = degrading.
 */
export interface TrendIndicator {
  /** Whether the metric is moving in a favorable, unfavorable, or neutral direction */
  direction: "improving" | "degrading" | "stable";
  /** Absolute percentage change between current and previous period values */
  percentChange: number;
}

// ─── Re-exports ────────────────────────────────────────────────────────────────
export { computeTrendIndicator } from "./trend";
export { applyEventFilters } from "./filters";
export { computeAverageRiskScore } from "./risk-score";
export { groupEventsByDay } from "./time-grouping";
