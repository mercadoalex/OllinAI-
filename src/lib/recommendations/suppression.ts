/**
 * Recommendation Suppression — Query and Check
 *
 * Provides utilities for the recommendation engine to check whether a
 * given recommendation category is currently suppressed for a team+service
 * combination.
 *
 * Suppression key: category + targetTeam + targetService
 * Duration: 14 days after dismissal
 *
 * Requirements: 5.5
 */

import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { tenantConfigKey, withTenantScope } from "@/lib/dynamo/tenant-scope";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { RecommendationConfigItem } from "@/lib/types/dynamo";
import type { RecommendationCategory } from "@/lib/types";

export interface SuppressionCheckParams {
  tenantId: string;
  category: RecommendationCategory;
  targetTeam: string;
  targetService: string;
}

/**
 * Checks whether a recommendation is currently suppressed for the given
 * category + team + service combination.
 *
 * A recommendation is suppressed when a previously dismissed recommendation
 * with the same category, targetTeam, and targetService has a `suppressedUntil`
 * timestamp that is in the future (> now).
 *
 * @returns true if the recommendation is suppressed (should NOT be generated), false otherwise
 */
export async function isRecommendationSuppressed(
  params: SuppressionCheckParams
): Promise<boolean> {
  const { tenantId, category, targetTeam, targetService } = params;
  const client = getDocumentClient();

  // Query all recommendations for this tenant
  const queryParams = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": tenantConfigKey(tenantId),
      ":skPrefix": "REC#",
    },
  });

  const queryResult = await client.send(new QueryCommand(queryParams));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return false;
  }

  const now = new Date().toISOString();

  // Check if any dismissed recommendation with the same suppression key
  // (category + targetTeam + targetService) has suppressedUntil > now
  return queryResult.Items.some((item) => {
    const entityData = (item as unknown as RecommendationConfigItem).entityData;
    return (
      entityData.category === category &&
      entityData.targetTeam === targetTeam &&
      entityData.targetService === targetService &&
      entityData.suppressedUntil !== undefined &&
      entityData.suppressedUntil > now
    );
  });
}

/**
 * Returns all active suppressions for a given tenant.
 * Useful for batch-checking multiple recommendations at once.
 *
 * @returns Array of active suppression keys with their expiration dates
 */
export async function getActiveSuppressions(
  tenantId: string
): Promise<
  Array<{
    category: RecommendationCategory;
    targetTeam: string;
    targetService: string;
    suppressedUntil: string;
  }>
> {
  const client = getDocumentClient();

  const queryParams = withTenantScope(tenantId, {
    TableName: TableNames.CONFIG,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": tenantConfigKey(tenantId),
      ":skPrefix": "REC#",
    },
  });

  const queryResult = await client.send(new QueryCommand(queryParams));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return [];
  }

  const now = new Date().toISOString();

  return (queryResult.Items ?? [])
    .map((item) => {
      const entityData = (item as unknown as RecommendationConfigItem).entityData;
      return entityData;
    })
    .filter(
      (rec) =>
        rec.suppressedUntil !== undefined && rec.suppressedUntil > now
    )
    .map((rec) => ({
      category: rec.category,
      targetTeam: rec.targetTeam,
      targetService: rec.targetService,
      suppressedUntil: rec.suppressedUntil!,
    }));
}

/**
 * Builds a suppression key string for comparison/lookup purposes.
 * Format: `{category}:{targetTeam}:{targetService}`
 */
export function buildSuppressionKey(
  category: RecommendationCategory,
  targetTeam: string,
  targetService: string
): string {
  return `${category}:${targetTeam}:${targetService}`;
}

/**
 * Batch check: given a list of potential recommendations, filters out
 * those that are currently suppressed.
 *
 * @param tenantId - The tenant to check suppressions for
 * @param candidates - Array of recommendation candidates with category, team, service
 * @returns The candidates that are NOT suppressed and can be generated
 */
export async function filterSuppressedRecommendations<
  T extends { category: RecommendationCategory; targetTeam: string; targetService: string }
>(tenantId: string, candidates: T[]): Promise<T[]> {
  if (candidates.length === 0) return [];

  const activeSuppressions = await getActiveSuppressions(tenantId);

  const suppressionKeys = new Set(
    activeSuppressions.map((s) =>
      buildSuppressionKey(s.category, s.targetTeam, s.targetService)
    )
  );

  return candidates.filter(
    (candidate) =>
      !suppressionKeys.has(
        buildSuppressionKey(
          candidate.category,
          candidate.targetTeam,
          candidate.targetService
        )
      )
  );
}
