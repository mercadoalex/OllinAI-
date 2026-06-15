/**
 * Event filter utility for the metrics computation layer.
 *
 * Applies a conjunction of filters (team, service, time range) to a set of
 * deployment events, returning only those that satisfy ALL active criteria.
 */

import type { EventItem } from "@/lib/types/dynamo";
import type { MetricComputeContext } from "../computers/types";

/**
 * Apply all active filters from the computation context to a set of events.
 *
 * Filters applied (conjunction — all must match):
 * - teamId: event.teamId must equal context.teamId (if provided)
 * - serviceId: event.services array must include context.serviceId (if provided)
 * - time range: event.createdAt must be >= context.from and < context.to
 *
 * @param events - Array of deployment events to filter
 * @param context - Computation context containing filter criteria
 * @returns Filtered subset of events matching all active criteria
 */
export function applyEventFilters(
  events: EventItem[],
  context: MetricComputeContext
): EventItem[] {
  return events.filter((event) => {
    // Time range filter: createdAt must be within [from, to)
    const eventTime = new Date(event.createdAt);
    if (eventTime < context.from || eventTime >= context.to) {
      return false;
    }

    // Team filter: event.teamId must match context.teamId
    if (context.teamId && event.teamId !== context.teamId) {
      return false;
    }

    // Service filter: event.services must include context.serviceId
    if (context.serviceId && !event.services.includes(context.serviceId)) {
      return false;
    }

    return true;
  });
}
