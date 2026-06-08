#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Send Mock Deployment Events
#
# Sends multiple deployment events to OllinAI to populate the dashboard.
# Requires: OLLINAI_SECRET_KEY, OLLINAI_TENANT_ID, OLLINAI_INTEGRATION_ID
#
# Usage:
#   export OLLINAI_SECRET_KEY="your-secret-key"
#   export OLLINAI_TENANT_ID="your-tenant-id"
#   export OLLINAI_INTEGRATION_ID="your-integration-id"
#   bash scripts/send-mock-events.sh
#
# Or pass the webhook URL as first argument (defaults to production):
#   bash scripts/send-mock-events.sh http://localhost:3000
# ─────────────────────────────────────────────────────────────────────────────

set -e

BASE_URL="${1:-https://ollin-ai.vercel.app}"
WEBHOOK_URL="${BASE_URL}/api/webhooks/deployments"

# Validate required env vars
if [ -z "$OLLINAI_SECRET_KEY" ]; then
  echo "❌ OLLINAI_SECRET_KEY is not set"
  exit 1
fi
if [ -z "$OLLINAI_TENANT_ID" ]; then
  echo "❌ OLLINAI_TENANT_ID is not set"
  exit 1
fi
if [ -z "$OLLINAI_INTEGRATION_ID" ]; then
  echo "❌ OLLINAI_INTEGRATION_ID is not set"
  exit 1
fi

INTEGRATION_HEADER="${OLLINAI_TENANT_ID}:${OLLINAI_INTEGRATION_ID}"

# ─── Mock Data ──────────────────────────────────────────────────────────────────

SERVICES=("api-gateway" "auth-service" "billing-service" "dashboard-ui" "notification-service" "payment-processor" "user-service")
AUTHORS=("alex@ollinai.com" "maria@company.com" "carlos@company.com" "sofia@company.com" "diego@company.com")
ENVIRONMENTS=("production" "staging")

# Generate random hex string for commit SHAs
random_sha() {
  openssl rand -hex 6
}

# Send a single deployment event
send_event() {
  local service=$1
  local author=$2
  local environment=$3
  local timestamp=$4
  local commit_sha=$(random_sha)

  PAYLOAD="{\"commitShas\":[\"${commit_sha}\"],\"author\":\"${author}\",\"services\":[\"${service}\"],\"environment\":\"${environment}\",\"deploymentTimestamp\":\"${timestamp}\"}"

  SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$OLLINAI_SECRET_KEY" -binary | xxd -p -c 256)

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-OllinAI-Signature: $SIGNATURE" \
    -H "X-OllinAI-Integration: $INTEGRATION_HEADER" \
    -d "$PAYLOAD")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "201" ]; then
    echo "  ✅ ${service} | ${author} | ${environment} | ${timestamp:0:16}"
  else
    echo "  ❌ ${service} | HTTP ${HTTP_CODE} | ${BODY}"
  fi
}

# ─── Generate Events ────────────────────────────────────────────────────────────

echo "🚀 Sending mock deployment events to ${WEBHOOK_URL}"
echo "   Tenant: ${OLLINAI_TENANT_ID}"
echo "   Integration: ${OLLINAI_INTEGRATION_ID}"
echo ""

EVENT_COUNT=20
echo "📦 Sending ${EVENT_COUNT} deployment events..."
echo ""

for i in $(seq 1 $EVENT_COUNT); do
  # Random service
  SERVICE=${SERVICES[$((RANDOM % ${#SERVICES[@]}))]}
  # Random author
  AUTHOR=${AUTHORS[$((RANDOM % ${#AUTHORS[@]}))]}
  # Random environment (80% production, 20% staging)
  if [ $((RANDOM % 5)) -eq 0 ]; then
    ENV="staging"
  else
    ENV="production"
  fi
  # Random timestamp in the last 30 days
  DAYS_AGO=$((RANDOM % 30))
  HOURS_AGO=$((RANDOM % 24))
  if [[ "$OSTYPE" == "darwin"* ]]; then
    TIMESTAMP=$(date -u -v-${DAYS_AGO}d -v-${HOURS_AGO}H +%Y-%m-%dT%H:%M:%SZ)
  else
    TIMESTAMP=$(date -u -d "${DAYS_AGO} days ago ${HOURS_AGO} hours ago" +%Y-%m-%dT%H:%M:%SZ)
  fi

  send_event "$SERVICE" "$AUTHOR" "$ENV" "$TIMESTAMP"

  # Small delay to avoid rate limiting
  sleep 0.3
done

echo ""
echo "✅ Done! Sent ${EVENT_COUNT} deployment events."
echo ""
echo "   Visit: ${BASE_URL}/dashboard"
echo "   (Data should appear within 30 seconds)"
