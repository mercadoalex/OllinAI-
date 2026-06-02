import { describe, it, expect } from "vitest";
import {
  tenantPrefix,
  tenantServiceKey,
  tenantTeamKey,
  tenantDedupKey,
  tenantMetricsScopeKey,
  tenantConfigKey,
  tenantAuditKey,
  assertTenantOwnership,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";

describe("Tenant Scope — Partition Key Builders", () => {
  const tenantId = "org-123";

  describe("tenantPrefix", () => {
    it("returns TENANT#{tenantId} format", () => {
      expect(tenantPrefix(tenantId)).toBe("TENANT#org-123");
    });

    it("throws on empty tenantId", () => {
      expect(() => tenantPrefix("")).toThrow("tenantId is required");
    });

    it("throws on whitespace-only tenantId", () => {
      expect(() => tenantPrefix("   ")).toThrow("tenantId is required");
    });
  });

  describe("tenantServiceKey", () => {
    it("returns TENANT#{tenantId}#SVC#{serviceId}", () => {
      expect(tenantServiceKey(tenantId, "api-gateway")).toBe(
        "TENANT#org-123#SVC#api-gateway"
      );
    });

    it("throws on empty serviceId", () => {
      expect(() => tenantServiceKey(tenantId, "")).toThrow(
        "serviceId is required"
      );
    });

    it("throws on empty tenantId", () => {
      expect(() => tenantServiceKey("", "api-gateway")).toThrow(
        "tenantId is required"
      );
    });
  });

  describe("tenantTeamKey", () => {
    it("returns TENANT#{tenantId}#TEAM#{teamId}", () => {
      expect(tenantTeamKey(tenantId, "backend-team")).toBe(
        "TENANT#org-123#TEAM#backend-team"
      );
    });

    it("throws on empty teamId", () => {
      expect(() => tenantTeamKey(tenantId, "")).toThrow(
        "teamId is required"
      );
    });
  });

  describe("tenantDedupKey", () => {
    it("returns TENANT#{tenantId}#DEDUP", () => {
      expect(tenantDedupKey(tenantId)).toBe("TENANT#org-123#DEDUP");
    });
  });

  describe("tenantMetricsScopeKey", () => {
    it("returns TENANT#{tenantId}#SCOPE#{scopeType}#{scopeId}", () => {
      expect(tenantMetricsScopeKey(tenantId, "TEAM", "team-1")).toBe(
        "TENANT#org-123#SCOPE#TEAM#team-1"
      );
      expect(tenantMetricsScopeKey(tenantId, "SERVICE", "svc-1")).toBe(
        "TENANT#org-123#SCOPE#SERVICE#svc-1"
      );
      expect(tenantMetricsScopeKey(tenantId, "ALL", "global")).toBe(
        "TENANT#org-123#SCOPE#ALL#global"
      );
    });

    it("throws on empty scopeId", () => {
      expect(() => tenantMetricsScopeKey(tenantId, "TEAM", "")).toThrow(
        "scopeId is required"
      );
    });
  });

  describe("tenantConfigKey", () => {
    it("returns TENANT#{tenantId}", () => {
      expect(tenantConfigKey(tenantId)).toBe("TENANT#org-123");
    });
  });

  describe("tenantAuditKey", () => {
    it("returns TENANT#{tenantId}", () => {
      expect(tenantAuditKey(tenantId)).toBe("TENANT#org-123");
    });
  });
});

describe("Tenant Scope — assertTenantOwnership", () => {
  const tenantId = "org-456";

  it("does not throw when PK belongs to the tenant", () => {
    expect(() =>
      assertTenantOwnership(tenantId, "TENANT#org-456#SVC#my-service")
    ).not.toThrow();
  });

  it("does not throw for config-style keys", () => {
    expect(() =>
      assertTenantOwnership(tenantId, "TENANT#org-456")
    ).not.toThrow();
  });

  it("throws when PK belongs to a different tenant", () => {
    expect(() =>
      assertTenantOwnership(tenantId, "TENANT#org-999#SVC#my-service")
    ).toThrow("Tenant isolation violation");
  });

  it("throws when PK has no tenant prefix", () => {
    expect(() =>
      assertTenantOwnership(tenantId, "SVC#my-service")
    ).toThrow("Tenant isolation violation");
  });
});

describe("Tenant Scope — withTenantScope", () => {
  const tenantId = "org-789";

  it("passes through a correctly scoped Query", () => {
    const params = {
      TableName: "ollinai-events",
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": "TENANT#org-789#SVC#api",
      },
    };

    const result = withTenantScope(tenantId, params);
    expect(result).toBe(params); // Same reference, unmodified
  });

  it("passes through a correctly scoped Get (Key.PK)", () => {
    const params = {
      TableName: "ollinai-config",
      Key: {
        PK: "TENANT#org-789",
        SK: "TEAM#team-1",
      },
    };

    expect(() => withTenantScope(tenantId, params)).not.toThrow();
  });

  it("passes through a correctly scoped Put (Item.PK)", () => {
    const params = {
      TableName: "ollinai-events",
      Item: {
        PK: "TENANT#org-789#SVC#api",
        SK: "DEPLOY#2024-01-01#evt-1",
        eventId: "evt-1",
      },
    };

    expect(() => withTenantScope(tenantId, params)).not.toThrow();
  });

  it("throws when Key.PK belongs to another tenant", () => {
    const params = {
      TableName: "ollinai-config",
      Key: {
        PK: "TENANT#other-tenant",
        SK: "TEAM#team-1",
      },
    };

    expect(() => withTenantScope(tenantId, params)).toThrow(
      "Tenant isolation violation"
    );
  });

  it("throws when Item.PK belongs to another tenant", () => {
    const params = {
      TableName: "ollinai-events",
      Item: {
        PK: "TENANT#other-tenant#SVC#api",
        SK: "DEPLOY#2024-01-01#evt-1",
      },
    };

    expect(() => withTenantScope(tenantId, params)).toThrow(
      "Tenant isolation violation"
    );
  });

  it("throws when ExpressionAttributeValues :pk belongs to another tenant", () => {
    const params = {
      TableName: "ollinai-events",
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": "TENANT#attacker-org#SVC#api",
      },
    };

    expect(() => withTenantScope(tenantId, params)).toThrow(
      "Tenant isolation violation"
    );
  });

  it("throws when tenantId is empty", () => {
    const params = {
      TableName: "ollinai-events",
      Key: { PK: "TENANT#org-789", SK: "x" },
    };

    expect(() => withTenantScope("", params)).toThrow(
      "tenantId is required for all data access operations"
    );
  });

  it("does not validate non-PK ExpressionAttributeValues", () => {
    const params = {
      TableName: "ollinai-events",
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": "TENANT#org-789#SVC#api",
        ":sk": "DEPLOY#",
      },
    };

    expect(() => withTenantScope(tenantId, params)).not.toThrow();
  });

  it("handles params with no Key, Item, or ExpressionAttributeValues gracefully", () => {
    const params = {
      TableName: "ollinai-events",
    };

    // Should not throw — just validates tenantId
    expect(() => withTenantScope(tenantId, params as any)).not.toThrow();
  });
});
