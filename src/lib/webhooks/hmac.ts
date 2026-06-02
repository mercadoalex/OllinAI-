/**
 * HMAC-SHA256 webhook signature verification.
 *
 * Each integration has a unique secret key (minimum 32 bytes).
 * The webhook sender computes HMAC-SHA256(secret_key, request_body) and includes
 * it in the X-OllinAI-Signature header. The server recomputes the HMAC and
 * compares using timing-safe comparison to prevent timing attacks.
 *
 * Requirements: 10.5, 10.6
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/** Minimum secret key length in bytes */
const MIN_SECRET_KEY_BYTES = 32;

/**
 * Computes an HMAC-SHA256 signature for the given payload using the secret key.
 *
 * @param secretKey - The hex-encoded secret key for the integration
 * @param payload - The raw request body string
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function computeSignature(secretKey: string, payload: string): string {
  const hmac = createHmac("sha256", secretKey);
  hmac.update(payload, "utf8");
  return hmac.digest("hex");
}

/**
 * Verifies an HMAC-SHA256 signature using timing-safe comparison.
 *
 * Compares the provided signature against the expected signature computed from
 * the secret key and payload. Uses constant-time comparison to prevent timing
 * side-channel attacks.
 *
 * @param secretKey - The hex-encoded secret key for the integration
 * @param payload - The raw request body string
 * @param signature - The signature to verify (hex-encoded)
 * @returns true if the signature is valid, false otherwise
 */
export function verifySignature(
  secretKey: string,
  payload: string,
  signature: string
): boolean {
  const expected = computeSignature(secretKey, payload);

  // Both must be valid hex strings of equal length for timing-safe comparison
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  // If lengths differ, the signature is invalid
  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

/**
 * Generates a cryptographically secure secret key for webhook signature verification.
 *
 * Produces a 32-byte (256-bit) random key, hex-encoded (64 characters).
 *
 * @returns Hex-encoded 32-byte secret key
 */
export function generateSecretKey(): string {
  return randomBytes(MIN_SECRET_KEY_BYTES).toString("hex");
}

/**
 * Validates that a secret key meets the minimum length requirement.
 *
 * Keys must be at least 32 bytes. For hex-encoded keys, this means
 * at least 64 hex characters.
 *
 * @param key - The key to validate (hex-encoded string)
 * @returns true if the key is at least 32 bytes (64 hex characters)
 */
export function validateSecretKeyLength(key: string): boolean {
  if (!key || typeof key !== "string") {
    return false;
  }

  // Check if the key is a valid hex string
  if (!/^[0-9a-fA-F]+$/.test(key)) {
    // If not hex-encoded, check raw byte length
    return Buffer.byteLength(key, "utf8") >= MIN_SECRET_KEY_BYTES;
  }

  // For hex-encoded keys, each byte is represented by 2 hex characters
  return key.length >= MIN_SECRET_KEY_BYTES * 2;
}
