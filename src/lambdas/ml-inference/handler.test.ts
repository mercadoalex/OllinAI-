import { describe, it, expect } from "vitest";
import { runInference, shouldUseMlModel, type InferenceRequest } from "./handler";
import type { FeatureInput } from "@/lib/ml/features";

describe("ML Inference Lambda", () => {
  const baseFeatureInput: FeatureInput = {
    filesChanged: 10,
    linesAdded: 200,
    linesRemoved: 50,
    deploymentTimestamp: "2024-01-15T14:30:00Z",
    serviceDeployments30d: 20,
    serviceFailures30d: 4,
    authorDeployments90d: 50,
    authorFailures90d: 5,
    lastIncidentTimestamp: "2024-01-14T10:00:00Z",
    dependencyCount: 8,
    ebpfAnomalyScore: 0.3,
  };

  describe("shouldUseMlModel", () => {
    it("should return true when all conditions are met", () => {
      expect(shouldUseMlModel(200, 20, true)).toBe(true);
    });

    it("should return false when model unavailable", () => {
      expect(shouldUseMlModel(200, 20, false)).toBe(false);
    });

    it("should return false when events below threshold", () => {
      expect(shouldUseMlModel(50, 20, true)).toBe(false);
    });

    it("should return false when incidents below threshold", () => {
      expect(shouldUseMlModel(200, 5, true)).toBe(false);
    });

    it("should return false at exact threshold boundaries", () => {
      expect(shouldUseMlModel(99, 10, true)).toBe(false);
      expect(shouldUseMlModel(100, 9, true)).toBe(false);
    });

    it("should return true at exact threshold values", () => {
      expect(shouldUseMlModel(100, 10, true)).toBe(true);
    });
  });

  describe("runInference", () => {
    it("should return a prediction score between 0 and 1", async () => {
      const request: InferenceRequest = {
        tenantId: "tenant-1",
        eventId: "event-1",
        featureInput: baseFeatureInput,
        totalEvents: 200,
        totalIncidents: 20,
      };

      const result = await runInference(request);
      expect(result.predictionScore).toBeGreaterThanOrEqual(0);
      expect(result.predictionScore).toBeLessThanOrEqual(1);
      expect(result.source).toBe("ml_model");
      expect(result.modelVersion).toBeTruthy();
      expect(result.inferenceLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should fall back to rule engine when below thresholds", async () => {
      const request: InferenceRequest = {
        tenantId: "tenant-1",
        eventId: "event-1",
        featureInput: baseFeatureInput,
        totalEvents: 50, // Below 100 threshold
        totalIncidents: 5, // Below 10 threshold
      };

      const result = await runInference(request);
      expect(result.source).toBe("rule_engine");
      expect(result.predictionScore).toBeGreaterThanOrEqual(0);
      expect(result.predictionScore).toBeLessThanOrEqual(1);
    });

    it("should return neutral score on invalid feature input", async () => {
      const request: InferenceRequest = {
        tenantId: "tenant-1",
        eventId: "event-1",
        featureInput: {
          ...baseFeatureInput,
          deploymentTimestamp: "invalid-date",
        },
        totalEvents: 200,
        totalIncidents: 20,
      };

      const result = await runInference(request);
      expect(result.source).toBe("rule_engine");
      expect(result.predictionScore).toBe(0.5);
    });
  });
});
