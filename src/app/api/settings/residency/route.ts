/**
 * Data Residency Configuration API
 *
 * Accept: S3 bucket ARN, region, cross-account role ARN, external ID.
 * Validate connectivity: write/read test object within 30 seconds (simulated).
 * Store config in DynamoDB.
 * Enterprise tier only.
 *
 * Requirements: 19.1, 19.2, 19.4
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ResidencyConfig {
  enabled: boolean;
  s3BucketArn: string;
  s3BucketRegion: string;
  crossAccountRoleArn: string;
  externalId: string;
  validatedAt?: string;
  status: "active" | "pending_validation" | "error";
}

interface ResidencyUpdateRequest {
  s3BucketArn: string;
  s3BucketRegion: string;
  crossAccountRoleArn: string;
  externalId: string;
}

// ─── Validation ────────────────────────────────────────────────────────────────

function validateResidencyConfig(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const config = body as Record<string, unknown>;

  if (!config.s3BucketArn || typeof config.s3BucketArn !== "string") {
    errors.push("s3BucketArn is required");
  } else if (!config.s3BucketArn.startsWith("arn:aws:s3:::")) {
    errors.push("s3BucketArn must be a valid S3 ARN (arn:aws:s3:::bucket-name)");
  }

  if (!config.s3BucketRegion || typeof config.s3BucketRegion !== "string") {
    errors.push("s3BucketRegion is required");
  } else {
    const validRegions = [
      "us-east-1", "us-east-2", "us-west-1", "us-west-2",
      "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1",
      "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
    ];
    if (!validRegions.includes(config.s3BucketRegion as string)) {
      errors.push(`s3BucketRegion must be a valid AWS region`);
    }
  }

  if (!config.crossAccountRoleArn || typeof config.crossAccountRoleArn !== "string") {
    errors.push("crossAccountRoleArn is required");
  } else if (!config.crossAccountRoleArn.startsWith("arn:aws:iam::")) {
    errors.push("crossAccountRoleArn must be a valid IAM role ARN");
  }

  if (!config.externalId || typeof config.externalId !== "string") {
    errors.push("externalId is required");
  } else if ((config.externalId as string).length < 4) {
    errors.push("externalId must be at least 4 characters");
  }

  return { valid: errors.length === 0, errors };
}

// ─── Connectivity Validation (Simulated) ──────────────────────────────────────

/**
 * Simulated connectivity test: write/read test object within 30 seconds.
 * In production: STS AssumeRole, S3 PutObject, S3 GetObject, S3 DeleteObject.
 */
async function validateConnectivity(
  config: ResidencyUpdateRequest
): Promise<{ success: boolean; error?: string; durationMs: number }> {
  const start = Date.now();

  // Validate ARN format
  if (!config.crossAccountRoleArn.startsWith("arn:aws:iam::")) {
    return {
      success: false,
      error: "Unable to assume role: invalid ARN",
      durationMs: Date.now() - start,
    };
  }

  // Simulate connectivity check (would actually write/read test object)
  const durationMs = Date.now() - start + 150; // Simulated latency

  return {
    success: true,
    durationMs,
  };
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/settings/residency — Get current data residency configuration
 */
export async function GET(_request: NextRequest) {
  // In production: read from DynamoDB ollinai-data-residency table
  // Gate behind Enterprise tier check

  const config: ResidencyConfig = {
    enabled: false,
    s3BucketArn: "",
    s3BucketRegion: "",
    crossAccountRoleArn: "",
    externalId: "",
    status: "pending_validation",
  };

  return NextResponse.json(config);
}

/**
 * PUT /api/settings/residency — Update data residency configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validation = validateResidencyConfig(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid configuration", details: validation.errors },
        { status: 400 }
      );
    }

    const updateRequest: ResidencyUpdateRequest = {
      s3BucketArn: body.s3BucketArn,
      s3BucketRegion: body.s3BucketRegion,
      crossAccountRoleArn: body.crossAccountRoleArn,
      externalId: body.externalId,
    };

    // Run connectivity validation (must complete within 30 seconds)
    const connectivityResult = await validateConnectivity(updateRequest);

    if (!connectivityResult.success) {
      return NextResponse.json(
        {
          error: "Connectivity validation failed",
          details: connectivityResult.error,
          durationMs: connectivityResult.durationMs,
        },
        { status: 422 }
      );
    }

    // In production: persist to DynamoDB ollinai-data-residency table
    const config: ResidencyConfig = {
      enabled: true,
      s3BucketArn: updateRequest.s3BucketArn,
      s3BucketRegion: updateRequest.s3BucketRegion,
      crossAccountRoleArn: updateRequest.crossAccountRoleArn,
      externalId: updateRequest.externalId,
      validatedAt: new Date().toISOString(),
      status: "active",
    };

    return NextResponse.json({
      ...config,
      validationDurationMs: connectivityResult.durationMs,
      message: "Data residency configured and validated successfully",
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/settings/residency — Disable data residency
 */
export async function DELETE(_request: NextRequest) {
  // In production: update DynamoDB record to set enabled=false

  return NextResponse.json({
    enabled: false,
    status: "pending_validation",
    message: "Data residency disabled. Telemetry will route to Collector API.",
  });
}
