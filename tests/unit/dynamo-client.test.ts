import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createDocumentClient,
  getDocumentClient,
  getBaseClient,
  resetClients,
  TableNames,
} from "@/lib/dynamo/client";

describe("DynamoDB Client Factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    resetClients();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetClients();
  });

  describe("createDocumentClient", () => {
    it("creates a document client with local endpoint when DYNAMODB_ENDPOINT is set", () => {
      process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
      const client = createDocumentClient();
      expect(client).toBeDefined();
    });

    it("creates a document client with explicit options", () => {
      const client = createDocumentClient({
        endpoint: "http://localhost:9000",
        region: "eu-west-1",
      });
      expect(client).toBeDefined();
    });

    it("creates a document client without endpoint for production", () => {
      delete process.env.DYNAMODB_ENDPOINT;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.AWS_REGION = "us-west-2";

      const client = createDocumentClient();
      expect(client).toBeDefined();
    });

    it("logs DAX info when DAX is enabled", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.DYNAMODB_ENDPOINT;

      createDocumentClient({
        useDax: true,
        daxEndpoint: "dax://my-cluster.dax.us-east-1.amazonaws.com:8111",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("DAX enabled")
      );
      consoleSpy.mockRestore();
    });

    it("does not enable DAX in local environment even if USE_DAX is true", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
      process.env.USE_DAX = "true";
      process.env.DAX_ENDPOINT = "dax://my-cluster.dax.us-east-1.amazonaws.com:8111";

      createDocumentClient();

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getDocumentClient (singleton)", () => {
    it("returns the same instance on multiple calls", () => {
      process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
      const client1 = getDocumentClient();
      const client2 = getDocumentClient();
      expect(client1).toBe(client2);
    });

    it("returns a fresh instance after resetClients", () => {
      process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
      const client1 = getDocumentClient();
      resetClients();
      const client2 = getDocumentClient();
      expect(client1).not.toBe(client2);
    });
  });

  describe("getBaseClient (singleton)", () => {
    it("returns the same instance on multiple calls", () => {
      process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
      const client1 = getBaseClient();
      const client2 = getBaseClient();
      expect(client1).toBe(client2);
    });

    it("returns a fresh instance after resetClients", () => {
      process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
      const client1 = getBaseClient();
      resetClients();
      const client2 = getBaseClient();
      expect(client1).not.toBe(client2);
    });
  });

  describe("TableNames", () => {
    it("defines all Phase 1 table names", () => {
      expect(TableNames.EVENTS).toBe("ollinai-events");
      expect(TableNames.INCIDENTS).toBe("ollinai-incidents");
      expect(TableNames.METRICS).toBe("ollinai-metrics");
      expect(TableNames.CONFIG).toBe("ollinai-config");
      expect(TableNames.AUDIT).toBe("ollinai-audit");
    });

    it("has exactly 5 tables for Phase 1", () => {
      expect(Object.keys(TableNames)).toHaveLength(5);
    });
  });
});
