#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Sync Terraform AWS Credentials to Vercel
#
# Reads the IAM credentials from Terraform output and updates Vercel
# environment variables via the Vercel CLI.
#
# Usage:
#   bash scripts/sync-vercel-env.sh
#
# Prerequisites:
#   - Terraform applied (infra/terraform)
#   - Vercel CLI installed and linked to the project
#   - Run from the project root directory
# ─────────────────────────────────────────────────────────────────────────────

set -e

TERRAFORM_DIR="infra/terraform"

echo "🔑 Syncing AWS credentials from Terraform to Vercel..."
echo ""

# Step 1: Get credentials from Terraform
echo "  → Reading Terraform outputs..."
ACCESS_KEY=$(cd "$TERRAFORM_DIR" && terraform output -raw vercel_iam_access_key_id 2>/dev/null)
SECRET_KEY=$(cd "$TERRAFORM_DIR" && terraform output -raw vercel_iam_secret_access_key 2>/dev/null)

if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ]; then
  echo "  ❌ Failed to read Terraform outputs."
  echo "     Make sure you've run 'terraform apply' in $TERRAFORM_DIR"
  exit 1
fi

echo "  ✅ Access Key: ${ACCESS_KEY:0:8}..."
echo "  ✅ Secret Key: (${#SECRET_KEY} chars)"
echo ""

# Step 2: Remove existing env vars (ignore errors if they don't exist)
echo "  → Removing old Vercel env vars..."
vercel env rm AWS_ACCESS_KEY_ID production --yes 2>/dev/null || true
vercel env rm AWS_ACCESS_KEY_ID preview --yes 2>/dev/null || true
vercel env rm AWS_SECRET_ACCESS_KEY production --yes 2>/dev/null || true
vercel env rm AWS_SECRET_ACCESS_KEY preview --yes 2>/dev/null || true

# Step 3: Add new env vars
echo "  → Setting new Vercel env vars..."
echo -n "$ACCESS_KEY" | vercel env add AWS_ACCESS_KEY_ID production
echo -n "$ACCESS_KEY" | vercel env add AWS_ACCESS_KEY_ID preview
echo -n "$SECRET_KEY" | vercel env add AWS_SECRET_ACCESS_KEY production
echo -n "$SECRET_KEY" | vercel env add AWS_SECRET_ACCESS_KEY preview

echo ""
echo "✅ Vercel environment variables updated!"
echo ""
echo "   Next steps:"
echo "   1. Trigger a redeploy: vercel --prod"
echo "      Or push a commit to main (auto-deploys)"
echo "   2. Verify: curl -s https://ollin-ai.vercel.app/api/debug/dashboard"
