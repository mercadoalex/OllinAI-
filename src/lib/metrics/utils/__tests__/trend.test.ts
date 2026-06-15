import { describe, it, expect } from "vitest";
import { computeTrendIndicator } from "../trend";

describe("computeTrendIndicator", () => {
  describe("lowerIsBetter = false (higher is better)", () => {
    it("returns 'improving' when current is >10% higher than previous", () => {
      const result = computeTrendIndicator(120, 100, false);
      expect(result.direction).toBe("improving");
      expect(result.percentChange).toBeCloseTo(20);
    });

    it("returns 'degrading' when current is >10% lower than previous", () => {
      const result = computeTrendIndicator(80, 100, false);
      expect(result.direction).toBe("degrading");
      expect(result.percentChange).toBeCloseTo(20);
    });

    it("returns 'stable' when change is exactly 10%", () => {
      const result = computeTrendIndicator(110, 100, false);
      expect(result.direction).toBe("stable");
      expect(result.percentChange).toBeCloseTo(10);
    });

    it("returns 'stable' when change is within 10%", () => {
      const result = computeTrendIndicator(105, 100, false);
      expect(result.direction).toBe("stable");
      expect(result.percentChange).toBeCloseTo(5);
    });
  });

  describe("lowerIsBetter = true (lower is better)", () => {
    it("returns 'improving' when current is >10% lower than previous", () => {
      const result = computeTrendIndicator(80, 100, true);
      expect(result.direction).toBe("improving");
      expect(result.percentChange).toBeCloseTo(20);
    });

    it("returns 'degrading' when current is >10% higher than previous", () => {
      const result = computeTrendIndicator(120, 100, true);
      expect(result.direction).toBe("degrading");
      expect(result.percentChange).toBeCloseTo(20);
    });

    it("returns 'stable' when change is within 10%", () => {
      const result = computeTrendIndicator(95, 100, true);
      expect(result.direction).toBe("stable");
      expect(result.percentChange).toBeCloseTo(5);
    });
  });

  describe("edge cases", () => {
    it("returns stable with 0% change when both values are 0", () => {
      const result = computeTrendIndicator(0, 0, false);
      expect(result.direction).toBe("stable");
      expect(result.percentChange).toBe(0);
    });

    it("returns improving with 100% change when previous is 0 and current > 0 (higherIsBetter)", () => {
      const result = computeTrendIndicator(50, 0, false);
      expect(result.direction).toBe("improving");
      expect(result.percentChange).toBe(100);
    });

    it("returns degrading with 100% change when previous is 0 and current > 0 (lowerIsBetter)", () => {
      const result = computeTrendIndicator(50, 0, true);
      expect(result.direction).toBe("degrading");
      expect(result.percentChange).toBe(100);
    });

    it("returns stable when current equals previous", () => {
      const result = computeTrendIndicator(100, 100, false);
      expect(result.direction).toBe("stable");
      expect(result.percentChange).toBe(0);
    });

    it("handles negative previous values", () => {
      // previous=-100, current=-80 → value increased by 20% ((-80 - -100) / |-100| = 20%)
      const result = computeTrendIndicator(-80, -100, false);
      expect(result.direction).toBe("improving");
      expect(result.percentChange).toBeCloseTo(20);
    });
  });
});
