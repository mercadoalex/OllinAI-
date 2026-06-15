/**
 * Service Health metrics computer.
 *
 * Computes services at risk, per-service DORA metrics, and blast radius
 * from deployment events, incidents, and pre-computed metrics.
 */

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import type {
  EventItem,
  IncidentItem,
  MetricsItem,
  ServiceConfigItem,
} from "@/lib/types/dynamo";
import type { MetricComputeContext, ServiceHealthResponse } from "./types";

/**
 * Query deployment events for a time range using GSI2-TeamView.
 * Used for finding services at risk in the last 7 days.
 */
async function queryEventsForTimeRange(
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
 * Query all services from ollinai-config table.
 * PK = TENANT#{tenantId}, SK begins_with SVC#
 */
async function queryServices(
  tenantId: string
): Promise<ServiceConfigItem[]> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}`;

  const items: ServiceConfigItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: TableNames.CONFIG,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":skPrefix": "SVC#",
      },
      ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await client.send(command);
    if (result.Items) {
      items.push(...(result.Items as ServiceConfigItem[]));
    }
    exclusiveStartKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return items;
}

/**
 * Query pre-computed metrics for a specific service from ollinai-metrics.
 * PK = TENANT#{tenantId}#SCOPE#SERVICE#{serviceId}
 */
async function queryServiceMetrics(
  tenantId: string,
  serviceId: string
): Promise<MetricsItem | null> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}#SCOPE#SERVICE#${serviceId}`;

  const command = new QueryCommand({
    TableName: TableNames.METRICS,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: {
      ":pk": pk,
    },
    ScanIndexForward: false, // Get most recent first
    Limit: 1,
  });

  const result = await client.send(command);
  if (result.Items && result.Items.length > 0) {
    return result.Items[0] as MetricsItem;
  }
  return null;
}

/**
 * Query incidents for the given time range from ollinai-incidents via GSI1-TimeRange.
 * PK = TENANT#{tenantId}, SK between INC#{from} and INC#{to}
 */
async function queryIncidents(
  tenantId: string,
  from: Date,
  to: Date
): Promise<IncidentItem[]> {
  const client = getDocumentClient();
  const pk = `TENANT#${tenantId}`;
  const skFrom = `INC#${from.toISOString()}`;
  const skTo = `INC#${to.toISOString()}`;

  const items: IncidentItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: TableNames.INCIDENTS,
      IndexName: "GSI1-TimeRange",
      KeyConditionExpression:
        "GSI1PK = :pk AND GSI1SK BETWEEN :skFrom AND :skTo",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":skFrom": skFrom,
        ":skTo": skTo,
      },
      ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await client.send(command);
    if (result.Items) {
      items.push(...(result.Items as IncidentItem[]));
    }
    exclusiveStartKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return items;
}

/**
 * Query a specific event by its eventId to look up services.
 * We query by PK pattern using tenant + event relationship.
 */
async function queryEventById(
  tenantId: string,
  eventId: string
): Promise<EventItem | null> {
  const client = getDocumentClient();

  // Events are queried using a scan with filter on eventId
  // since we don't have the full PK (serviceId) from just the eventId.
  // In practice, this would use a GSI on eventId, but we use a simpler approach:
  // Query with FilterExpression on eventId across the tenant's events.
  const command = new QueryCommand({
    TableName: TableNames.EVENTS,
    IndexName: "GSI2-TeamView",
    KeyConditionExpression: "GSI2PK = :pk",
    FilterExpression: "eventId = :eventId",
    ExpressionAttributeValues: {
      ":pk": `TENANT#${tenantId}#TEAM#UNASSIGNED`,
      ":eventId": eventId,
    },
    Limit: 1,
  });

  const result = await client.send(command);
  if (result.Items && result.Items.length > 0) {
    return result.Items[0] as EventItem;
  }
  return null;
}

/**
 * Compute services at risk: services with at least one high/critical event
 * in the last 7 days.
 */
function computeServicesAtRisk(
  events: EventItem[],
  serviceNameMap: Map<string, string>
): ServiceHealthResponse["servicesAtRisk"] {
  // Group high/critical events by service
  const serviceRiskMap = new Map<
    string,
    { count: number; mostRecentScore: "high" | "critical"; mostRecentTimestamp: string }
  >();

  for (const event of events) {
    if (event.riskScore !== "high" && event.riskScore !== "critical") continue;

    for (const serviceId of event.services) {
      const existing = serviceRiskMap.get(serviceId);
      if (!existing) {
        serviceRiskMap.set(serviceId, {
          count: 1,
          mostRecentScore: event.riskScore,
          mostRecentTimestamp: event.createdAt,
        });
      } else {
        existing.count++;
        if (event.createdAt > existing.mostRecentTimestamp) {
          existing.mostRecentScore = event.riskScore;
          existing.mostRecentTimestamp = event.createdAt;
        }
      }
    }
  }

  const servicesAtRisk: ServiceHealthResponse["servicesAtRisk"] = [];
  for (const [serviceId, data] of serviceRiskMap) {
    servicesAtRisk.push({
      serviceId,
      serviceName: serviceNameMap.get(serviceId) || serviceId,
      highCriticalCount: data.count,
      mostRecentRiskScore: data.mostRecentScore,
    });
  }

  // Sort by count descending
  servicesAtRisk.sort((a, b) => b.highCriticalCount - a.highCriticalCount);

  return servicesAtRisk;
}

/**
 * Compute blast radius for each incident.
 * Blast radius = count of distinct services across all correlated deployment events.
 */
async function computeBlastRadius(
  incidents: IncidentItem[],
  allEvents: EventItem[]
): Promise<ServiceHealthResponse["blastRadius"]> {
  const incidentBlastRadii: Array<{
    incidentId: string;
    blastRadius: number;
    affectedServices: string[];
  }> = [];

  // Create a map of eventId → services for quick lookup
  const eventServicesMap = new Map<string, string[]>();
  for (const event of allEvents) {
    eventServicesMap.set(event.eventId, event.services);
  }

  for (const incident of incidents) {
    if (
      !incident.correlatedDeployments ||
      incident.correlatedDeployments.length === 0
    ) {
      continue;
    }

    const affectedServicesSet = new Set<string>();

    for (const deploymentId of incident.correlatedDeployments) {
      const services = eventServicesMap.get(deploymentId);
      if (services) {
        for (const svc of services) {
          affectedServicesSet.add(svc);
        }
      }
    }

    const affectedServices = Array.from(affectedServicesSet);
    incidentBlastRadii.push({
      incidentId: incident.incidentId,
      blastRadius: affectedServices.length,
      affectedServices,
    });
  }

  // Compute average and maximum
  let average = 0;
  let maximum = 0;

  if (incidentBlastRadii.length > 0) {
    const totalBlast = incidentBlastRadii.reduce(
      (sum, i) => sum + i.blastRadius,
      0
    );
    average = totalBlast / incidentBlastRadii.length;
    maximum = Math.max(...incidentBlastRadii.map((i) => i.blastRadius));
  }

  return {
    average,
    maximum,
    incidents: incidentBlastRadii,
  };
}

/**
 * Compute service health metrics for the given context.
 *
 * Steps:
 * 1. Query events for the last 7 days to find services at risk
 * 2. Query pre-computed per-service DORA metrics from ollinai-metrics
 * 3. Compute blast radius from incidents and their correlated deployments
 */
export async function computeServiceHealth(
  context: MetricComputeContext
): Promise<ServiceHealthResponse> {
  // Step 1: Query events for the last 7 days (fixed window for services at risk)
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const teamId = context.teamId || "UNASSIGNED";

  const recentEvents = await queryEventsForTimeRange(
    context.tenantId,
    teamId,
    sevenDaysAgo,
    now
  );

  // Query all services for name lookup
  const services = await queryServices(context.tenantId);
  const serviceNameMap = new Map<string, string>();
  for (const svc of services) {
    serviceNameMap.set(svc.entityData.serviceId, svc.entityData.name);
  }

  // Compute services at risk
  const servicesAtRisk = computeServicesAtRisk(recentEvents, serviceNameMap);

  // Step 2: Query per-service DORA metrics
  const serviceMetrics: ServiceHealthResponse["serviceMetrics"] = [];

  for (const svc of services) {
    if (context.serviceId && svc.entityData.serviceId !== context.serviceId) {
      continue;
    }

    const metrics = await queryServiceMetrics(
      context.tenantId,
      svc.entityData.serviceId
    );

    if (!metrics || metrics.dataPoints < 3) {
      serviceMetrics.push({
        serviceId: svc.entityData.serviceId,
        serviceName: svc.entityData.name,
        deploymentFrequency: 0,
        leadTimeHours: 0,
        changeFailureRate: 0,
        mttrHours: 0,
        insufficientData: true,
      });
    } else {
      serviceMetrics.push({
        serviceId: svc.entityData.serviceId,
        serviceName: svc.entityData.name,
        deploymentFrequency: metrics.deploymentFrequency,
        leadTimeHours: metrics.leadTimeHours,
        changeFailureRate: metrics.changeFailureRate,
        mttrHours: metrics.mttrHours,
        insufficientData: false,
      });
    }
  }

  // Step 3: Compute blast radius
  // Query incidents for the context time range
  const incidents = await queryIncidents(
    context.tenantId,
    context.from,
    context.to
  );

  // Also query events for the context time range for event-service lookup
  const contextEvents = await queryEventsForTimeRange(
    context.tenantId,
    teamId,
    context.from,
    context.to
  );

  const blastRadius = await computeBlastRadius(incidents, contextEvents);

  return {
    servicesAtRisk,
    serviceMetrics,
    blastRadius,
    period: {
      start: context.from.toISOString(),
      end: context.to.toISOString(),
    },
    filters: {
      team: context.teamId,
      service: context.serviceId,
    },
  };
}
