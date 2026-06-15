import { describe, it, expect } from "vitest";
import { groupEventsByDay } from "../time-grouping";
import type { EventItem } from "@/lib/types/dynamo";

function makeEvent(createdAt: string, eventId = "evt1"): EventItem {
  return {
    PK: "TENANT#t1#SVC#svc1",
    SK: `DEPLOY#${createdAt}#${eventId}`,
    eventId,
    commitShas: ["abc123"],
    author: "user1",
    services: ["svc1"],
    environment: "production",
    teamId: "team1",
    createdAt,
  };
}

describe("groupEventsByDay", () => {
  it("returns empty buckets for all days in range when no events provided", () => {
    const from = new Date("2024-01-01T00:00:00.000Z");
    const to = new Date("2024-01-03T23:59:59.000Z");
    const result = groupEventsByDay([], from, to);

    expect(result.size).toBe(3);
    expect(result.get("2024-01-01")).toEqual([]);
    expect(result.get("2024-01-02")).toEqual([]);
    expect(result.get("2024-01-03")).toEqual([]);
  });

  it("places events into the correct day bucket", () => {
    const from = new Date("2024-01-01T00:00:00.000Z");
    const to = new Date("2024-01-02T23:59:59.000Z");

    const events = [
      makeEvent("2024-01-01T08:00:00.000Z", "e1"),
      makeEvent("2024-01-01T20:00:00.000Z", "e2"),
      makeEvent("2024-01-02T12:00:00.000Z", "e3"),
    ];

    const result = groupEventsByDay(events, from, to);

    expect(result.get("2024-01-01")).toHaveLength(2);
    expect(result.get("2024-01-02")).toHaveLength(1);
  });

  it("fills missing days with empty arrays", () => {
    const from = new Date("2024-01-01T00:00:00.000Z");
    const to = new Date("2024-01-05T00:00:00.000Z");

    const events = [
      makeEvent("2024-01-01T10:00:00.000Z", "e1"),
      makeEvent("2024-01-05T10:00:00.000Z", "e2"),
    ];

    const result = groupEventsByDay(events, from, to);

    expect(result.size).toBe(5);
    expect(result.get("2024-01-01")).toHaveLength(1);
    expect(result.get("2024-01-02")).toEqual([]);
    expect(result.get("2024-01-03")).toEqual([]);
    expect(result.get("2024-01-04")).toEqual([]);
    expect(result.get("2024-01-05")).toHaveLength(1);
  });

  it("ignores events outside the range", () => {
    const from = new Date("2024-01-02T00:00:00.000Z");
    const to = new Date("2024-01-03T23:59:59.000Z");

    const events = [
      makeEvent("2024-01-01T10:00:00.000Z", "e1"), // before range
      makeEvent("2024-01-02T10:00:00.000Z", "e2"), // in range
      makeEvent("2024-01-04T10:00:00.000Z", "e3"), // after range
    ];

    const result = groupEventsByDay(events, from, to);

    expect(result.size).toBe(2);
    expect(result.get("2024-01-02")).toHaveLength(1);
    expect(result.get("2024-01-03")).toEqual([]);
  });

  it("handles a single day range", () => {
    const from = new Date("2024-01-15T00:00:00.000Z");
    const to = new Date("2024-01-15T23:59:59.000Z");

    const events = [
      makeEvent("2024-01-15T12:00:00.000Z", "e1"),
    ];

    const result = groupEventsByDay(events, from, to);

    expect(result.size).toBe(1);
    expect(result.get("2024-01-15")).toHaveLength(1);
  });

  it("uses UTC for day boundaries", () => {
    const from = new Date("2024-01-01T00:00:00.000Z");
    const to = new Date("2024-01-02T00:00:00.000Z");

    // Event at 23:59 UTC on Jan 1 should be in Jan 1 bucket
    const events = [
      makeEvent("2024-01-01T23:59:59.000Z", "e1"),
      makeEvent("2024-01-02T00:00:01.000Z", "e2"),
    ];

    const result = groupEventsByDay(events, from, to);

    expect(result.get("2024-01-01")).toHaveLength(1);
    expect(result.get("2024-01-02")).toHaveLength(1);
  });
});
