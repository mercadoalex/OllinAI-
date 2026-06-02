import { describe, it, expect } from "vitest";
import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function createRequest(method: string, url: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("Rules API", () => {
  describe("GET /api/rules", () => {
    it("should return baseline rules by default", async () => {
      const req = createRequest("GET", "http://localhost:3000/api/rules");
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.length).toBeGreaterThanOrEqual(4); // 4 baseline rules
      expect(data.baseline).toBe(4);
    });

    it("should exclude baseline rules when includeBaseline=false", async () => {
      const req = createRequest(
        "GET",
        "http://localhost:3000/api/rules?includeBaseline=false"
      );
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.custom).toBe(0);
    });
  });

  describe("POST /api/rules", () => {
    it("should create a valid rule", async () => {
      const rule = {
        id: "custom-001",
        name: "Custom rule",
        description: "Test custom rule",
        severity: "warning",
        match: {
          networkDestination: {
            domains: [".suspicious.com"],
          },
        },
      };
      const req = createRequest("POST", "http://localhost:3000/api/rules", rule);
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.id).toBe("custom-001");
      expect(data.status).toBe("created");
    });

    it("should reject rule without id", async () => {
      const rule = {
        name: "No ID rule",
        severity: "warning",
        match: { networkDestination: { domains: [".test.com"] } },
      };
      const req = createRequest("POST", "http://localhost:3000/api/rules", rule);
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should reject rule with invalid severity", async () => {
      const rule = {
        id: "bad-001",
        name: "Bad severity",
        severity: "extreme",
        match: { networkDestination: { domains: [".test.com"] } },
      };
      const req = createRequest("POST", "http://localhost:3000/api/rules", rule);
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should reject rule without match block", async () => {
      const rule = {
        id: "no-match-001",
        name: "No match",
        severity: "warning",
        match: {},
      };
      const req = createRequest("POST", "http://localhost:3000/api/rules", rule);
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
