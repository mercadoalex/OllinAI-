import { describe, it, expect } from "vitest";
import { GET, PUT, DELETE } from "./route";
import { NextRequest } from "next/server";

function createRequest(method: string, url: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("Data Residency Configuration API", () => {
  describe("GET /api/settings/residency", () => {
    it("should return current config", async () => {
      const req = createRequest(
        "GET",
        "http://localhost:3000/api/settings/residency"
      );
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveProperty("enabled");
      expect(data).toHaveProperty("status");
    });
  });

  describe("PUT /api/settings/residency", () => {
    it("should accept valid configuration", async () => {
      const body = {
        s3BucketArn: "arn:aws:s3:::my-tenant-bucket",
        s3BucketRegion: "us-west-2",
        crossAccountRoleArn: "arn:aws:iam::123456789012:role/OllinAIRole",
        externalId: "secure-external-id-123",
      };
      const req = createRequest(
        "PUT",
        "http://localhost:3000/api/settings/residency",
        body
      );
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.enabled).toBe(true);
      expect(data.status).toBe("active");
      expect(data.validatedAt).toBeTruthy();
    });

    it("should reject invalid S3 ARN", async () => {
      const body = {
        s3BucketArn: "not-an-arn",
        s3BucketRegion: "us-west-2",
        crossAccountRoleArn: "arn:aws:iam::123456789012:role/Role",
        externalId: "ext-id-123",
      };
      const req = createRequest(
        "PUT",
        "http://localhost:3000/api/settings/residency",
        body
      );
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });

    it("should reject invalid region", async () => {
      const body = {
        s3BucketArn: "arn:aws:s3:::bucket",
        s3BucketRegion: "invalid-region",
        crossAccountRoleArn: "arn:aws:iam::123456789012:role/Role",
        externalId: "ext-id-123",
      };
      const req = createRequest(
        "PUT",
        "http://localhost:3000/api/settings/residency",
        body
      );
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });

    it("should reject short external ID", async () => {
      const body = {
        s3BucketArn: "arn:aws:s3:::bucket",
        s3BucketRegion: "us-west-2",
        crossAccountRoleArn: "arn:aws:iam::123456789012:role/Role",
        externalId: "ab",
      };
      const req = createRequest(
        "PUT",
        "http://localhost:3000/api/settings/residency",
        body
      );
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });

    it("should reject missing required fields", async () => {
      const body = { s3BucketArn: "arn:aws:s3:::bucket" };
      const req = createRequest(
        "PUT",
        "http://localhost:3000/api/settings/residency",
        body
      );
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/settings/residency", () => {
    it("should disable data residency", async () => {
      const req = createRequest(
        "DELETE",
        "http://localhost:3000/api/settings/residency"
      );
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.enabled).toBe(false);
    });
  });
});
