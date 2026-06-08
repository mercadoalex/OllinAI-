#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Build and Deploy Lambda Functions
#
# Builds each Lambda handler with esbuild, zips it, and uploads to AWS.
# Terraform must have already created the Lambda function resources.
#
# Usage:
#   bash scripts/deploy-lambdas.sh
#
# Prerequisites:
#   - AWS CLI configured with appropriate permissions
#   - Node.js with esbuild available (npx)
#   - Terraform has been applied (Lambda functions exist)
# ─────────────────────────────────────────────────────────────────────────────

set -e

REGION="${AWS_REGION:-us-east-2}"
PROJECT_NAME="ollinai"
DIST_DIR="dist/lambdas"

# Lambda functions to build and deploy
LAMBDAS=(
  "correlator"
  "risk-scorer"
  "dora-computer"
  "recommendation-engine"
  "telemetry-processor"
  "retention-archiver"
)

echo "🔨 Building and deploying Lambda functions..."
echo "   Region: ${REGION}"
echo "   Project: ${PROJECT_NAME}"
echo ""

# Clean dist directory
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Build and deploy each Lambda
for lambda in "${LAMBDAS[@]}"; do
  echo "─── ${lambda} ───────────────────────────────────────"
  
  SOURCE="src/lambdas/${lambda}/handler.ts"
  
  if [ ! -f "$SOURCE" ]; then
    echo "  ⚠️  Source not found: ${SOURCE} — skipping"
    echo ""
    continue
  fi

  # Build with esbuild
  echo "  📦 Building..."
  npx esbuild "$SOURCE" \
    --bundle \
    --platform=node \
    --target=node20 \
    --outfile="${DIST_DIR}/${lambda}/handler.js" \
    --external:@aws-sdk/* \
    --minify \
    --sourcemap 2>/dev/null

  # Zip
  echo "  🗜️  Zipping..."
  cd "${DIST_DIR}/${lambda}"
  zip -qr "../../${lambda}.zip" .
  cd ../../..

  # Deploy
  echo "  🚀 Deploying to AWS..."
  aws lambda update-function-code \
    --function-name "${PROJECT_NAME}-${lambda}" \
    --zip-file "fileb://${DIST_DIR}/${lambda}.zip" \
    --region "$REGION" \
    --no-cli-pager > /dev/null 2>&1

  if [ $? -eq 0 ]; then
    echo "  ✅ Deployed ${PROJECT_NAME}-${lambda}"
  else
    echo "  ❌ Failed to deploy ${PROJECT_NAME}-${lambda}"
  fi
  echo ""
done

echo "─────────────────────────────────────────────────────────"
echo "✅ Lambda deployment complete!"
echo ""
echo "   Triggers:"
echo "   • risk-scorer     ← SQS: deployment-events queue"
echo "   • correlator      ← SQS: incidents queue"
echo "   • dora-computer   ← EventBridge: correlation/deploy events"
echo "   • recommendation  ← EventBridge: high risk scores"
echo "   • telemetry       ← SQS: agent-telemetry queue"
echo "   • retention       ← EventBridge: daily schedule"
echo ""
echo "   Next deployment webhook → risk score + DORA metrics auto-computed!"
