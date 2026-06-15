/**
 * Time grouping utility for metrics computation.
 *
 * Groups deployment events by calendar day (UTC) and ensures all days
 * in a given range are represented, including days with no events.
 */

import type { EventItem } from "@/lib/types/dynamo";

/**
 * Group events by calendar day (UTC), filling empty days with empty arrays.
 *
 * - Key format: "YYYY-MM-DD" (UTC date)
 * - All days from `from` to `to` (inclusive of from's day, inclusive of to's day) are represented
 * - Events whose createdAt falls on a given UTC day are placed in that day's bucket
 *
 * @param events - Array of deployment events to group
 * @param from - Start of the time range (inclusive)
 * @param to - End of the time range (inclusive of the day)
 * @returns Map keyed by date string with arrays of events for each day
 */
export function groupEventsByDay(
  events: EventItem[],
  from: Date,
  to: Date
): Map<string, EventItem[]> {
  const result = new Map<string, EventItem[]>();

  // Generate all day keys in the range [from, to]
  const startDay = toUTCDateString(from);
  const endDay = toUTCDateString(to);

  let currentDate = new Date(startDay + "T00:00:00.000Z");
  const endDate = new Date(endDay + "T00:00:00.000Z");

  while (currentDate <= endDate) {
    result.set(toUTCDateString(currentDate), []);
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
  }

  // Place each event into its corresponding day bucket
  for (const event of events) {
    const dayKey = toUTCDateString(new Date(event.createdAt));
    const bucket = result.get(dayKey);
    if (bucket) {
      bucket.push(event);
    }
    // Events outside the range are silently ignored
  }

  return result;
}

/**
 * Convert a Date to a UTC "YYYY-MM-DD" string.
 */
function toUTCDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
