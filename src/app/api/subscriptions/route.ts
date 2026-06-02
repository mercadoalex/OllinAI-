/**
 * Subscription Tier Management API — OllinAI Platform
 *
 * GET  /api/subscriptions — Returns the current subscription tier and limits
 * PUT  /api/subscriptions — Change tier (upgrade or downgrade)
 *
 * Requires tenant_admin role.
 *
 * On upgrade: immediately apply new tier limits (new features accessible, new limits, new retention)
 * On downgrade: immediately restrict features not in new tier, keep existing data until archival policy runs
 *
 * Requirements: 8.6, 8.7, 8.8
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import {
  tenantConfigKey,
  withTenantScope,
} from "@/lib/dynamo/tenant-scope";
import { withAuthorization } from "@/lib/middleware/authorize";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SubscriptionTier, SubscriptionConfigItem } from "@/lib/types/dynamo";
import { TIER_DEFINITIONS } from "@/lib/tiers/tier-config";

// ─── Zod Schemas ───────────────────────────────────────────────────────────────

const ChangeTierSchema = z.object({
  tier: z.enum(["starter", "pro", "enterprise"], {
    errorMap: () => ({ message: "tier must be one of: starter, pro, enterprise" }),
  }),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionResponse {
  tier: SubscriptionTier;
  displayName: string;
  maxServices: number | null;
  retentionDays: number | null;
  features: string[];
  activatedAt: string;
  previousTier?: SubscriptionTier;
  tierChangedAt?: string;
}

export interface TierChangeResponse {
  tier: SubscriptionTier;
  previousTier: SubscriptionTier;
  tierChangedAt: string;
  changeType: "upgrade" | "downgrade" | "no_change";
  message: string;
}

// ─── Tier Ordering ─────────────────────────────────────────────────────────────

const TIER_ORDER: Record<SubscriptionTier, number> = {
  starter: 0,
  pro: 1,
  enterprise: 2,
};

/**
 * Determines the type of tier change.
 */
function getChangeType(
  currentTier: SubscriptionTier,
  newTier: SubscriptionTier
): "upgrade" | "downgrade" | "no_change" {
  if (currentTier === newTier) return "no_change";
  return TIER_ORDER[newTier] > TIER_ORDER[currentTier] ? "upgrade" : "downgrade";
}

// ─── GET Handler — Current Subscription ────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authResult = await withAuthorization(request, {
    resource: "service",
    permission: "read",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;

  const subscription = await getSubscriptionRecord(tenantId);

  const tierDef = TIER_DEFINITIONS[subscription.tier];
  const response: SubscriptionResponse = {
    tier: subscription.tier,
    displayName: tierDef.displayName,
    maxServices: tierDef.maxServices,
    retentionDays: tierDef.retentionDays,
    features: Array.from(tierDef.features),
    activatedAt: subscription.activatedAt,
    previousTier: subscription.previousTier,
    tierChangedAt: subscription.tierChangedAt,
  };

  return NextResponse.json(response, { status: 200 });
}

// ─── PUT Handler — Change Tier ─────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  // Require tenant_admin role for tier changes
  const authResult = await withAuthorization(request, {
    resource: "team",
    permission: "create", // Only tenant_admin has create on team
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session } = authResult;
  const tenantId = session.tenantId;

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = ChangeTierSchema.safeParse(body);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const fieldPath = issue.path.join(".") || "tier";
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

  const { tier: newTier } = validation.data;

  // Get current subscription
  const currentSubscription = await getSubscriptionRecord(tenantId);
  const currentTier = currentSubscription.tier;
  const changeType = getChangeType(currentTier, newTier);

  if (changeType === "no_change") {
    return NextResponse.json(
      {
        tier: currentTier,
        previousTier: currentTier,
        tierChangedAt: new Date().toISOString(),
        changeType: "no_change",
        message: `Already on the ${TIER_DEFINITIONS[currentTier].displayName} tier.`,
      } satisfies TierChangeResponse,
      { status: 200 }
    );
  }

  // Apply the tier change immediately (within 60 seconds requirement)
  const now = new Date().toISOString();

  const updatedSubscription: SubscriptionConfigItem = {
    PK: tenantConfigKey(tenantId),
    SK: "SUBSCRIPTION#current",
    entityData: {
      tier: newTier,
      activatedAt: now,
      previousTier: currentTier,
      tierChangedAt: now,
    },
  };

  const client = getDocumentClient();
  await client.send(
    new PutCommand(
      withTenantScope(tenantId, {
        TableName: TableNames.CONFIG,
        Item: updatedSubscription as unknown as Record<string, unknown>,
      })
    )
  );

  // Build response message based on change type
  const newTierDef = TIER_DEFINITIONS[newTier];
  let message: string;

  if (changeType === "upgrade") {
    message =
      `Upgraded to ${newTierDef.displayName} tier. ` +
      `New limits are now active: ` +
      `${newTierDef.maxServices === null ? "unlimited" : newTierDef.maxServices} services, ` +
      `${newTierDef.retentionDays === null ? "unlimited" : newTierDef.retentionDays + "-day"} retention.`;
  } else {
    // Downgrade
    message =
      `Downgraded to ${newTierDef.displayName} tier. ` +
      `New limits are now active: ` +
      `${newTierDef.maxServices === null ? "unlimited" : newTierDef.maxServices} services, ` +
      `${newTierDef.retentionDays === null ? "unlimited" : newTierDef.retentionDays + "-day"} retention. ` +
      `Features restricted to the ${newTierDef.displayName} tier. ` +
      `Existing data will be retained until the archival policy runs.`;
  }

  const response: TierChangeResponse = {
    tier: newTier,
    previousTier: currentTier,
    tierChangedAt: now,
    changeType,
    message,
  };

  return NextResponse.json(response, { status: 200 });
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

interface SubscriptionData {
  tier: SubscriptionTier;
  activatedAt: string;
  previousTier?: SubscriptionTier;
  tierChangedAt?: string;
}

/**
 * Retrieves the current subscription record for a tenant.
 * Returns a default "starter" subscription if none exists.
 */
async function getSubscriptionRecord(tenantId: string): Promise<SubscriptionData> {
  const client = getDocumentClient();
  const pk = tenantConfigKey(tenantId);

  const result = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: pk,
        SK: "SUBSCRIPTION#current",
      },
    })
  );

  if (!result.Item) {
    return {
      tier: "starter",
      activatedAt: new Date().toISOString(),
    };
  }

  const item = result.Item as SubscriptionConfigItem;
  return {
    tier: item.entityData.tier,
    activatedAt: item.entityData.activatedAt,
    previousTier: item.entityData.previousTier,
    tierChangedAt: item.entityData.tierChangedAt,
  };
}
