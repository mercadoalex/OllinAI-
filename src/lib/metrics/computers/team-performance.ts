/**
 * Team Performance metrics computer.
 *
 * Computes per-team change failure rate, deployment frequency,
 * risk profile distribution, and organization averages from deployment events.
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import type { EventItem, TeamConfigItem } from "@/lib/types/dynamo";
import type { MetricComputeContext, TeamPerformanceResponse } from "./types";
import { MINIMUM_EVENTS_REQUIRED } from "./types";

/**
 * Query all teams from ollinai-config table.
 * PK = TENANT#{tenantId}, SK begins_with TEAM#
 */
async function queryTeams(
  tenantId: string
): Promise<TeamConfigItem[]> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}`;

  const items: TeamConfigItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: TableNames.CONFIG,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":skPrefix": "TEAM#",
      },
      ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await client.send(command);
    if (result.Items) {
      items.push(...(result.Items as TeamConfigItem[]));
    }
    exclusiveStartKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return items;
}

/**
 * Query deployment events for a specific team using GSI2-TeamView.
 * PK = TENANT#{tenantId}#TEAM#{teamId}, SK between DEPLOY#{from} and DEPLOY#{to}
 */
async function queryEventsByTeam(
  tenantId: string,
  teamId: string,
  from: Date,
  to: Date
): Promise<EventItem[]> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}#TEAM#${teamId}`;
  const skFrom = `DEPLOY#${from.toISOString()}`;
  const skTo = `DEPLOY#${to.toISOString()}`;

  const items: EventItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: TableNames.EVENTS,
      IndexName: "GSI2-TeamView",
      KeyConditionExpression:
        "GSI2PK = :pk AND GSI2SK BETWEEN :skFrom AND :skTo",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":skFrom": skFrom,
        ":skTo": skTo,
      },
      ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await client.send(command);
    if (result.Items) {
      items.push(...(result.Items as EventItem[]));
    }
    exclusiveStartKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return items;
}

/**
 * Compute change failure rate for a set of events.
 * CFR = (events with non-empty correlatedIncidents / total events) × 100
 */
function computeChangeFailureRate(events: EventItem[]): number {
  if (events.length === 0) return 0;

  const failedCount = events.filter(
    (e) => e.correlatedIncidents && e.correlatedIncidents.length > 0
  ).length;

  return (failedCount / events.length) * 100;
}

/**
 * Compute risk profile (count events by riskScore category).
 */
function computeRiskProfile(events: EventItem[]): {
  low: number;
  medium: number;
  high: number;
  critical: number;
} {
  const profile = { low: 0, medium: 0, high: 0, critical: 0 };

  for (const event of events) {
    if (
      event.riskScore &&
      event.riskScore !== "indeterminate" &&
      event.riskScore in profile
    ) {
      profile[event.riskScore]++;
    }
  }

  return profile;
}

/**
 * Compute team performance metrics for the given context.
 *
 * Steps:
 * 1. Query all teams from ollinai-config table
 * 2. For each team, query events from GSI2-TeamView
 * 3. Per team compute: changeFailureRate, deploymentFrequency, riskProfile, insufficientData
 * 4. Sort teams by changeFailureRate descending by default
 * 5. Compute org averages when no team filter is active
 * 6. If context.teamId is set, return only that team with org average overlay
 */
export async function computeTeamPerformance(
  context: MetricComputeContext
): Promise<TeamPerformanceResponse> {
  // Step 1: Query all teams
  const teams = await queryTeams(context.tenantId);

  // Step 2 & 3: For each team, query events and compute metrics
  const teamMetrics: Array<{
    teamId: string;
    teamName: string;
    changeFailureRate: number;
    deploymentFrequency: number;
    riskProfile: { low: number; medium: number; high: number; critical: number };
    eventCount: number;
    insufficientData: boolean;
  }> = [];

  for (const team of teams) {
    const teamId = team.entityData.teamId;
    const teamName = team.entityData.name;

    const events = await queryEventsByTeam(
      context.tenantId,
      teamId,
      context.from,
      context.to
    );

    const insufficientData = events.length < MINIMUM_EVENTS_REQUIRED;
    const changeFailureRate = insufficientData ? 0 : computeChangeFailureRate(events);
    const deploymentFrequency = events.length;
    const riskProfile = computeRiskProfile(events);

    teamMetrics.push({
      teamId,
      teamName,
      changeFailureRate,
      deploymentFrequency,
      riskProfile,
      eventCount: events.length,
      insufficientData,
    });
  }

  // Step 4: Sort by changeFailureRate descending by default
  teamMetrics.sort((a, b) => b.changeFailureRate - a.changeFailureRate);

  // Step 5: Compute org averages when no team filter is active
  let orgAverages: { changeFailureRate: number; deploymentFrequency: number } | undefined;

  if (!context.teamId) {
    const teamsWithSufficientData = teamMetrics.filter((t) => !t.insufficientData);
    if (teamsWithSufficientData.length > 0) {
      const totalCfr = teamsWithSufficientData.reduce(
        (sum, t) => sum + t.changeFailureRate,
        0
      );
      const totalFreq = teamsWithSufficientData.reduce(
        (sum, t) => sum + t.deploymentFrequency,
        0
      );
      orgAverages = {
        changeFailureRate: totalCfr / teamsWithSufficientData.length,
        deploymentFrequency: totalFreq / teamsWithSufficientData.length,
      };
    } else {
      orgAverages = {
        changeFailureRate: 0,
        deploymentFrequency: 0,
      };
    }
  }

  // Step 6: If context.teamId is set, return only that team with org average overlay
  let resultTeams = teamMetrics;
  if (context.teamId) {
    resultTeams = teamMetrics.filter((t) => t.teamId === context.teamId);

    // Also compute org averages for overlay comparison
    const teamsWithSufficientData = teamMetrics.filter((t) => !t.insufficientData);
    if (teamsWithSufficientData.length > 0) {
      const totalCfr = teamsWithSufficientData.reduce(
        (sum, t) => sum + t.changeFailureRate,
        0
      );
      const totalFreq = teamsWithSufficientData.reduce(
        (sum, t) => sum + t.deploymentFrequency,
        0
      );
      orgAverages = {
        changeFailureRate: totalCfr / teamsWithSufficientData.length,
        deploymentFrequency: totalFreq / teamsWithSufficientData.length,
      };
    } else {
      orgAverages = {
        changeFailureRate: 0,
        deploymentFrequency: 0,
      };
    }
  }

  return {
    teams: resultTeams,
    sortBy: "changeFailureRate",
    sortOrder: "desc",
    orgAverages,
    period: {
      start: context.from.toISOString(),
      end: context.to.toISOString(),
    },
  };
}
