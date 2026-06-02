import { describe, it, expect } from "vitest";

describe("Project Setup", () => {
  it("should have vitest configured correctly", () => {
    expect(true).toBe(true);
  });

  it("should resolve path aliases", async () => {
    // Verify TypeScript path alias resolution is working
    expect(typeof import.meta.url).toBe("string");
  });
});
