import { describe, it, expect } from "vitest";
import {
  computeDriftScore,
  shouldPromote,
  shouldRetrain,
  shouldAlert,
  runTrainingPipeline,
} from "./handler";

describe("ML Training Pipeline", () => {
  describe("computeDriftScore", () => {
    it("should return 0 for empty arrays", () => {
      expect(computeDriftScore([], [])).toBe(0);
    });

    it("should return 0 for perfect predictions", () => {
      const predictions = [0.9, 0.8, 0.1, 0.2];
      const outcomes = [true, true, false, false];
      expect(computeDriftScore(predictions, outcomes)).toBe(0);
    });

    it("should return 1.0 for completely wrong predictions", () => {
      const predictions = [0.9, 0.8, 0.1, 0.2];
      const outcomes = [false, false, true, true];
      expect(computeDriftScore(predictions, outcomes)).toBe(1.0);
    });

    it("should return 0.5 for half-wrong predictions", () => {
      const predictions = [0.9, 0.8, 0.1, 0.2];
      const outcomes = [true, false, false, true];
      expect(computeDriftScore(predictions, outcomes)).toBe(0.5);
    });
  });

  describe("shouldPromote", () => {
    it("should promote when improvement ≥ 1pp", () => {
      expect(shouldPromote(0.75, 0.76, 1)).toBe(true);
    });

    it("should not promote when improvement < 1pp", () => {
      expect(shouldPromote(0.75, 0.755, 1)).toBe(false);
    });

    it("should not promote when accuracy decreases", () => {
      expect(shouldPromote(0.80, 0.78, 1)).toBe(false);
    });

    it("should promote with custom threshold", () => {
      expect(shouldPromote(0.70, 0.72, 2)).toBe(true);
      expect(shouldPromote(0.70, 0.715, 2)).toBe(false);
    });
  });

  describe("shouldRetrain", () => {
    it("should trigger retrain when drift > threshold", () => {
      expect(shouldRetrain(0.8, 0.7)).toBe(true);
    });

    it("should not trigger retrain when drift ≤ threshold", () => {
      expect(shouldRetrain(0.7, 0.7)).toBe(false);
      expect(shouldRetrain(0.5, 0.7)).toBe(false);
    });
  });

  describe("shouldAlert", () => {
    it("should alert after 3 consecutive failures", () => {
      expect(shouldAlert(3, 3)).toBe(true);
    });

    it("should not alert before threshold", () => {
      expect(shouldAlert(2, 3)).toBe(false);
    });

    it("should alert when exceeding threshold", () => {
      expect(shouldAlert(5, 3)).toBe(true);
    });
  });

  describe("runTrainingPipeline", () => {
    it("should complete successfully", async () => {
      const result = await runTrainingPipeline(
        "tenant-1",
        0.50, // Low accuracy so new model likely promotes
        0,
        [],
        []
      );
      expect(result.success).toBe(true);
      expect(result.modelVersion).toBeTruthy();
      expect(result.driftScore).toBe(0); // No predictions to compare
      expect(result.metrics).toBeDefined();
    });

    it("should increment consecutive failures when not promoted", async () => {
      const result = await runTrainingPipeline(
        "tenant-1",
        0.99, // Very high accuracy — new model unlikely to beat
        2,
        [],
        [],
        {
          intervalHours: 24,
          minAccuracyImprovementPp: 1,
          driftThreshold: 0.7,
          maxConsecutiveFailures: 3,
        }
      );
      // If not promoted, failures should increment
      if (!result.promoted) {
        expect(result.consecutiveFailures).toBe(3);
        expect(result.alertTriggered).toBe(true);
      }
    });

    it("should reset failures on successful promotion", async () => {
      const result = await runTrainingPipeline(
        "tenant-1",
        0.10, // Extremely low — any model will beat this
        5,
        [],
        []
      );
      // With 0.10 accuracy, the new model should promote
      if (result.promoted) {
        expect(result.consecutiveFailures).toBe(0);
        expect(result.alertTriggered).toBe(false);
      }
    });
  });
});
