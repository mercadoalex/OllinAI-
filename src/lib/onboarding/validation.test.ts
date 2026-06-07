import { describe, it, expect } from "vitest";
import { validateIntegrationName } from "./validation";

describe("validateIntegrationName", () => {
  it("accepts a valid alphanumeric name", () => {
    const result = validateIntegrationName("my-integration_01");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a single character name", () => {
    const result = validateIntegrationName("a");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a name at the 100 character limit", () => {
    const name = "a".repeat(100);
    const result = validateIntegrationName(name);
    expect(result).toEqual({ valid: true });
  });

  it("rejects an empty string", () => {
    const result = validateIntegrationName("");
    expect(result).toEqual({
      valid: false,
      error: "Integration name is required",
    });
  });

  it("rejects a name longer than 100 characters", () => {
    const name = "a".repeat(101);
    const result = validateIntegrationName(name);
    expect(result).toEqual({
      valid: false,
      error: "Integration name must be 100 characters or fewer",
    });
  });

  it("rejects a name with spaces", () => {
    const result = validateIntegrationName("my integration");
    expect(result).toEqual({
      valid: false,
      error:
        "Integration name can only contain letters, numbers, hyphens, and underscores",
    });
  });

  it("rejects a name with special characters", () => {
    const result = validateIntegrationName("my@integration!");
    expect(result).toEqual({
      valid: false,
      error:
        "Integration name can only contain letters, numbers, hyphens, and underscores",
    });
  });

  it("rejects a name with dots", () => {
    const result = validateIntegrationName("my.integration");
    expect(result).toEqual({
      valid: false,
      error:
        "Integration name can only contain letters, numbers, hyphens, and underscores",
    });
  });
});
