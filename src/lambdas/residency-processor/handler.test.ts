import { describe, it, expect } from "vitest";
import {
  assumeCrossAccountRole,
  readTelemetryFromBucket,
  extractDerivedMetrics,
  processResidencyTelemetry,
  type DataResidencyConfig,
} from "./handler";

describe("Residency Processor Lambda", () => {
  const validConfig: DataResidencyConfig = {
    tenantId: "tenant-1",
    enabled: true,
    s3BucketArn: "arn:aws:s3:::tenant-ollinai-telemetry",
    s3BucketRegion: "us-west-2",
    crossAccountRoleArn:
      "arn:aws:iam::123456789012:role/OllinAICrossAccountRole",
    externalId: "ext-id-secure-12345",
    validatedAt: "2024-01-15T00:00:00Z",
    status: "active",
  };

  describe("assumeCrossAccountRole", () => {
    it("should succeed with valid ARN and external ID", async () => {
      const result = await assumeCrossAccountRole(
        "arn:aws:iam::123456789012:role/TestRole",
        "external-id-123"
      );
      expect(result.success).toBe(true);
      expect(result.credentials).toBeDefined();
      expect(result.credentials!.accessKeyId).toBeTruthy();
      expect(result.credentials!.sessionToken).toBeTruthy();
    });

    it("should fail with invalid ARN", async () => {
      const result = await assumeCrossAccountRole(
        "invalid-arn",
        "external-id-123"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid role ARN");
    });

    it("should fail with too-short external ID", async () => {
      const result = await assumeCrossAccountRole(
        "arn:aws:iam::123456789012:role/TestRole",
        "ab"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("External ID");
    });

    it("should fail with empty role ARN", async () => {
      const result = await assumeCrossAccountRole("", "external-id-123");
      expect(result.success).toBe(false);
    });
  });

  describe("readTelemetryFromBucket", () => {
    it("should return telemetry object keys", async () => {
      const result = await readTelemetryFromBucket(
        "arn:aws:s3:::bucket",
        "us-west-2",
        {
          accessKeyId: "key",
          secretAccessKey: "secret",
          sessionToken: "token",
          expiration: "2024-01-16T00:00:00Z",
        }
      );
      expect(result.count).toBeGreaterThan(0);
      expect(result.objects.length).toBe(result.count);
    });
  });

  describe("extractDerivedMetrics", () => {
    it("should extract derived metrics from raw objects", () => {
      const metrics = extractDerivedMetrics("tenant-1", [
        "batch-1.json",
        "batch-2.json",
      ]);
      expect(metrics.length).toBeGreaterThan(0);
      for (const m of metrics) {
        expect(m.tenantId).toBe("tenant-1");
        expect(m.processedAt).toBeTruthy();
      }
    });
  });

  describe("processResidencyTelemetry", () => {
    it("should process successfully with valid config", async () => {
      const result = await processResidencyTelemetry(validConfig);
      expect(result.success).toBe(true);
      expect(result.objectsProcessed).toBeGreaterThan(0);
      expect(result.derivedMetricsWritten).toBeGreaterThan(0);
      expect(result.rawTelemetryPersisted).toBe(false);
      expect(result.errors).toHaveLength(0);
    });

    it("should NEVER persist raw telemetry", async () => {
      const result = await processResidencyTelemetry(validConfig);
      expect(result.rawTelemetryPersisted).toBe(false);
    });

    it("should fail gracefully on invalid role ARN", async () => {
      const result = await processResidencyTelemetry({
        ...validConfig,
        crossAccountRoleArn: "invalid-arn",
      });
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.rawTelemetryPersisted).toBe(false);
    });

    it("should fail gracefully on invalid external ID", async () => {
      const result = await processResidencyTelemetry({
        ...validConfig,
        externalId: "ab",
      });
      expect(result.success).toBe(false);
      expect(result.rawTelemetryPersisted).toBe(false);
    });
  });
});
