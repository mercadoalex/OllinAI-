import { describe, it, expect } from "vitest";
import {
  determineActions,
  shouldAutoExecute,
  computeConfidence,
  generateRemediation,
  type RemediationRequest,
} from "./handler";

describe("Remediation Lambda", () => {
  const baseRequest: RemediationRequest = {
    tenantId: "tenant-1",
    eventId: "event-1",
    serviceId: "service-1",
    predictionScore: 0.92,
    riskScore: "critical",
    modelVersion: "1.0.0",
    autoRemediationEnabled: true,
    contributingFactors: ["high_failure_rate", "large_change_size"],
  };

  describe("determineActions", () => {
    it("should recommend rollback for critical risk", () => {
      const actions = determineActions(baseRequest);
      expect(actions).toContain("rollback");
      expect(actions).toContain("notify_oncall");
    });

    it("should recommend halt_canary for high risk", () => {
      const actions = determineActions({
        ...baseRequest,
        riskScore: "high",
        predictionScore: 0.6,
      });
      expect(actions).toContain("halt_canary");
    });

    it("should recommend scale_up for moderate prediction", () => {
      const actions = determineActions({
        ...baseRequest,
        riskScore: "medium",
        predictionScore: 0.6,
      });
      expect(actions).toContain("scale_up");
    });

    it("should return empty for low risk and low prediction", () => {
      const actions = determineActions({
        ...baseRequest,
        riskScore: "low",
        predictionScore: 0.3,
      });
      expect(actions).toHaveLength(0);
    });
  });

  describe("shouldAutoExecute", () => {
    it("should return true when all conditions met", () => {
      expect(shouldAutoExecute(baseRequest, 0.9)).toBe(true);
    });

    it("should return false when auto-remediation disabled", () => {
      expect(
        shouldAutoExecute(
          { ...baseRequest, autoRemediationEnabled: false },
          0.9
        )
      ).toBe(false);
    });

    it("should return false when prediction below threshold", () => {
      expect(
        shouldAutoExecute({ ...baseRequest, predictionScore: 0.8 }, 0.9)
      ).toBe(false);
    });

    it("should return false when confidence below threshold", () => {
      expect(shouldAutoExecute(baseRequest, 0.7)).toBe(false);
    });
  });

  describe("computeConfidence", () => {
    it("should return high confidence for critical + high prediction", () => {
      const confidence = computeConfidence(0.95, "critical");
      expect(confidence).toBeGreaterThan(0.9);
    });

    it("should return lower confidence for low risk", () => {
      const confidence = computeConfidence(0.3, "low");
      expect(confidence).toBeLessThan(0.5);
    });

    it("should cap at 1.0", () => {
      const confidence = computeConfidence(1.0, "critical");
      expect(confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe("generateRemediation", () => {
    it("should generate actions for critical deployment", async () => {
      const result = await generateRemediation(baseRequest);
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.executed).toBe(true);
      expect(result.actions[0].type).toBe("rollback");
    });

    it("should be recommendation-only when disabled", async () => {
      const result = await generateRemediation({
        ...baseRequest,
        autoRemediationEnabled: false,
      });
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.executed).toBe(false);
      expect(result.actions.every((a) => a.recommendationOnly)).toBe(true);
    });

    it("should skip remediation for low risk and low prediction", async () => {
      const result = await generateRemediation({
        ...baseRequest,
        riskScore: "low",
        predictionScore: 0.2,
      });
      expect(result.actions).toHaveLength(0);
      expect(result.executed).toBe(false);
    });

    it("should include contributing factors", async () => {
      const result = await generateRemediation(baseRequest);
      for (const action of result.actions) {
        expect(action.contributingFactors).toEqual([
          "high_failure_rate",
          "large_change_size",
        ]);
      }
    });
  });
});
