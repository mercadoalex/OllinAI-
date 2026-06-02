import { describe, it, expect } from "vitest";
import {
  combineScores,
  makeGateDecision,
  evaluateGate,
  generateMitigations,
  type GateRequest,
} from "./route";

describe("Deployment Gate API", () => {
  describe("combineScores", () => {
    it("should weight prediction more than risk", () => {
      const result = combineScores(0.8, 0.4);
      // 0.8 * 0.6 + 0.4 * 0.4 = 0.48 + 0.16 = 0.64
      expect(result).toBeCloseTo(0.64);
    });

    it("should cap at 1.0", () => {
      const result = combineScores(1.0, 1.0);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it("should return 0 for zero scores", () => {
      expect(combineScores(0, 0)).toBe(0);
    });
  });

  describe("makeGateDecision", () => {
    const thresholds = { warnThreshold: 0.5, blockThreshold: 0.8 };

    it("should proceed below warn threshold", () => {
      expect(makeGateDecision(0.3, thresholds)).toBe("proceed");
    });

    it("should warn at warn threshold", () => {
      expect(makeGateDecision(0.5, thresholds)).toBe("warn");
    });

    it("should warn between thresholds", () => {
      expect(makeGateDecision(0.7, thresholds)).toBe("warn");
    });

    it("should block above block threshold", () => {
      expect(makeGateDecision(0.85, thresholds)).toBe("block");
    });

    it("should block at threshold boundary", () => {
      expect(makeGateDecision(0.801, thresholds)).toBe("block");
    });
  });

  describe("generateMitigations", () => {
    it("should suggest canary for high failure rate", () => {
      const mitigations = generateMitigations(["high_failure_rate"], "high");
      expect(mitigations).toContain("Add canary deployment to reduce blast radius");
    });

    it("should suggest splitting for large change", () => {
      const mitigations = generateMitigations(["large_change_size"], "medium");
      expect(mitigations).toContain(
        "Break deployment into smaller, reviewable chunks"
      );
    });

    it("should include rollback plan for critical", () => {
      const mitigations = generateMitigations([], "critical");
      expect(mitigations).toContain("Consider rollback plan before proceeding");
    });

    it("should return fallback for unknown factors", () => {
      const mitigations = generateMitigations([], "low");
      expect(mitigations.length).toBeGreaterThan(0);
    });
  });

  describe("evaluateGate", () => {
    it("should proceed for low-risk deployment", () => {
      const request: GateRequest = {
        serviceId: "svc-1",
        eventId: "evt-1",
        predictionScore: 0.2,
        riskScore: 0.1,
        riskSeverity: "low",
        contributingFactors: [],
      };
      const result = evaluateGate(request);
      expect(result.decision).toBe("proceed");
      expect(result.mitigations).toBeUndefined();
    });

    it("should block for high-risk deployment", () => {
      const request: GateRequest = {
        serviceId: "svc-1",
        eventId: "evt-1",
        predictionScore: 0.95,
        riskScore: 0.9,
        riskSeverity: "critical",
        contributingFactors: ["high_failure_rate"],
      };
      const result = evaluateGate(request);
      expect(result.decision).toBe("block");
      expect(result.mitigations).toBeDefined();
      expect(result.mitigations!.length).toBeGreaterThan(0);
    });

    it("should respect custom thresholds", () => {
      const request: GateRequest = {
        serviceId: "svc-1",
        eventId: "evt-1",
        predictionScore: 0.6,
        riskScore: 0.5,
        riskSeverity: "medium",
        contributingFactors: [],
        customThresholds: {
          warnThreshold: 0.3,
          blockThreshold: 0.5,
        },
      };
      const result = evaluateGate(request);
      // Combined = 0.6*0.6 + 0.5*0.4 = 0.36 + 0.2 = 0.56, block threshold 0.5 -> block
      expect(result.decision).toBe("block");
    });

    it("should include evaluatedAt timestamp", () => {
      const request: GateRequest = {
        serviceId: "svc-1",
        eventId: "evt-1",
        predictionScore: 0.3,
        riskScore: 0.2,
        riskSeverity: "low",
      };
      const result = evaluateGate(request);
      expect(result.evaluatedAt).toBeTruthy();
      expect(new Date(result.evaluatedAt).getTime()).not.toBeNaN();
    });
  });
});
