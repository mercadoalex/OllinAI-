/**
 * Unit tests for subscription tier configuration.
 *
 * Tests cover:
 * - Tier definitions match requirements (8.1, 8.2, 8.3)
 * - Feature availability checks per tier
 * - Service limit enforcement (8.4)
 * - Upgrade message generation (8.5)
 * - Retention period lookups
 */

import { describe, it, expect } from "vitest";
import {
  TIER_DEFINITIONS,
  isFeatureAvailable,
  wouldExceedServiceLimit,
  getRetentionDays,
  getUpgradeMessage,
  getServiceLimitMessage,
  minimumTierForFeature,
  type Feature,
} from "@/lib/tiers/tier-config";

// ─── Tier Definitions ──────────────────────────────────────────────────────────

describe("TIER_DEFINITIONS", () => {
  describe("Starter tier (Requirement 8.1)", () => {
    const starter = TIER_DEFINITIONS.starter;

    it("has max 5 services", () => {
      expect(starter.maxServices).toBe(5);
    });

    it("has 30-day retention", () => {
      expect(starter.retentionDays).toBe(30);
    });

    it("does not include risk_score", () => {
      expect(starter.features.has("risk_score")).toBe(false);
    });

    it("does not include recommendations", () => {
      expect(starter.features.has("recommendations")).toBe(false);
    });

    it("does not include incident_correlation", () => {
      expect(starter.features.has("incident_correlation")).toBe(false);
    });

    it("does not include any features (DORA metrics only)", () => {
      expect(starter.features.size).toBe(0);
    });
  });

  describe("Pro tier (Requirement 8.2)", () => {
    const pro = TIER_DEFINITIONS.pro;

    it("has no service limit", () => {
      expect(pro.maxServices).toBeNull();
    });

    it("has 90-day retention", () => {
      expect(pro.retentionDays).toBe(90);
    });

    it("includes risk_score", () => {
      expect(pro.features.has("risk_score")).toBe(true);
    });

    it("includes incident_correlation", () => {
      expect(pro.features.has("incident_correlation")).toBe(true);
    });

    it("includes recommendations", () => {
      expect(pro.features.has("recommendations")).toBe(true);
    });

    it("includes aiops_predictions", () => {
      expect(pro.features.has("aiops_predictions")).toBe(true);
    });

    it("does not include SSO", () => {
      expect(pro.features.has("sso")).toBe(false);
    });

    it("does not include audit_logs", () => {
      expect(pro.features.has("audit_logs")).toBe(false);
    });

    it("does not include api_access", () => {
      expect(pro.features.has("api_access")).toBe(false);
    });
  });

  describe("Enterprise tier (Requirement 8.3)", () => {
    const enterprise = TIER_DEFINITIONS.enterprise;

    it("has no service limit", () => {
      expect(enterprise.maxServices).toBeNull();
    });

    it("has no retention limit", () => {
      expect(enterprise.retentionDays).toBeNull();
    });

    it("includes all Pro features", () => {
      expect(enterprise.features.has("risk_score")).toBe(true);
      expect(enterprise.features.has("recommendations")).toBe(true);
      expect(enterprise.features.has("incident_correlation")).toBe(true);
      expect(enterprise.features.has("aiops_predictions")).toBe(true);
    });

    it("includes SSO", () => {
      expect(enterprise.features.has("sso")).toBe(true);
    });

    it("includes audit_logs", () => {
      expect(enterprise.features.has("audit_logs")).toBe(true);
    });

    it("includes custom_integrations", () => {
      expect(enterprise.features.has("custom_integrations")).toBe(true);
    });

    it("includes api_access", () => {
      expect(enterprise.features.has("api_access")).toBe(true);
    });

    it("includes data_residency", () => {
      expect(enterprise.features.has("data_residency")).toBe(true);
    });

    it("includes build_attestation", () => {
      expect(enterprise.features.has("build_attestation")).toBe(true);
    });
  });
});

// ─── isFeatureAvailable ────────────────────────────────────────────────────────

describe("isFeatureAvailable", () => {
  const proFeatures: Feature[] = [
    "risk_score",
    "recommendations",
    "incident_correlation",
    "aiops_predictions",
  ];

  const enterpriseOnlyFeatures: Feature[] = [
    "sso",
    "audit_logs",
    "custom_integrations",
    "api_access",
    "data_residency",
    "build_attestation",
  ];

  it("starter has no gated features", () => {
    for (const feature of [...proFeatures, ...enterpriseOnlyFeatures]) {
      expect(isFeatureAvailable("starter", feature)).toBe(false);
    }
  });

  it("pro has risk_score, recommendations, correlation, and predictions", () => {
    for (const feature of proFeatures) {
      expect(isFeatureAvailable("pro", feature)).toBe(true);
    }
  });

  it("pro does not have enterprise-only features", () => {
    for (const feature of enterpriseOnlyFeatures) {
      expect(isFeatureAvailable("pro", feature)).toBe(false);
    }
  });

  it("enterprise has all features", () => {
    for (const feature of [...proFeatures, ...enterpriseOnlyFeatures]) {
      expect(isFeatureAvailable("enterprise", feature)).toBe(true);
    }
  });
});

// ─── wouldExceedServiceLimit ───────────────────────────────────────────────────

describe("wouldExceedServiceLimit", () => {
  it("returns true when starter tier has 5 services", () => {
    expect(wouldExceedServiceLimit("starter", 5)).toBe(true);
  });

  it("returns true when starter tier has more than 5 services", () => {
    expect(wouldExceedServiceLimit("starter", 10)).toBe(true);
  });

  it("returns false when starter tier has 4 services", () => {
    expect(wouldExceedServiceLimit("starter", 4)).toBe(false);
  });

  it("returns false when starter tier has 0 services", () => {
    expect(wouldExceedServiceLimit("starter", 0)).toBe(false);
  });

  it("returns false for pro tier regardless of count", () => {
    expect(wouldExceedServiceLimit("pro", 0)).toBe(false);
    expect(wouldExceedServiceLimit("pro", 100)).toBe(false);
    expect(wouldExceedServiceLimit("pro", 1000)).toBe(false);
  });

  it("returns false for enterprise tier regardless of count", () => {
    expect(wouldExceedServiceLimit("enterprise", 0)).toBe(false);
    expect(wouldExceedServiceLimit("enterprise", 500)).toBe(false);
  });
});

// ─── getRetentionDays ──────────────────────────────────────────────────────────

describe("getRetentionDays", () => {
  it("returns 30 for starter", () => {
    expect(getRetentionDays("starter")).toBe(30);
  });

  it("returns 90 for pro", () => {
    expect(getRetentionDays("pro")).toBe(90);
  });

  it("returns null for enterprise (unlimited)", () => {
    expect(getRetentionDays("enterprise")).toBeNull();
  });
});

// ─── getUpgradeMessage ─────────────────────────────────────────────────────────

describe("getUpgradeMessage", () => {
  it("includes feature name and current tier", () => {
    const message = getUpgradeMessage("starter", "risk_score");
    expect(message).toContain("Deployment Risk Scoring");
    expect(message).toContain("Starter");
  });

  it("suggests the minimum required tier", () => {
    const message = getUpgradeMessage("starter", "risk_score");
    expect(message).toContain("Pro");
  });

  it("suggests enterprise for enterprise-only features", () => {
    const message = getUpgradeMessage("pro", "audit_logs");
    expect(message).toContain("Enterprise");
  });

  it("includes upgrade call to action", () => {
    const message = getUpgradeMessage("starter", "recommendations");
    expect(message).toContain("Upgrade");
  });
});

// ─── getServiceLimitMessage ────────────────────────────────────────────────────

describe("getServiceLimitMessage", () => {
  it("includes the limit number for starter", () => {
    const message = getServiceLimitMessage("starter");
    expect(message).toContain("5");
  });

  it("includes tier name", () => {
    const message = getServiceLimitMessage("starter");
    expect(message).toContain("Starter");
  });

  it("suggests upgrading to Pro", () => {
    const message = getServiceLimitMessage("starter");
    expect(message).toContain("Pro");
  });
});

// ─── minimumTierForFeature ─────────────────────────────────────────────────────

describe("minimumTierForFeature", () => {
  it("returns pro for risk_score", () => {
    expect(minimumTierForFeature("risk_score")).toBe("pro");
  });

  it("returns pro for recommendations", () => {
    expect(minimumTierForFeature("recommendations")).toBe("pro");
  });

  it("returns pro for incident_correlation", () => {
    expect(minimumTierForFeature("incident_correlation")).toBe("pro");
  });

  it("returns enterprise for sso", () => {
    expect(minimumTierForFeature("sso")).toBe("enterprise");
  });

  it("returns enterprise for audit_logs", () => {
    expect(minimumTierForFeature("audit_logs")).toBe("enterprise");
  });

  it("returns enterprise for api_access", () => {
    expect(minimumTierForFeature("api_access")).toBe("enterprise");
  });

  it("returns enterprise for data_residency", () => {
    expect(minimumTierForFeature("data_residency")).toBe("enterprise");
  });

  it("returns enterprise for build_attestation", () => {
    expect(minimumTierForFeature("build_attestation")).toBe("enterprise");
  });
});
