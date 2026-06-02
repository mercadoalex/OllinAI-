/**
 * Tier Gate Middleware — OllinAI Platform
 *
 * Middleware that checks the tenant's subscription tier and gates access
 * to tier-restricted features. Returns HTTP 403 with a descriptive upgrade
 * message when a feature is not available on the tenant's current tier.
 *
 * Requirements:
 *  - 8.4: Reject service registration exceeding Starter limit with upgrade message
 *  - 8.5: Reject tier-restricted feature requests with upgrade suggestion
 *
 * The subscription is stored in `ollinai-config` with SK `SUBSCRIPTION#current`.
 */

import { NextResponse } from "next/server";
import type { SubscriptionTier, SubscriptionConfigItem } from "@/lib/types/dynamo";
import { tenantConfigKey } from "@/lib/dynamo/tenant-scope";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  type Feature,
  isFeatureAvailable,
  getUpgradeMessage,
  wouldExceedServiceLimit,
  getServiceLimitMessage,
} from "@/lib/tiers/tier-config";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TierGateErrorResponse {
  error: string;
  code: "TIER_LIMIT_EXCEEDED" | "FEATURE_NOT_AVAILABLE";
  currentTier: SubscriptionTier;
  requiredAction: "upgrade";
}

export interface TierGateContext {
  tier: SubscriptionTier;
}

// ─── Subscription Lookup ───────────────────────────────────────────────────────

/**
 * Retrieves the current subscription tier for a tenant from DynamoDB.
 * Returns "starter" as default if no subscription record exists.
 */
export async function getTenantSubscription(
  tenantId: string
): Promise<SubscriptionTier> {
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
    return "starter";
  }

  const item = result.Item as SubscriptionConfigItem;
  return item.entityData.tier;
}

// ─── Feature Gate ──────────────────────────────────────────────────────────────

/**
 * Checks if a feature is accessible for the given tenant.
 * Returns a TierGateContext on success, or a 403 NextResponse if the feature
 * is not available on the tenant's current tier.
 *
 * @example
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const gateResult = await withTierGate(tenantId, "risk_score");
 *   if (gateResult instanceof NextResponse) {
 *     return gateResult; // 403 with upgrade message
 *   }
 *   const { tier } = gateResult;
 *   // Proceed with tier-aware logic...
 * }
 * ```
 */
export async function withTierGate(
  tenantId: string,
  feature: Feature
): Promise<TierGateContext | NextResponse> {
  const tier = await getTenantSubscription(tenantId);

  if (!isFeatureAvailable(tier, feature)) {
    return createTierResponse(
      "FEATURE_NOT_AVAILABLE",
      getUpgradeMessage(tier, feature),
      tier
    );
  }

  return { tier };
}

// ─── Service Limit Gate ────────────────────────────────────────────────────────

/**
 * Checks if the tenant can register a new service without exceeding tier limits.
 * Returns a TierGateContext on success, or a 403 NextResponse if the limit
 * would be exceeded.
 *
 * @param tenantId - The authenticated tenant ID
 * @param currentServiceCount - Current number of registered services for this tenant
 *
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   const gateResult = await withServiceLimitGate(tenantId, serviceCount);
 *   if (gateResult instanceof NextResponse) {
 *     return gateResult; // 403 with service limit message
 *   }
 *   // Proceed to create service...
 * }
 * ```
 */
export async function withServiceLimitGate(
  tenantId: string,
  currentServiceCount: number
): Promise<TierGateContext | NextResponse> {
  const tier = await getTenantSubscription(tenantId);

  if (wouldExceedServiceLimit(tier, currentServiceCount)) {
    return createTierResponse(
      "TIER_LIMIT_EXCEEDED",
      getServiceLimitMessage(tier),
      tier
    );
  }

  return { tier };
}

// ─── Combined Gate ─────────────────────────────────────────────────────────────

/**
 * Checks both a feature gate and the service limit in a single call.
 * Useful for endpoints that both require a feature and may add services.
 */
export async function withFullTierGate(
  tenantId: string,
  options: {
    feature?: Feature;
    checkServiceLimit?: { currentServiceCount: number };
  }
): Promise<TierGateContext | NextResponse> {
  const tier = await getTenantSubscription(tenantId);

  // Check feature access
  if (options.feature && !isFeatureAvailable(tier, options.feature)) {
    return createTierResponse(
      "FEATURE_NOT_AVAILABLE",
      getUpgradeMessage(tier, options.feature),
      tier
    );
  }

  // Check service limit
  if (options.checkServiceLimit) {
    if (wouldExceedServiceLimit(tier, options.checkServiceLimit.currentServiceCount)) {
      return createTierResponse(
        "TIER_LIMIT_EXCEEDED",
        getServiceLimitMessage(tier),
        tier
      );
    }
  }

  return { tier };
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

function createTierResponse(
  code: TierGateErrorResponse["code"],
  message: string,
  currentTier: SubscriptionTier
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      code,
      currentTier,
      requiredAction: "upgrade",
    } satisfies TierGateErrorResponse,
    { status: 403 }
  );
}
