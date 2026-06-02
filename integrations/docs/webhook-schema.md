# OllinAI Webhook Integration Schema

## Overview

This document describes the generic webhook schema for sending deployment events to OllinAI from any CI/CD system. Use this for custom integrations not covered by the pre-built GitHub Actions or GitLab CI templates.

## Endpoint

```
POST {OLLINAI_API_URL}/api/webhooks/deployments
```

## Authentication

All requests must be signed with HMAC-SHA256 using your integration's secret key.

### Signature Computation

1. Serialize the request body as a JSON string (UTF-8)
2. Compute HMAC-SHA256 using your secret key
3. Encode the digest as lowercase hex
4. Include in the `X-OllinAI-Signature` header with `sha256=` prefix

```
X-OllinAI-Signature: sha256={hex_digest}
```

### Example (bash)

```bash
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET_KEY" -binary | xxd -p -c 256)
curl -X POST "$API_URL/api/webhooks/deployments" \
  -H "Content-Type: application/json" \
  -H "X-OllinAI-Signature: sha256=${SIGNATURE}" \
  -d "$PAYLOAD"
```

## Request Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `commitShas` | `string[]` | Yes | Array of 1–50 commit SHAs included in this deployment |
| `author` | `string` | Yes | Identifier of the person or system triggering the deployment |
| `services` | `string[]` | Yes | Array of 1–20 affected service names |
| `deploymentTimestamp` | `string` | Yes | ISO 8601 UTC timestamp of the deployment |
| `environment` | `string` | Yes | Target environment (e.g., "production", "staging") |
| `changeSize` | `object` | No | Change size metadata |
| `changeSize.linesAdded` | `number` | No | Lines of code added |
| `changeSize.linesRemoved` | `number` | No | Lines of code removed |
| `changeSize.filesChanged` | `number` | No | Number of files modified |

### Constraints

- **Maximum payload size**: 1 MB (1,048,576 bytes)
- **commitShas**: 1 to 50 items
- **services**: 1 to 20 items
- **deploymentTimestamp**: Must be valid ISO 8601

### Example Payload

```json
{
  "commitShas": ["abc123def456", "789ghi012jkl"],
  "author": "deploy-bot",
  "services": ["payment-service", "notification-service"],
  "deploymentTimestamp": "2024-01-15T14:30:00Z",
  "environment": "production",
  "changeSize": {
    "linesAdded": 150,
    "linesRemoved": 30,
    "filesChanged": 8
  }
}
```

## Response

### Success (201 Created)

```json
{
  "eventId": "uuid-of-created-event",
  "status": "created"
}
```

### Duplicate (201 Created)

If the same commit SHA + service + environment combination already exists:

```json
{
  "eventId": "uuid-of-existing-event",
  "status": "duplicate"
}
```

### Validation Error (400 Bad Request)

```json
{
  "error": "Validation failed",
  "fields": {
    "commitShas": ["Must contain between 1 and 50 items"],
    "services": ["Service name is required"]
  }
}
```

### Authentication Error (401 Unauthorized)

```json
{
  "error": "Invalid HMAC signature",
  "code": "INVALID_SIGNATURE"
}
```

### Rate Limited (429 Too Many Requests)

```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 30
}
```

The `Retry-After` header contains the number of seconds to wait before retrying.

## Incident Webhook

```
POST {OLLINAI_API_URL}/api/webhooks/incidents
```

### Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `externalId` | `string` | Yes | Unique incident ID from your alerting system |
| `severity` | `string` | Yes | One of: "low", "medium", "high", "critical" |
| `affectedService` | `string` | Yes | Name of the affected service |
| `detectionTimestamp` | `string` | Yes | ISO 8601 UTC timestamp when incident was detected |
| `resolutionTimestamp` | `string` | No | ISO 8601 UTC timestamp when incident was resolved |

### Example

```json
{
  "externalId": "INC-12345",
  "severity": "high",
  "affectedService": "payment-service",
  "detectionTimestamp": "2024-01-15T14:35:00Z"
}
```

## Best Practices

1. **Retry on 5xx errors** — Use exponential backoff with a maximum of 3 retries
2. **Respect Retry-After** — On 429 responses, wait the specified number of seconds
3. **Send on deploy completion** — Send the event after deployment succeeds, not before
4. **Include change size** — Improves risk score accuracy
5. **Use consistent service names** — Service names are case-sensitive and should match across all integrations
6. **Idempotency** — Duplicate events (same commit + service + env) are handled gracefully
