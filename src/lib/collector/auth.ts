/**
 * Agent token validation — extracted for testability.
 */

import { NextRequest } from "next/server";

export function validateAgentToken(request: NextRequest): {
  valid: boolean;
  tenantId?: string;
  error?: string;
} {
  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    return { valid: false, error: "Missing Authorization header" };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed Authorization header" };
  }

  const [scheme, token] = parts;

  if (scheme !== "Bearer" && scheme !== "AgentKey") {
    return { valid: false, error: "Unsupported authentication scheme" };
  }

  const tokenParts = token.split(".");
  if (tokenParts.length < 2 || !tokenParts[0]) {
    return { valid: false, error: "Invalid token format" };
  }

  return { valid: true, tenantId: tokenParts[0] };
}
