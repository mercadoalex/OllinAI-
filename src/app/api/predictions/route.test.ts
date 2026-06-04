import { describe, it, expect } from "vitest";
import { detectAnomalies, generateRootCauseRanking } from "@/lib/predictions/prediction-logic";

describe("Predictions API Logic", () => {
  describe("detectAnomalies", () => {
    it("should not flag anomaly with insufficient data", () => {
      const result = detectAnomalies([0.3, 0.4, 0.35], 0.9);
      expect(result.isAnomaly).toBe(false);
    });

    it("should detect anomaly beyond 3σ", () => {
      // Tight cluster around 0.3, then a score of 0.95
      const scores = [0.30, 0.31, 0.29, 0.30, 0.32, 0.31, 0.29, 0.30, 0.31, 0.30];
      const result = detectAnomalies(scores, 0.95);
      expect(result.isAnomaly).toBe(true);
      expect(result.deviation).toBeGreaterThan(3);
    });

    it("should not flag normal variation", () => {
      const scores = [0.3, 0.35, 0.28, 0.32, 0.4, 0.38, 0.33, 0.35, 0.31, 0.37];
      const result = detectAnomalies(scores, 0.36);
      expect(result.isAnomaly).toBe(false);
    });

    it("should handle all identical scores", () => {
      const scores = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      const same = detectAnomalies(scores, 0.5);
      expect(same.isAnomaly).toBe(false);

      const different = detectAnomalies(scores, 0.6);
      expect(different.isAnomaly).toBe(true);
    });
  });

  describe("generateRootCauseRanking", () => {
    it("should return top 3 deployments ranked by score", () => {
      const predictions = [
        { eventId: "e1", score: 0.9, factors: ["high_cfr"] },
        { eventId: "e2", score: 0.7, factors: ["timing"] },
        { eventId: "e3", score: 0.5, factors: ["change_size"] },
        { eventId: "e4", score: 0.3, factors: [] },
      ];
      const ranking = generateRootCauseRanking(predictions);
      expect(ranking).toHaveLength(3);
      expect(ranking[0].deploymentId).toBe("e1");
      expect(ranking[0].confidence).toBeGreaterThan(ranking[1].confidence);
      expect(ranking[1].confidence).toBeGreaterThan(ranking[2].confidence);
    });

    it("should handle fewer than 3 predictions", () => {
      const predictions = [{ eventId: "e1", score: 0.8, factors: ["cfr"] }];
      const ranking = generateRootCauseRanking(predictions);
      expect(ranking).toHaveLength(1);
    });

    it("should include causal patterns from factors", () => {
      const predictions = [
        { eventId: "e1", score: 0.9, factors: ["high_cfr", "large_change"] },
      ];
      const ranking = generateRootCauseRanking(predictions);
      expect(ranking[0].causalPattern).toContain("high_cfr");
      expect(ranking[0].causalPattern).toContain("large_change");
    });
  });
});
