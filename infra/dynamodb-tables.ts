/**
 * DynamoDB Table Definitions for OllinAI Platform (Phase 1)
 *
 * CloudFormation-compatible table definitions for all Phase 1 tables.
 * These can be used with AWS CDK or raw CloudFormation templates.
 *
 * Tables:
 * - ollinai-events: Deployment events with GSIs for correlation, team view, and deduplication
 * - ollinai-incidents: Production incidents with GSI for time range queries
 * - ollinai-metrics: DORA metrics per scope/period
 * - ollinai-config: Tenant configuration (teams, services, integrations, subscriptions)
 * - ollinai-audit: Immutable audit trail
 */

export interface TableDefinition {
  TableName: string;
  KeySchema: KeySchemaElement[];
  AttributeDefinitions: AttributeDefinition[];
  GlobalSecondaryIndexes?: GlobalSecondaryIndex[];
  BillingMode: "PAY_PER_REQUEST" | "PROVISIONED";
  Tags?: Tag[];
}

interface KeySchemaElement {
  AttributeName: string;
  KeyType: "HASH" | "RANGE";
}

interface AttributeDefinition {
  AttributeName: string;
  AttributeType: "S" | "N" | "B";
}

interface GlobalSecondaryIndex {
  IndexName: string;
  KeySchema: KeySchemaElement[];
  Projection: {
    ProjectionType: "ALL" | "KEYS_ONLY" | "INCLUDE";
    NonKeyAttributes?: string[];
  };
}

interface Tag {
  Key: string;
  Value: string;
}

const COMMON_TAGS: Tag[] = [
  { Key: "Project", Value: "OllinAI" },
  { Key: "ManagedBy", Value: "CloudFormation" },
];

/**
 * ollinai-events table
 *
 * Stores deployment events with tenant+service scoped partition keys.
 * GSI-1: Correlation lookup by service and deployment timestamp
 * GSI-2: Team view for dashboard queries
 * GSI-3: Deduplication check by commit SHA + service + environment
 */
export const eventsTable: TableDefinition = {
  TableName: "ollinai-events",
  KeySchema: [
    { AttributeName: "PK", KeyType: "HASH" },
    { AttributeName: "SK", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "PK", AttributeType: "S" },
    { AttributeName: "SK", AttributeType: "S" },
    { AttributeName: "GSI1PK", AttributeType: "S" },
    { AttributeName: "GSI1SK", AttributeType: "S" },
    { AttributeName: "GSI2PK", AttributeType: "S" },
    { AttributeName: "GSI2SK", AttributeType: "S" },
    { AttributeName: "GSI3PK", AttributeType: "S" },
    { AttributeName: "GSI3SK", AttributeType: "S" },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: "GSI1-CorrelationLookup",
      KeySchema: [
        { AttributeName: "GSI1PK", KeyType: "HASH" },
        { AttributeName: "GSI1SK", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
    {
      IndexName: "GSI2-TeamView",
      KeySchema: [
        { AttributeName: "GSI2PK", KeyType: "HASH" },
        { AttributeName: "GSI2SK", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
    {
      IndexName: "GSI3-Deduplication",
      KeySchema: [
        { AttributeName: "GSI3PK", KeyType: "HASH" },
        { AttributeName: "GSI3SK", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "KEYS_ONLY" },
    },
  ],
  BillingMode: "PAY_PER_REQUEST",
  Tags: COMMON_TAGS,
};

/**
 * ollinai-incidents table
 *
 * Stores production incidents with tenant+service scoped partition keys.
 * GSI-1: Time range queries across all services for a tenant
 */
export const incidentsTable: TableDefinition = {
  TableName: "ollinai-incidents",
  KeySchema: [
    { AttributeName: "PK", KeyType: "HASH" },
    { AttributeName: "SK", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "PK", AttributeType: "S" },
    { AttributeName: "SK", AttributeType: "S" },
    { AttributeName: "GSI1PK", AttributeType: "S" },
    { AttributeName: "GSI1SK", AttributeType: "S" },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: "GSI1-TimeRange",
      KeySchema: [
        { AttributeName: "GSI1PK", KeyType: "HASH" },
        { AttributeName: "GSI1SK", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
  ],
  BillingMode: "PAY_PER_REQUEST",
  Tags: COMMON_TAGS,
};

/**
 * ollinai-metrics table
 *
 * Stores computed DORA metrics per scope (team/service) and time period.
 * No GSIs needed — queries are always by scope + period range.
 */
export const metricsTable: TableDefinition = {
  TableName: "ollinai-metrics",
  KeySchema: [
    { AttributeName: "PK", KeyType: "HASH" },
    { AttributeName: "SK", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "PK", AttributeType: "S" },
    { AttributeName: "SK", AttributeType: "S" },
  ],
  BillingMode: "PAY_PER_REQUEST",
  Tags: COMMON_TAGS,
};

/**
 * ollinai-config table
 *
 * Multi-purpose tenant configuration table.
 * Stores teams, services, integrations, subscriptions, risk weights,
 * correlation window settings, and recommendations.
 * SK prefixes: TEAM#, SVC#, INTEGRATION#, SUBSCRIPTION#, USER#, etc.
 */
export const configTable: TableDefinition = {
  TableName: "ollinai-config",
  KeySchema: [
    { AttributeName: "PK", KeyType: "HASH" },
    { AttributeName: "SK", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "PK", AttributeType: "S" },
    { AttributeName: "SK", AttributeType: "S" },
  ],
  BillingMode: "PAY_PER_REQUEST",
  Tags: COMMON_TAGS,
};

/**
 * ollinai-audit table
 *
 * Append-only audit log. No TTL — 365-day retention enforced at application level.
 * No GSIs needed — queries are always by tenant + time range.
 */
export const auditTable: TableDefinition = {
  TableName: "ollinai-audit",
  KeySchema: [
    { AttributeName: "PK", KeyType: "HASH" },
    { AttributeName: "SK", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "PK", AttributeType: "S" },
    { AttributeName: "SK", AttributeType: "S" },
  ],
  BillingMode: "PAY_PER_REQUEST",
  Tags: COMMON_TAGS,
};

/**
 * All Phase 1 table definitions
 */
export const allTables: TableDefinition[] = [
  eventsTable,
  incidentsTable,
  metricsTable,
  configTable,
  auditTable,
];
