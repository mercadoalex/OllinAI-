/**
 * Rule_Bundle Management API
 *
 * Manages rule bundles: publish, list, and rollback operations.
 *
 * Requirements: 18.3, 18.4
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RuleBundleRecord {
  bundleVersion: string;
  ociDigest: string;
  ociRegistryUri: string;
  ruleCount: number;
  categories: string[];
  publishedAt: string;
  publishedBy: string;
  isBaseline: boolean;
  status: "active" | "rollback" | "deprecated";
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/rules/bundles — List bundles for the tenant
 */
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") || "active";

  // In production: query DynamoDB ollinai-rule-bundles table
  const bundles: RuleBundleRecord[] = [
    {
      bundleVersion: "1.0.0",
      ociDigest: "sha256:abc123",
      ociRegistryUri: "123456789.dkr.ecr.us-east-1.amazonaws.com/ollinai-rules/baseline:1.0.0",
      ruleCount: 4,
      categories: ["credential_access", "exfiltration", "crypto_miner", "malicious_domains"],
      publishedAt: new Date().toISOString(),
      publishedBy: "system",
      isBaseline: true,
      status: "active",
    },
  ];

  const filtered = bundles.filter((b) => b.status === status);

  return NextResponse.json({
    data: filtered,
    pagination: {
      totalCount: filtered.length,
      currentPage: 1,
      pageSize: filtered.length,
      hasMore: false,
    },
  });
}

/**
 * POST /api/rules/bundles — Trigger bundle publication
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categories, publishedBy } = body;

    if (!categories || !Array.isArray(categories)) {
      return NextResponse.json(
        { error: "categories array is required" },
        { status: 400 }
      );
    }

    // In production: invoke rule-publisher Lambda
    const result = {
      bundleVersion: "1.0.1",
      ociDigest: `sha256:${Date.now().toString(16)}`,
      ociRegistryUri: `123456789.dkr.ecr.us-east-1.amazonaws.com/ollinai-rules/tenant:1.0.1`,
      ruleCount: 0,
      categories,
      publishedAt: new Date().toISOString(),
      publishedBy: publishedBy || "api",
      status: "active",
      message: "Bundle publication initiated. Agents will receive update at next poll.",
    };

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
}
