/**
 * Unit tests for HMAC-SHA256 webhook signature verification.
 *
 * Tests cover: signature computation, timing-safe verification,
 * secret key generation, and key length validation.
 *
 * Requirements: 10.5, 10.6
 */

import { describe, it, expect } from "vitest";
import {
  computeSignature,
  verifySignature,
  generateSecretKey,
  validateSecretKeyLength,
} from "@/lib/webhooks/hmac";
import { createHmac } from "crypto";

describe("HMAC-SHA256 Webhook Signature Verification", () => {
  // A valid 32-byte hex-encoded key (64 hex characters)
  const validKey =
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2";

  describe("computeSignature", () => {
    it("should produce a hex-encoded HMAC-SHA256 signature", () => {
      const payload = '{"event":"deploy","service":"api"}';
      const signature = computeSignature(validKey, payload);

      // HMAC-SHA256 produces a 64-character hex string (32 bytes)
      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce consistent signatures for the same input", () => {
      const payload = '{"commitShas":["abc123"]}';
      const sig1 = computeSignature(validKey, payload);
      const sig2 = computeSignature(validKey, payload);

      expect(sig1).toBe(sig2);
    });

    it("should produce different signatures for different payloads", () => {
      const sig1 = computeSignature(validKey, "payload-one");
      const sig2 = computeSignature(validKey, "payload-two");

      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different keys", () => {
      const key2 =
        "f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2";
      const payload = "same-payload";

      const sig1 = computeSignature(validKey, payload);
      const sig2 = computeSignature(key2, payload);

      expect(sig1).not.toBe(sig2);
    });

    it("should handle empty payload", () => {
      const signature = computeSignature(validKey, "");

      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should handle large payloads", () => {
      const largePayload = "x".repeat(1_000_000); // 1MB payload
      const signature = computeSignature(validKey, largePayload);

      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should match Node.js crypto HMAC-SHA256 output", () => {
      const payload = '{"test":"verification"}';
      const expected = createHmac("sha256", validKey)
        .update(payload, "utf8")
        .digest("hex");

      const signature = computeSignature(validKey, payload);

      expect(signature).toBe(expected);
    });

    it("should handle unicode payloads correctly", () => {
      const payload = '{"message":"日本語テスト","emoji":"🚀"}';
      const signature = computeSignature(validKey, payload);

      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("verifySignature", () => {
    it("should return true for a valid signature", () => {
      const payload = '{"event":"deploy"}';
      const signature = computeSignature(validKey, payload);

      expect(verifySignature(validKey, payload, signature)).toBe(true);
    });

    it("should return false for a tampered payload", () => {
      const payload = '{"event":"deploy"}';
      const signature = computeSignature(validKey, payload);

      const tamperedPayload = '{"event":"attack"}';
      expect(verifySignature(validKey, tamperedPayload, signature)).toBe(false);
    });

    it("should return false for a tampered signature", () => {
      const payload = '{"event":"deploy"}';
      // Completely different signature
      const tamperedSignature =
        "0000000000000000000000000000000000000000000000000000000000000000";

      expect(verifySignature(validKey, payload, tamperedSignature)).toBe(false);
    });

    it("should return false for wrong key", () => {
      const payload = '{"event":"deploy"}';
      const signature = computeSignature(validKey, payload);

      const wrongKey =
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      expect(verifySignature(wrongKey, payload, signature)).toBe(false);
    });

    it("should return false for signature with wrong length", () => {
      const payload = '{"event":"deploy"}';
      // Too short
      expect(verifySignature(validKey, payload, "abcdef")).toBe(false);
    });

    it("should return false for empty signature", () => {
      const payload = '{"event":"deploy"}';
      expect(verifySignature(validKey, payload, "")).toBe(false);
    });

    it("should handle empty payload verification", () => {
      const payload = "";
      const signature = computeSignature(validKey, payload);

      expect(verifySignature(validKey, payload, signature)).toBe(true);
    });

    it("should be case-insensitive for hex signatures", () => {
      const payload = '{"event":"deploy"}';
      const signature = computeSignature(validKey, payload);
      const upperSignature = signature.toUpperCase();

      // Both should verify since Buffer.from(hex) is case-insensitive
      expect(verifySignature(validKey, payload, upperSignature)).toBe(true);
    });

    it("should return false for non-hex signature strings", () => {
      const payload = '{"event":"deploy"}';
      // 'zz' is not valid hex, Buffer.from will produce empty/partial buffer
      const invalidHex = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

      expect(verifySignature(validKey, payload, invalidHex)).toBe(false);
    });
  });

  describe("generateSecretKey", () => {
    it("should generate a 64-character hex string (32 bytes)", () => {
      const key = generateSecretKey();

      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key.length).toBe(64);
    });

    it("should generate unique keys on each call", () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateSecretKey());
      }

      // All 100 keys should be unique (collision probability is negligible)
      expect(keys.size).toBe(100);
    });

    it("should pass validateSecretKeyLength", () => {
      const key = generateSecretKey();
      expect(validateSecretKeyLength(key)).toBe(true);
    });
  });

  describe("validateSecretKeyLength", () => {
    it("should return true for a 64-character hex key (32 bytes)", () => {
      expect(validateSecretKeyLength(validKey)).toBe(true);
    });

    it("should return true for keys longer than 32 bytes", () => {
      // 128 hex chars = 64 bytes
      const longKey = "a".repeat(128);
      expect(validateSecretKeyLength(longKey)).toBe(true);
    });

    it("should return false for keys shorter than 32 bytes", () => {
      // 62 hex chars = 31 bytes
      const shortKey = "ab".repeat(31);
      expect(validateSecretKeyLength(shortKey)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(validateSecretKeyLength("")).toBe(false);
    });

    it("should return false for null/undefined values", () => {
      expect(validateSecretKeyLength(null as unknown as string)).toBe(false);
      expect(validateSecretKeyLength(undefined as unknown as string)).toBe(
        false
      );
    });

    it("should handle non-hex strings by checking raw byte length", () => {
      // 32 ASCII characters = 32 bytes in UTF-8
      const rawKey = "this-is-a-32-byte-secret-key!!!"; // 31 chars
      expect(validateSecretKeyLength(rawKey)).toBe(false);

      const validRawKey = "this-is-a-32-byte-secret-key!!!!"; // 32 chars
      expect(validateSecretKeyLength(validRawKey)).toBe(true);
    });

    it("should return true for exactly 64 hex characters", () => {
      const exactKey = "0".repeat(64);
      expect(validateSecretKeyLength(exactKey)).toBe(true);
    });

    it("should return false for 63 hex characters", () => {
      const shortKey = "0".repeat(63);
      expect(validateSecretKeyLength(shortKey)).toBe(false);
    });
  });
});
