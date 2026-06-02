/**
 * Unit tests for Dashboard components logic
 *
 * Tests the computeTrend function which implements the 10% threshold rule:
 * - "improving" if metric improved by >10%
 * - "degrading" if metric worsened by >10%
 * - "stable" otherwise
 *
 * Requirements: 9.1, 9.8
 */

import { describe, it, expect } from "vitest";
import { computeTrend } from "@/app/dashboard/components/dora-metrics-card";

describe("computeTrend", () => {
  describe("metrics where lower is better (CFR, MTTR, Lead Time)", () => {
    const lowerIsBetter = true;

    it("returns 'improving' when value decreased by more than 10%", () => {
      // Previous: 50, Current: 40 → decreased by 20% → improving
      expect(computeTrend(40, 50, lowerIsBetter)).toBe("improving");
    });

    it("returns 'degrading' when value increased by more than 10%", () => {
      // Previous: 50, Current: 60 → increased by 20% → degrading
      expect(computeTrend(60, 50, lowerIsBetter)).toBe("degrading");
    });

    it("returns 'stable' when change is within 10%", () => {
      // Previous: 50, Current: 48 → decreased by 4% → stable
      expect(computeTrend(48, 50, lowerIsBetter)).toBe("stable");
      // Previous: 50, Current: 54 → increased by 8% → stable
      expect(computeTrend(54, 50, lowerIsBetter)).toBe("stable");
    });

    it("returns 'stable' at exactly 10% decrease", () => {
      // Previous: 100, Current: 90 → exactly 10% decrease → stable (threshold is >10%)
      expect(computeTrend(90, 100, lowerIsBetter)).toBe("stable");
    });

    it("returns 'stable' at exactly 10% increase", () => {
      // Previous: 100, Current: 110 → exactly 10% increase → stable (threshold is >10%)
      expect(computeTrend(110, 100, lowerIsBetter)).toBe("stable");
    });

    it("returns 'improving' just past 10% decrease threshold", () => {
      // Previous: 100, Current: 89 → 11% decrease → improving
      expect(computeTrend(89, 100, lowerIsBetter)).toBe("improving");
    });

    it("returns 'degrading' just past 10% increase threshold", () => {
      // Previous: 100, Current: 111 → 11% increase → degrading
      expect(computeTrend(111, 100, lowerIsBetter)).toBe("degrading");
    });
  });

  describe("metrics where higher is better (Deployment Frequency)", () => {
    const lowerIsBetter = false;

    it("returns 'improving' when value increased by more than 10%", () => {
      // Previous: 10, Current: 12 → increased by 20% → improving
      expect(computeTrend(12, 10, lowerIsBetter)).toBe("improving");
    });

    it("returns 'degrading' when value decreased by more than 10%", () => {
      // Previous: 10, Current: 8 → decreased by 20% → degrading
      expect(computeTrend(8, 10, lowerIsBetter)).toBe("degrading");
    });

    it("returns 'stable' when change is within 10%", () => {
      // Previous: 10, Current: 10.5 → increased by 5% → stable
      expect(computeTrend(10.5, 10, lowerIsBetter)).toBe("stable");
    });

    it("returns 'stable' at exactly 10% increase", () => {
      expect(computeTrend(11, 10, lowerIsBetter)).toBe("stable");
    });

    it("returns 'improving' just past 10% increase threshold", () => {
      expect(computeTrend(11.1, 10, lowerIsBetter)).toBe("improving");
    });
  });

  describe("edge cases", () => {
    it("returns 'stable' when current is insufficient_data", () => {
      expect(computeTrend("insufficient_data", 50, true)).toBe("stable");
    });

    it("returns 'stable' when previous is insufficient_data", () => {
      expect(computeTrend(50, "insufficient_data", true)).toBe("stable");
    });

    it("returns 'stable' when both are insufficient_data", () => {
      expect(computeTrend("insufficient_data", "insufficient_data", true)).toBe("stable");
    });

    it("returns 'stable' when both values are zero", () => {
      expect(computeTrend(0, 0, true)).toBe("stable");
    });

    it("handles previous value of zero (lower is better)", () => {
      // If previous is 0 and current is non-zero, for lower-is-better it's degrading
      expect(computeTrend(5, 0, true)).toBe("degrading");
    });

    it("handles previous value of zero (higher is better)", () => {
      // If previous is 0 and current is non-zero, for higher-is-better it's improving
      expect(computeTrend(5, 0, false)).toBe("improving");
    });

    it("handles equal values", () => {
      expect(computeTrend(50, 50, true)).toBe("stable");
      expect(computeTrend(50, 50, false)).toBe("stable");
    });
  });
});
