/**
 * Correlation Window Configuration API
 *
 * GET  /api/settings/correlation — Get current correlation window (or default 60 min)
 * PUT  /api/settings/correlation — Update correlation window (tenant_admin only)
 *
 * The correlation window determines the time period after a deployment during which
 * incidents are considered potentially caused by that deployment.
 *
 * Stored in ollinai-config table:
 *   PK: TENANT#{tenantId}
 *   SK: SETTINGS#correlation_window
 *
 * Requirements: 2.3, 2.4
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
import type { CorrelationWindowConfigItem } from "@/lib/types/dynamo";

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MINUTES = 60;
const MIN_WINDOW_MINUTES = 5;
const MAX_WINDOW_MINUTES = 1440; // 24 hours
const SORT_KEY = "SETTINGS#correlation_window";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const UpdateCorrelationWindowSchema = z.object({
  windowMinutes: z
    .number({
      required_error: "windowMinutes is required",
      invalid_type_error: "windowMinutes must be a number",
    })
    .int("windowMinutes must be an integer")
    .min(MIN_WINDOW_MINUTES, `windowMinutes must be at least ${MIN_WINDOW_MINUTES} (5 minutes)`)
    .max(MAX_WINDOW_MINUTES, `windowMinutes must be at most ${MAX_WINDOW_MINUTES} (24 hours)`),
});

// ─── GET /api/settings/correlation ─────────────────────────────────────────────

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

  // Fetch current correlation window configuration
  const getParams = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    Key: {
      PK: tenantConfigKey(tenantId),
      SK: SORT_KEY,
    },
  });

  const getResult = await client.send(new GetCommand(getParams));

  if (getResult.Item) {
    const item = getResult.Item as unknown as CorrelationWindowConfigItem;
    return NextResponse.json(
      {
        windowMinutes: item.entityData.windowMinutes,
        updatedAt: item.entityData.updatedAt,
        updatedBy: item.entityData.updatedBy,
        isDefault: false,
      },
      { status: 200 }
    );
  }

  // No custom configuration — return default
  return NextResponse.json(
    {
      windowMinutes: DEFAULT_WINDOW_MINUTES,
      updatedAt: null,
      updatedBy: null,
      isDefault: true,
    },
    { status: 200 }
  );
}

// ─── PUT /api/settings/correlation ─────────────────────────────────────────────

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

  const validation = UpdateCorrelationWindowSchema.safeParse(body);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const fieldPath = issue.path.join(".") || "windowMinutes";
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

  const { windowMinutes } = validation.data;
  const now = new Date().toISOString();
  const client = getDocumentClient();

  // Store the correlation window configuration
  const configItem: CorrelationWindowConfigItem = {
    PK: tenantConfigKey(tenantId),
    SK: SORT_KEY,
    entityData: {
      windowMinutes,
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
      windowMinutes,
      updatedAt: now,
      updatedBy: session.userId,
      isDefault: false,
    },
    { status: 200 }
  );
}
