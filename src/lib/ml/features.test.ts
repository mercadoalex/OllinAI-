import { describe, it, expect } from "vitest";
import {
  constructFeatureVector,
  normalizeFeatureVector,
  ruleBasedScore,
  type FeatureInput,
} from "./features";

describe("Feature Vector Construction", () => {
  const baseInput: FeatureInput = {
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

  it("should construct a valid feature vector from complete input", () => {
    const result = constructFeatureVector(baseInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.vector).toBeDefined();
    expect(result.vector!.changeSizeFiles).toBe(10);
    expect(result.vector!.changeSizeLines).toBe(250);
    expect(result.vector!.deployHourOfDay).toBe(14);
    expect(result.vector!.deployDayOfWeek).toBe(1); // Monday
    expect(result.vector!.serviceFailureRate30d).toBeCloseTo(0.2);
    expect(result.vector!.authorFailureRate90d).toBeCloseTo(0.1);
    expect(result.vector!.dependencyCount).toBe(8);
    expect(result.vector!.ebpfAnomalyScore).toBe(0.3);
  });

  it("should handle missing optional fields", () => {
    const input: FeatureInput = {
      deploymentTimestamp: "2024-01-15T14:30:00Z",
      serviceDeployments30d: 0,
      serviceFailures30d: 0,
      authorDeployments90d: 0,
      authorFailures90d: 0,
      lastIncidentTimestamp: null,
      dependencyCount: 0,
    };
    const result = constructFeatureVector(input);
    expect(result.valid).toBe(true);
    expect(result.vector!.changeSizeFiles).toBe(0);
    expect(result.vector!.changeSizeLines).toBe(0);
    expect(result.vector!.serviceFailureRate30d).toBe(0);
    expect(result.vector!.timeSinceLastIncident).toBe(720); // Default 30 days
  });

  it("should reject invalid timestamp", () => {
    const input: FeatureInput = {
      ...baseInput,
      deploymentTimestamp: "not-a-date",
    };
    const result = constructFeatureVector(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid deploymentTimestamp");
  });

  it("should reject negative counts", () => {
    const input: FeatureInput = {
      ...baseInput,
      serviceDeployments30d: -1,
    };
    const result = constructFeatureVector(input);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should cap failure rates at 1.0", () => {
    const input: FeatureInput = {
      ...baseInput,
      serviceFailures30d: 25, // More failures than deployments
      serviceDeployments30d: 20,
    };
    const result = constructFeatureVector(input);
    expect(result.valid).toBe(true);
    expect(result.vector!.serviceFailureRate30d).toBe(1.0);
  });

  it("should clamp ebpfAnomalyScore to [0, 1]", () => {
    const input: FeatureInput = {
      ...baseInput,
      ebpfAnomalyScore: 1.5,
    };
    const result = constructFeatureVector(input);
    expect(result.valid).toBe(true);
    expect(result.vector!.ebpfAnomalyScore).toBe(1.0);
  });
});

describe("normalizeFeatureVector", () => {
  it("should produce a 9-element array with values in [0, 1]", () => {
    const vector = constructFeatureVector({
      filesChanged: 50,
      linesAdded: 1000,
      linesRemoved: 500,
      deploymentTimestamp: "2024-01-15T14:30:00Z",
      serviceDeployments30d: 20,
      serviceFailures30d: 4,
      authorDeployments90d: 50,
      authorFailures90d: 5,
      lastIncidentTimestamp: "2024-01-14T10:00:00Z",
      dependencyCount: 8,
      ebpfAnomalyScore: 0.5,
    }).vector!;

    const normalized = normalizeFeatureVector(vector);
    expect(normalized).toHaveLength(9);
    for (const val of normalized) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

describe("ruleBasedScore", () => {
  it("should return a score in [0, 1]", () => {
    const vector = constructFeatureVector({
      filesChanged: 50,
      linesAdded: 1000,
      linesRemoved: 500,
      deploymentTimestamp: "2024-01-15T14:30:00Z",
      serviceDeployments30d: 20,
      serviceFailures30d: 10,
      authorDeployments90d: 50,
      authorFailures90d: 25,
      lastIncidentTimestamp: "2024-01-15T10:00:00Z",
      dependencyCount: 8,
    }).vector!;

    const score = ruleBasedScore(vector);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("should produce higher scores for riskier deployments", () => {
    const safeVector = constructFeatureVector({
      filesChanged: 2,
      linesAdded: 10,
      linesRemoved: 5,
      deploymentTimestamp: "2024-01-15T14:00:00Z", // Tuesday afternoon
      serviceDeployments30d: 50,
      serviceFailures30d: 1,
      authorDeployments90d: 100,
      authorFailures90d: 2,
      lastIncidentTimestamp: "2023-12-01T10:00:00Z", // Long ago
      dependencyCount: 3,
    }).vector!;

    const riskyVector = constructFeatureVector({
      filesChanged: 80,
      linesAdded: 3000,
      linesRemoved: 1000,
      deploymentTimestamp: "2024-01-14T02:00:00Z", // Sunday 2am
      serviceDeployments30d: 10,
      serviceFailures30d: 8,
      authorDeployments90d: 20,
      authorFailures90d: 15,
      lastIncidentTimestamp: "2024-01-14T01:00:00Z", // 1 hour ago
      dependencyCount: 20,
    }).vector!;

    const safeScore = ruleBasedScore(safeVector);
    const riskyScore = ruleBasedScore(riskyVector);
    expect(riskyScore).toBeGreaterThan(safeScore);
  });
});
