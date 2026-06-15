# DynamoDB Data Model — OllinAI

## Why DynamoDB for Deployment Intelligence

OllinAI processes deployment events from hundreds of CI/CD pipelines in real-time, correlates them with production incidents, and computes risk scores — all while maintaining strict multi-tenant data isolation. DynamoDB is the foundation because:

1. **Multi-tenant scalability** — Each tenant's data is partitioned by `TENANT#{id}`, enabling independent scaling per customer without noisy-neighbor effects.
2. **Millisecond access patterns** — Webhook ingestion must respond in <100ms. DynamoDB's single-digit millisecond reads/writes enable this even at thousands of events per second.
3. **Flexible schema** — A single `ollinai-config` table stores users, teams, services, integrations, subscriptions, and onboarding state — each with different attribute shapes — without schema migrations.
4. **ACID transactions** — Creating integrations atomically updates multiple items (integration record + audit log + tenant metadata) with `TransactWriteItems`.
5. **Global Tables** — Enterprise customers require data residency in specific regions. DynamoDB Global Tables provide active-active replication for low-latency access worldwide.

## Single-Table Design Philosophy

OllinAI uses a **single-table design** for configuration data (`ollinai-config`) where all entity types share the same table, differentiated by sort key prefixes. This eliminates cross-table joins and enables atomic transactions across entity types.

Separate tables are used for high-volume operational data (events, incidents, metrics) to optimize throughput allocation independently.

## Table Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ollinai-config                                 │
│  (Single-table: users, teams, services, integrations, onboarding)   │
├─────────────────────────────────────────────────────────────────────┤
│  PK: TENANT#{tenantId}     SK: USER#{userId}                        │
│  PK: TENANT#{tenantId}     SK: TEAM#{teamId}                        │
│  PK: TENANT#{tenantId}     SK: SVC#{serviceId}                      │
│  PK: TENANT#{tenantId}     SK: INTEGRATION#{integrationId}          │
│  PK: TENANT#{tenantId}     SK: SUBSCRIPTION#current                 │
│  PK: TENANT#{tenantId}     SK: ONBOARDING#state                     │
│  PK: TENANT#{tenantId}     SK: SETTINGS#risk_weights                │
│  PK: TENANT#{tenantId}     SK: SETTINGS#correlation_window          │
│  PK: EMAIL_INDEX           SK: {email}                              │
│  PK: RESET_TOKEN           SK: {token}                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        ollinai-events                                 │
│  (Deployment events with risk scores and correlations)               │
├─────────────────────────────────────────────────────────────────────┤
│  PK: TENANT#{tenantId}#SVC#{serviceId}                              │
│  SK: DEPLOY#{timestamp}#{eventId}                                   │
│                                                                      │
│  GSI-1 (Correlation):  PK=same  SK=TS#{deploymentTimestamp}         │
│  GSI-2 (Team View):    PK=TENANT#{id}#TEAM#{teamId}  SK=DEPLOY#{ts} │
│  GSI-3 (Dedup):        PK=TENANT#{id}#DEDUP  SK={sha}#{svc}#{env}  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       ollinai-incidents                               │
│  PK: TENANT#{tenantId}#SVC#{serviceId}                              │
│  SK: INC#{detectionTimestamp}#{incidentId}                          │
│  GSI-1 (Time Range):  PK=TENANT#{tenantId}  SK=INC#{timestamp}     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       ollinai-metrics                                 │
│  (Pre-computed DORA metrics by scope and period)                     │
│  PK: TENANT#{tenantId}#SCOPE#{type}#{id}                            │
│  SK: PERIOD#{startISO}#{endISO}                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        ollinai-audit                                  │
│  (Append-only audit log, 365-day retention)                          │
│  PK: TENANT#{tenantId}                                              │
│  SK: AUDIT#{timestamp}#{auditId}                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Access Patterns

| Access Pattern | Table | Key Condition | Index |
|---|---|---|---|
| Get user by email | config | PK=`EMAIL_INDEX`, SK=`{email}` | Base |
| List team's services | config | PK=`TENANT#{id}`, SK begins_with `SVC#` | Base |
| Get deployment events by service | events | PK=`TENANT#{id}#SVC#{svc}` | Base |
| Find correlated deployments | events | PK=same, SK between timestamps | GSI-1 |
| Dashboard: all tenant deployments | events | PK=`TENANT#{id}#TEAM#ALL` | GSI-2 |
| Deduplication check | events | PK=`TENANT#{id}#DEDUP`, SK=`{sha}#{svc}#{env}` | GSI-3 |
| Incidents by time range | incidents | PK=`TENANT#{id}`, SK between | GSI-1 |
| DORA metrics for period | metrics | PK=`TENANT#{id}#SCOPE#ALL#ALL`, SK begins_with `PERIOD#` | Base |
| Audit trail by time | audit | PK=`TENANT#{id}`, SK between | Base |

## DynamoDB Features Utilized

### 1. ACID Transactions (`TransactWriteItems`)

Used when creating integrations to atomically:
- Write the integration record
- Write an audit log entry
- Update tenant metadata

```typescript
await client.send(new TransactWriteItemsCommand({
  TransactItems: [
    { Put: { TableName: "ollinai-config", Item: integrationRecord } },
    { Put: { TableName: "ollinai-audit", Item: auditEntry } },
    { Update: { TableName: "ollinai-config", Key: tenantKey, UpdateExpression: "ADD integrationCount :one" } },
  ],
}));
```

### 2. Conditional Writes (Optimistic Locking)

Used for onboarding step completion to prevent race conditions when multiple users complete steps concurrently:

```typescript
ConditionExpression: "attribute_exists(PK) AND entityData.steps.#step.completed = :false"
```

If two users complete the same step simultaneously, only one write succeeds — the other gets the current state (idempotent).

### 3. TTL (Time-to-Live)

Password reset tokens auto-expire after 1 hour:

```typescript
Item: { PK: "RESET_TOKEN", SK: token, TTL: Math.floor(Date.now()/1000) + 3600 }
```

DynamoDB automatically deletes expired items — no cron job needed.

### 4. Global Secondary Indexes (GSIs)

Three GSIs on the events table enable different access patterns without data duplication:
- **GSI-1 (Correlation)**: Find deployments within a time window for incident correlation
- **GSI-2 (Team View)**: Dashboard queries all deployments by team
- **GSI-3 (Deduplication)**: Prevent duplicate event ingestion by commit+service+environment

### 5. Global Tables (Multi-Region)

Configured for Enterprise tier customers requiring data residency:

```hcl
resource "aws_dynamodb_table" "events" {
  ...
  replica { region_name = "eu-west-1" }  # EU data residency
  replica { region_name = "ap-southeast-1" }  # APAC
}
```

Active-active replication ensures <10ms reads in any region.

### 6. DAX (DynamoDB Accelerator)

Dashboard DORA metrics are read-heavy with 30-second ISR revalidation. DAX provides microsecond response times for repeated metric queries:

```typescript
// Client factory toggles DAX based on environment
const client = process.env.USE_DAX === "true"
  ? createDAXClient(process.env.DAX_ENDPOINT)
  : createStandardClient();
```

### 7. DynamoDB Streams

Events table changes trigger Lambda functions for real-time processing:
- New deployment → risk scoring
- New incident → correlation
- Metrics update → recommendation engine

## Tenant Isolation Model

Every query is partition-key-scoped to the authenticated tenant:

```typescript
function withTenantScope<T>(tenantId: string, input: T): T {
  // Validates that PK/Item/ExpressionAttributeValues contain the correct tenant prefix
  // Throws TenantIsolationViolation if cross-tenant access is attempted
}
```

This ensures no API request can ever access another tenant's data — enforced at the data access layer, not just the API layer.

## Capacity and Cost Model

| Table | Mode | Rationale |
|---|---|---|
| ollinai-events | On-Demand | Bursty webhook traffic, unpredictable |
| ollinai-incidents | On-Demand | Low volume, unpredictable spikes |
| ollinai-metrics | On-Demand | Write-heavy during computation, read-heavy for dashboard |
| ollinai-config | On-Demand | Low volume, mixed read/write |
| ollinai-audit | On-Demand | Append-only, write-heavy |

On-Demand mode eliminates capacity planning and auto-scales to handle any workload — critical for a multi-tenant SaaS where individual tenant traffic is unpredictable.
