/**
 * Subscription Tier Configuration — OllinAI Platform
 *
 * Defines the three subscription tiers (Starter, Pro, Enterprise) with their
 * feature flags, resource limits, and retention policies.
 *
 * Requirements:
 *  - 8.1: Starter tier limits (max 5 services, 30-day retention, DORA only)
 *  - 8.2: Pro tier limits (no service limit, 90-day retention, risk + correlation + recommendations)
 *  - 8.3: Enterprise tier (no limits, SSO, audit, custom integrations, API, data residency, attestations)
 *  - 8.4: Service count enforcement on Starter
 *  - 8.5: Feature-restricted request rejection with upgrade message
 */

import type { SubscriptionTier } from "@/lib/types/dynamo";

// ─── Feature Flags ─────────────────────────────────────────────────────────────

/**
 * All gatable features in the platform.
 * Each feature maps to a specific tier requirement.
 */
export type Feature =
  | "risk_score"
  | "recommendations"
  | "incident_correlation"
  | "sso"
  | "audit_logs"
  | "custom_integrations"
  | "api_access"
  | "data_residency"
  | "build_attestation"
  | "aiops_predictions";

// ─── Tier Definition ───────────────────────────────────────────────────────────

export interface TierDefinition {
  /** Tier identifier */
  tier: SubscriptionTier;
  /** Human-readable tier name */
  displayName: string;
  /** Maximum number of services (null = unlimited) */
  maxServices: number | null;
  /** Data retention period in days (null = unlimited) */
  retentionDays: number | null;
  /** Set of features available on this tier */
  features: Set<Feature>;
}

// ─── Tier Definitions ──────────────────────────────────────────────────────────

const STARTER_FEATURES = new Set<Feature>();

const PRO_FEATURES = new Set<Feature>([
  "risk_score",
  "recommendations",
  "incident_correlation",
  "aiops_predictions",
] as const);

const ENTERPRISE_FEATURES = new Set<Feature>([
  "risk_score",
  "recommendations",
  "incident_correlation",
  "aiops_predictions",
  "sso",
  "audit_logs",
  "custom_integrations",
  "api_access",
  "data_residency",
  "build_attestation",
] as const);

export const TIER_DEFINITIONS: Record<SubscriptionTier, TierDefinition> = {
  starter: {
    tier: "starter",
    displayName: "Starter",
    maxServices: 5,
    retentionDays: 30,
    features: STARTER_FEATURES,
  },
  pro: {
    tier: "pro",
    displayName: "Pro",
    maxServices: null,
    retentionDays: 90,
    features: PRO_FEATURES,
  },
  enterprise: {
    tier: "enterprise",
    displayName: "Enterprise",
    maxServices: null,
    retentionDays: null,
    features: ENTERPRISE_FEATURES,
  },
};

// ─── Upgrade Messages ──────────────────────────────────────────────────────────

/**
 * Human-readable descriptions for each feature, used in upgrade messages.
 */
const FEATURE_DESCRIPTIONS: Record<Feature, string> = {
  risk_score: "Deployment Risk Scoring",
  recommendations: "Actionable Recommendations",
  incident_correlation: "Incident Correlation",
  sso: "SSO Integration",
  audit_logs: "Audit Logs",
  custom_integrations: "Custom Integrations",
  api_access: "REST API Data Export",
  data_residency: "Data Residency Mode",
  build_attestation: "Build Attestation",
  aiops_predictions: "AIOps Predictions",
};

/**
 * Returns the minimum tier required for a given feature.
 */
export function minimumTierForFeature(feature: Feature): SubscriptionTier {
  if (ENTERPRISE_FEATURES.has(feature) && !PRO_FEATURES.has(feature)) {
    return "enterprise";
  }
  if (PRO_FEATURES.has(feature)) {
    return "pro";
  }
  // Feature is available on all tiers (shouldn't happen for gated features)
  return "starter";
}

// ─── Tier Helpers ──────────────────────────────────────────────────────────────

/**
 * Checks if a feature is available on the given tier.
 */
export function isFeatureAvailable(
  tier: SubscriptionTier,
  feature: Feature
): boolean {
  return TIER_DEFINITIONS[tier].features.has(feature);
}

/**
 * Checks if adding a service would exceed the tier's service limit.
 *
 * @param tier - The tenant's current subscription tier
 * @param currentServiceCount - The tenant's current number of registered services
 * @returns true if the limit would be exceeded, false otherwise
 */
export function wouldExceedServiceLimit(
  tier: SubscriptionTier,
  currentServiceCount: number
): boolean {
  const maxServices = TIER_DEFINITIONS[tier].maxServices;
  if (maxServices === null) {
    return false;
  }
  return currentServiceCount >= maxServices;
}

/**
 * Returns the retention period in days for the given tier.
 * Returns null for unlimited retention.
 */
export function getRetentionDays(tier: SubscriptionTier): number | null {
  return TIER_DEFINITIONS[tier].retentionDays;
}

/**
 * Generates a descriptive upgrade message when a feature is not available.
 */
export function getUpgradeMessage(
  currentTier: SubscriptionTier,
  feature: Feature
): string {
  const featureName = FEATURE_DESCRIPTIONS[feature];
  const requiredTier = minimumTierForFeature(feature);
  const requiredTierName = TIER_DEFINITIONS[requiredTier].displayName;
  const currentTierName = TIER_DEFINITIONS[currentTier].displayName;

  return (
    `${featureName} is not available on the ${currentTierName} tier. ` +
    `Upgrade to ${requiredTierName} or higher to access this feature.`
  );
}

/**
 * Generates a descriptive message when service limit is exceeded.
 */
export function getServiceLimitMessage(tier: SubscriptionTier): string {
  const definition = TIER_DEFINITIONS[tier];
  return (
    `You have reached the maximum of ${definition.maxServices} services on the ${definition.displayName} tier. ` +
    `Upgrade to Pro or higher to register unlimited services.`
  );
}
