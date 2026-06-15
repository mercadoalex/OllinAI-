import { describe, it, expect } from "vitest";
import { applyEventFilters } from "../filters";
import type { EventItem } from "@/lib/types/dynamo";
import type { MetricComputeContext } from "../../computers/types";

function makeEvent(overrides: Partial<EventItem> = {}): EventItem {
  return {
    PK: "TENANT#t1#SVC#svc1",
    SK: "DEPLOY#2024-01-15T10:00:00.000Z#evt1",
    eventId: "evt1",
    commitShas: ["abc123"],
    author: "user1",
    services: ["svc1"],
    environment: "production",
    teamId: "team1",
    createdAt: "2024-01-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<MetricComputeContext> = {}): MetricComputeContext {
  return {
    tenantId: "t1",
    from: new Date("2024-01-01T00:00:00.000Z"),
    to: new Date("2024-02-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("applyEventFilters", () => {
  it("returns all events when no optional filters are active", () => {
    const events = [
      makeEvent({ eventId: "e1", createdAt: "2024-01-10T00:00:00.000Z" }),
      makeEvent({ eventId: "e2", createdAt: "2024-01-20T00:00:00.000Z" }),
    ];
    const result = applyEventFilters(events, makeContext());
    expect(result).toHaveLength(2);
  });

  it("filters by time range — excludes events before 'from'", () => {
    const events = [
      makeEvent({ eventId: "e1", createdAt: "2023-12-31T23:59:59.000Z" }),
      makeEvent({ eventId: "e2", createdAt: "2024-01-01T00:00:00.000Z" }),
    ];
    const result = applyEventFilters(events, makeContext());
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe("e2");
  });

  it("filters by time range — excludes events at or after 'to'", () => {
    const events = [
      makeEvent({ eventId: "e1", createdAt: "2024-01-31T23:59:59.000Z" }),
      makeEvent({ eventId: "e2", createdAt: "2024-02-01T00:00:00.000Z" }),
    ];
    const result = applyEventFilters(events, makeContext());
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe("e1");
  });

  it("filters by teamId", () => {
    const events = [
      makeEvent({ eventId: "e1", teamId: "team1" }),
      makeEvent({ eventId: "e2", teamId: "team2" }),
    ];
    const result = applyEventFilters(events, makeContext({ teamId: "team1" }));
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe("e1");
  });

  it("filters by serviceId", () => {
    const events = [
      makeEvent({ eventId: "e1", services: ["svc1", "svc2"] }),
      makeEvent({ eventId: "e2", services: ["svc3"] }),
    ];
    const result = applyEventFilters(events, makeContext({ serviceId: "svc2" }));
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe("e1");
  });

  it("applies all filters as conjunction (AND)", () => {
    const events = [
      makeEvent({ eventId: "e1", teamId: "team1", services: ["svc1"], createdAt: "2024-01-15T00:00:00.000Z" }),
      makeEvent({ eventId: "e2", teamId: "team1", services: ["svc2"], createdAt: "2024-01-15T00:00:00.000Z" }),
      makeEvent({ eventId: "e3", teamId: "team2", services: ["svc1"], createdAt: "2024-01-15T00:00:00.000Z" }),
      makeEvent({ eventId: "e4", teamId: "team1", services: ["svc1"], createdAt: "2024-03-01T00:00:00.000Z" }),
    ];
    const result = applyEventFilters(events, makeContext({ teamId: "team1", serviceId: "svc1" }));
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe("e1");
  });

  it("returns empty array when no events match", () => {
    const events = [
      makeEvent({ eventId: "e1", teamId: "team2" }),
    ];
    const result = applyEventFilters(events, makeContext({ teamId: "team1" }));
    expect(result).toHaveLength(0);
  });

  it("returns empty array when input is empty", () => {
    const result = applyEventFilters([], makeContext());
    expect(result).toHaveLength(0);
  });
});
