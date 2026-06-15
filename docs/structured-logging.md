# Structured Logging & Request Tracing — OllinAI

## Overview

OllinAI uses structured JSON logging with request ID propagation to enable production observability, debugging, and audit trails. Every log entry is machine-parseable and traceable back to the originating request.

## Architecture

```
Client Request
     ↓
Middleware (generates x-request-id: req_a1b2c3d4e5f6g7h8)
     ↓
API Route Handler (creates logger with requestId + tenantId)
     ↓
Service Layer (child logger inherits requestId)
     ↓
Vercel Function Logs (JSON, searchable by requestId)
```

## Log Format

Every log entry is a single-line JSON object:

```json
{
  "timestamp": "2026-06-15T03:15:42.123Z",
  "level": "info",
  "service": "api/webhooks/deployments",
  "message": "Deployment event ingested",
  "requestId": "req_a1b2c3d4e5f6g7h8",
  "tenantId": "b2e8fb74-b614-4135-8db5-30c06442d40d",
  "eventId": "evt-123456",
  "services": ["api-gateway"],
  "riskScore": "medium"
}
```

### Fields

| Field | Type | Always Present | Description |
|-------|------|:-:|---|
| `timestamp` | ISO 8601 | ✅ | When the log was emitted |
| `level` | string | ✅ | `debug`, `info`, `warn`, `error` |
| `service` | string | ✅ | Module that emitted the log (e.g., `api/webhooks/deployments`) |
| `message` | string | ✅ | Human-readable description |
| `requestId` | string | ⚠️ | Unique per-request identifier (when using `createRequestLogger`) |
| `tenantId` | string | ⚠️ | Tenant context (when available) |
| `...meta` | any | ❌ | Additional structured context |

## Usage

### In API Routes

```typescript
import { createRequestLogger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const log = createRequestLogger("api/webhooks/deployments", { tenantId });

  log.info("Webhook received", { method: "POST", contentLength: body.length });

  try {
    const event = await processEvent(body);
    log.info("Event processed", { eventId: event.id, riskScore: event.risk });
  } catch (error) {
    log.error("Processing failed", { error: error.message, stack: error.stack });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

### In Service/Library Code

```typescript
import { createLogger } from "@/lib/logger";

const log = createLogger("lib/onboarding/state");

export async function completeStep(tenantId: string, step: string) {
  log.info("Completing step", { tenantId, step });

  try {
    await dynamoUpdate(/* ... */);
    log.info("Step completed", { tenantId, step });
  } catch (error) {
    log.error("Step completion failed", { tenantId, step, error: error.message });
    throw error;
  }
}
```

### Child Loggers (Inheriting Context)

```typescript
const log = createRequestLogger("api/integrations", { tenantId });

// Create a child that inherits requestId + tenantId
const integrationLog = log.child({ integrationId: "int-456" });

integrationLog.info("Creating integration");
// Output includes: requestId, tenantId, AND integrationId
```

## Request ID Propagation

### Generation

The middleware generates a unique request ID for every authenticated request:

```typescript
// src/middleware.ts
const requestId = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
response.headers.set("x-request-id", `req_${requestId}`);
```

### Format

```
req_a1b2c3d4e5f6g7h8
```

- Prefix: `req_` (identifies it as a request ID in logs)
- Body: 16 hex characters (derived from UUID, unique per request)

### Reading in API Routes

```typescript
const requestId = request.headers.get("x-request-id") || generateRequestId();
```

## Log Levels

| Level | When to Use | Example |
|-------|-------------|---------|
| `debug` | Detailed internal state (disabled in production by default) | `log.debug("Query params", { pk, sk })` |
| `info` | Normal operations, business events | `log.info("Event ingested", { eventId })` |
| `warn` | Recoverable issues, degraded behavior | `log.warn("DAX unavailable, falling back to DynamoDB")` |
| `error` | Failures requiring attention | `log.error("DynamoDB write failed", { error })` |

### Configuration

Set `LOG_LEVEL` environment variable to control verbosity:

```bash
LOG_LEVEL=debug  # Show all logs (development)
LOG_LEVEL=info   # Default (production)
LOG_LEVEL=warn   # Only warnings and errors
LOG_LEVEL=error  # Only errors
```

## Searching Logs

### Vercel CLI

```bash
# All errors in the last hour
vercel logs --level error

# Search by request ID
vercel logs --query "req_a1b2c3d4e5f6g7h8"

# Search by tenant
vercel logs --query "b2e8fb74"
```

### Common Debugging Patterns

**Trace a failed request:**
1. Get the `x-request-id` from the response headers or error log
2. Search all logs with that request ID
3. See the full lifecycle: received → validated → processed → failed

**Find all errors for a tenant:**
```bash
vercel logs --query "tenantId.*b2e8fb74" --level error
```

**Find slow operations:**
Look for large time gaps between sequential log entries with the same `requestId`.

## Best Practices

1. **Always use `createRequestLogger` in route handlers** — ensures request ID is attached
2. **Include relevant IDs in every log** — `eventId`, `tenantId`, `integrationId`
3. **Log at the boundary** — log when entering/exiting a service, not every internal step
4. **Don't log sensitive data** — no passwords, secret keys, or full request bodies
5. **Use `error` level sparingly** — only for things that need human attention
6. **Include the error message, not the full stack** — stacks are available in Vercel's expanded logs
