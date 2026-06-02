import { describe, it, expect } from "vitest";
import {
  parseSemVer,
  formatSemVer,
  incrementPatch,
  incrementMinor,
  incrementMajor,
  compareSemVer,
  computeDeprecations,
  countRules,
  publishBundle,
  type PublishRequest,
} from "./handler";

describe("Rule Publisher Lambda", () => {
  describe("parseSemVer", () => {
    it("should parse valid semver", () => {
      expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it("should return null for invalid semver", () => {
      expect(parseSemVer("invalid")).toBeNull();
      expect(parseSemVer("1.2")).toBeNull();
      expect(parseSemVer("1.2.3.4")).toBeNull();
    });
  });

  describe("formatSemVer", () => {
    it("should format correctly", () => {
      expect(formatSemVer({ major: 1, minor: 2, patch: 3 })).toBe("1.2.3");
    });
  });

  describe("increment functions", () => {
    const base = { major: 1, minor: 2, patch: 3 };

    it("should increment patch", () => {
      expect(incrementPatch(base)).toEqual({ major: 1, minor: 2, patch: 4 });
    });

    it("should increment minor and reset patch", () => {
      expect(incrementMinor(base)).toEqual({ major: 1, minor: 3, patch: 0 });
    });

    it("should increment major and reset minor/patch", () => {
      expect(incrementMajor(base)).toEqual({ major: 2, minor: 0, patch: 0 });
    });
  });

  describe("compareSemVer", () => {
    it("should compare equal versions", () => {
      const a = { major: 1, minor: 2, patch: 3 };
      expect(compareSemVer(a, a)).toBe(0);
    });

    it("should compare by major", () => {
      const a = { major: 2, minor: 0, patch: 0 };
      const b = { major: 1, minor: 9, patch: 9 };
      expect(compareSemVer(a, b)).toBeGreaterThan(0);
    });

    it("should compare by minor", () => {
      const a = { major: 1, minor: 3, patch: 0 };
      const b = { major: 1, minor: 2, patch: 9 };
      expect(compareSemVer(a, b)).toBeGreaterThan(0);
    });

    it("should compare by patch", () => {
      const a = { major: 1, minor: 2, patch: 4 };
      const b = { major: 1, minor: 2, patch: 3 };
      expect(compareSemVer(a, b)).toBeGreaterThan(0);
    });
  });

  describe("computeDeprecations", () => {
    it("should not deprecate when under retention limit", () => {
      const result = computeDeprecations(["1.0.0", "1.0.1"], "1.0.2");
      expect(result).toHaveLength(0);
    });

    it("should deprecate oldest when exceeding retention limit", () => {
      const result = computeDeprecations(
        ["1.0.0", "1.0.1", "1.0.2"],
        "1.0.3"
      );
      expect(result).toEqual(["1.0.0"]);
    });

    it("should deprecate multiple old versions", () => {
      const result = computeDeprecations(
        ["1.0.0", "1.0.1", "1.0.2", "1.0.3"],
        "1.0.4"
      );
      expect(result).toEqual(["1.0.1", "1.0.0"]);
    });

    it("should handle custom retention", () => {
      const result = computeDeprecations(
        ["1.0.0", "1.0.1"],
        "1.0.2",
        2
      );
      expect(result).toEqual(["1.0.0"]);
    });
  });

  describe("countRules", () => {
    it("should count rules in YAML", () => {
      const yaml = `
- id: "rule-001"
  name: "First"
- id: "rule-002"
  name: "Second"
- id: "rule-003"
  name: "Third"
`;
      expect(countRules(yaml)).toBe(3);
    });

    it("should return 0 for empty YAML", () => {
      expect(countRules("")).toBe(0);
    });
  });

  describe("publishBundle", () => {
    it("should publish first bundle as 1.0.0", async () => {
      const request: PublishRequest = {
        tenantId: "tenant-1",
        rulesYaml: '- id: "test"\n  name: "Test"',
        categories: ["credential_access"],
        publishedBy: "admin",
        isBaseline: false,
      };
      const result = await publishBundle(request, []);
      expect(result.success).toBe(true);
      expect(result.bundleVersion).toBe("1.0.0");
      expect(result.ociDigest).toMatch(/^sha256:/);
      expect(result.ruleCount).toBe(1);
      expect(result.deprecatedVersions).toHaveLength(0);
    });

    it("should increment version from existing", async () => {
      const request: PublishRequest = {
        tenantId: "tenant-1",
        rulesYaml: '- id: "test"\n  name: "Test"',
        categories: ["exfiltration"],
        publishedBy: "admin",
        isBaseline: true,
      };
      const result = await publishBundle(
        request,
        ["1.0.0", "1.0.1", "1.0.2"]
      );
      expect(result.bundleVersion).toBe("1.0.3");
      expect(result.deprecatedVersions).toEqual(["1.0.0"]);
    });
  });
});
