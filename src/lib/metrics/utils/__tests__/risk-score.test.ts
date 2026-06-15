import { describe, it, expect } from "vitest";
import { computeAverageRiskScore } from "../risk-score";
import type { EventItem } from "@/lib/types/dynamo";

function makeEvent(riskScore?: EventItem["riskScore"]): EventItem {
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
    riskScore,
  };
}

describe("computeAverageRiskScore", () => {
  it("returns 0 for an empty array", () => {
    expect(computeAverageRiskScore([])).toBe(0);
  });

  it("returns 0 when all events have undefined risk scores", () => {
    const events = [makeEvent(undefined), makeEvent(undefined)];
    expect(computeAverageRiskScore(events)).toBe(0);
  });

  it("returns 0 when all events have indeterminate risk scores", () => {
    const events = [makeEvent("indeterminate"), makeEvent("indeterminate")];
    expect(computeAverageRiskScore(events)).toBe(0);
  });

  it("correctly maps low=1", () => {
    const events = [makeEvent("low")];
    expect(computeAverageRiskScore(events)).toBe(1);
  });

  it("correctly maps medium=2", () => {
    const events = [makeEvent("medium")];
    expect(computeAverageRiskScore(events)).toBe(2);
  });

  it("correctly maps high=3", () => {
    const events = [makeEvent("high")];
    expect(computeAverageRiskScore(events)).toBe(3);
  });

  it("correctly maps critical=4", () => {
    const events = [makeEvent("critical")];
    expect(computeAverageRiskScore(events)).toBe(4);
  });

  it("computes arithmetic mean of multiple scores", () => {
    // low(1) + medium(2) + high(3) + critical(4) = 10 / 4 = 2.5
    const events = [
      makeEvent("low"),
      makeEvent("medium"),
      makeEvent("high"),
      makeEvent("critical"),
    ];
    expect(computeAverageRiskScore(events)).toBe(2.5);
  });

  it("skips undefined and indeterminate risk scores in average", () => {
    // Only low(1) + critical(4) = 5 / 2 = 2.5
    const events = [
      makeEvent("low"),
      makeEvent(undefined),
      makeEvent("indeterminate"),
      makeEvent("critical"),
    ];
    expect(computeAverageRiskScore(events)).toBe(2.5);
  });
});
