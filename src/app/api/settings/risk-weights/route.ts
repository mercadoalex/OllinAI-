/**
 * Risk Weight Configuration API
 *
 * GET  /api/settings/risk-weights — Get current risk weights (custom or defaults)
 * PUT  /api/settings/risk-weights — Validate and save custom risk weights (tenant_admin only)
 *
 * Risk weights determine how much each factor contributes to the overall risk score.
 * All weights must be in [0, 1] and sum to exactly 1.0 (with 0.001 floating-point tolerance).
 *
 * Stored in ollinai-config table:
 *   PK: TENANT#{tenantId}
 *   SK: SETTINGS#risk_weights
 *
 * Requirements: 4.4, 4.8
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuthorization } from "@/lib/middleware/authorize";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { RiskWeightsConfigItem } from "@/lib/types/dynamo";

// ─── Constants ─────────────────────────────────────────────────────────────────

const SORT_KEY = "SETTINGS#risk_weights";

/** Default risk factor weights (must sum to 1.0) */
export const DEFAULT_RISK_WEIGHTS = {
  changeFailureRate: 0.35,
  changeSize: 0.25,
  deploymentTiming: 0.20,
  authorFailureRate: 0.20,
} as const;

/** Floating-point tolerance for sum validation */
const SUM_TOLERANCE = 0.001;

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const RiskWeightsSchema = z
  .object({
    changeFailureRate: z
      .number({
        required_error: "changeFailureRate is required",
        invalid_type_error: "changeFailureRate must be a number",
      })
      .min(0, "changeFailureRate must be between 0 and 1")
      .max(1, "changeFailureRate must be between 0 and 1"),
    changeSize: z
      .number({
        required_error: "changeSize is required",
        invalid_type_error: "changeSize must be a number",
      })
      .min(0, "changeSize must be between 0 and 1")
      .max(1, "changeSize must be between 0 and 1"),
    deploymentTiming: z
      .number({
        required_error: "deploymentTiming is required",
        invalid_type_error: "deploymentTiming must be a number",
      })
      .min(0, "deploymentTiming must be between 0 and 1")
      .max(1, "deploymentTiming must be between 0 and 1"),
    authorFailureRate: z
      .number({
        required_error: "authorFailureRate is required",
        invalid_type_error: "authorFailureRate must be a number",
      })
      .min(0, "authorFailureRate must be between 0 and 1")
      .max(1, "authorFailureRate must be between 0 and 1"),
  })
  .refine(
    (data) => {
      const sum =
        data.changeFailureRate +
        data.changeSize +
        data.deploymentTiming +
        data.authorFailureRate;
      return Math.abs(sum - 1.0) < SUM_TOLERANCE;
    },
    {
      message: `Weights must sum to 1.0 (tolerance: ${SUM_TOLERANCE})`,
      path: ["_sum"],
    }
  );

// ─── GET /api/settings/risk-weights ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Authorize: any authenticated user can read settings
  const result = await withAuthorization(request, {
    resource: "settings",
    permission: "read",
  });
  if (result instanceof NextResponse) {
    return result;
  }

  const { session } = result;
  const tenantId = session.tenantId;
  const client = getDocumentClient();

  // Fetch current risk weights configuration
  const getParams = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    Key: {
      PK: tenantConfigKey(tenantId),
      SK: SORT_KEY,
    },
  });

  const getResult = await client.send(new GetCommand(getParams));

  if (getResult.Item) {
    const item = getResult.Item as unknown as RiskWeightsConfigItem;
    return NextResponse.json(
      {
        weights: {
          changeFailureRate: item.entityData.changeFailureRate,
          changeSize: item.entityData.changeSize,
          deploymentTiming: item.entityData.deploymentTiming,
          authorFailureRate: item.entityData.authorFailureRate,
        },
        updatedAt: item.entityData.updatedAt,
        updatedBy: item.entityData.updatedBy,
        isDefault: false,
      },
      { status: 200 }
    );
  }

  // No custom configuration — return defaults
  return NextResponse.json(
    {
      weights: { ...DEFAULT_RISK_WEIGHTS },
      updatedAt: null,
      updatedBy: null,
      isDefault: true,
    },
    { status: 200 }
  );
}

// ─── PUT /api/settings/risk-weights ────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  // Authorize: only tenant_admin can update settings
  const result = await withAuthorization(request, {
    resource: "settings",
    permission: "update",
  });
  if (result instanceof NextResponse) {
    return result;
  }

  const { session } = result;
  const tenantId = session.tenantId;

  // Parse and validate payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = RiskWeightsSchema.safeParse(body);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const fieldPath = issue.path.join(".") || "_general";
      if (!fieldErrors[fieldPath]) {
        fieldErrors[fieldPath] = [];
      }
      fieldErrors[fieldPath].push(issue.message);
    }
    return NextResponse.json(
      { error: "Validation failed", fields: fieldErrors },
      { status: 400 }
    );
  }

  const { changeFailureRate, changeSize, deploymentTiming, authorFailureRate } =
    validation.data;
  const now = new Date().toISOString();
  const client = getDocumentClient();

  // Store the risk weights configuration
  const configItem: RiskWeightsConfigItem = {
    PK: tenantConfigKey(tenantId),
    SK: SORT_KEY,
    entityData: {
      changeFailureRate,
      changeSize,
      deploymentTiming,
      authorFailureRate,
      updatedAt: now,
      updatedBy: session.userId,
    },
  };

  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: configItem as unknown as Record<string, unknown>,
      })
    )
  );

  return NextResponse.json(
    {
      weights: {
        changeFailureRate,
        changeSize,
        deploymentTiming,
        authorFailureRate,
      },
      updatedAt: now,
      updatedBy: session.userId,
      isDefault: false,
    },
    { status: 200 }
  );
}
