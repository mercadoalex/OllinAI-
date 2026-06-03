# Deployment Guide — OllinAI

## Overview

OllinAI uses a split deployment:
- **Vercel** → Frontend (dashboard), API routes (webhooks, settings, data export)
- **AWS** → Backend processing (Lambdas for correlation, risk scoring, DORA, ML, telemetry)

---

## 1. Vercel Deployment (Frontend + API Routes)

### First-Time Setup

1. **Install Vercel CLI** (optional, for local preview):
   ```bash
   npm i -g vercel
   ```

2. **Connect repository to Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import the GitHub repository
   - Framework: Next.js (auto-detected)
   - Root directory: `.` (project root)
   - Build command: `npm run build`
   - Output directory: `.next`

3. **Configure environment variables** in Vercel dashboard → Settings → Environment Variables:

   | Variable | Value | Required |
   |----------|-------|:--------:|
   | `NEXTAUTH_SECRET` | Random 32+ char secret (`openssl rand -base64 32`) | ✅ |
   | `NEXTAUTH_URL` | `https://app.ollinai.com` (your domain) | ✅ |
   | `AWS_REGION` | `us-east-1` | ✅ |
   | `AWS_ACCESS_KEY_ID` | IAM user credentials for DynamoDB/SQS | ✅ |
   | `AWS_SECRET_ACCESS_KEY` | IAM user secret key | ✅ |
   | `KV_REST_API_URL` | Vercel KV Redis URL (for rate limiting) | ⬜ |
   | `KV_REST_API_TOKEN` | Vercel KV token | ⬜ |
   | `USE_DAX` | `true` (if DAX cluster is provisioned) | ⬜ |
   | `DAX_ENDPOINT` | DAX cluster endpoint | ⬜ |

4. **Add Vercel KV** (for rate limiting):
   - Vercel dashboard → Storage → Create KV Database
   - Environment variables are auto-injected

5. **Custom domain** (optional):
   - Vercel dashboard → Settings → Domains → Add `app.ollinai.com`

### Deployment Flow

```
Push to main → Vercel builds → Preview URL generated → Promoted to production
Push to PR branch → Preview deployment created (unique URL per PR)
```

Every push to `main` auto-deploys. No manual steps needed after initial setup.

### Local Preview

```bash
# Link to Vercel project (first time only)
vercel link

# Pull environment variables
vercel env pull .env.local

# Run production build locally
vercel build
vercel dev
```

---

## 2. AWS Deployment (Lambdas + Infrastructure)

### Prerequisites

- Terraform >= 1.5.0 installed
- AWS CLI configured (`aws configure`)
- S3 bucket for Terraform state: `ollinai-terraform-state`
- DynamoDB table for state locking: `ollinai-terraform-locks`

### Initial Infrastructure Provisioning

```bash
cd infra/terraform

# Copy example vars and customize
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Initialize Terraform
terraform init

# Plan changes
terraform plan -out=tfplan

# Apply infrastructure
terraform apply tfplan
```

### Lambda Deployment

Lambda function code is deployed separately from infrastructure. Use a CI/CD pipeline or manual deployment:

```bash
# Build Lambda packages
cd src/lambdas/correlator
npm run build:lambda  # (add this script to package.json)
zip -r ../../../infra/terraform/correlator.zip .

# Deploy via Terraform or direct update
aws lambda update-function-code \
  --function-name ollinai-correlator \
  --zip-file fileb://correlator.zip
```

For production, use GitHub Actions (see CI/CD section below).

---

## 3. CI/CD Pipeline (GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy OllinAI

on:
  push:
    branches: [main]

jobs:
  # ─── Tests ──────────────────────────────────────────────────────────────
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  # ─── Vercel Deploy (automatic via Vercel Git Integration) ───────────────
  # No action needed — Vercel deploys automatically on push to main.
  # This job just gates it behind passing tests.

  # ─── AWS Lambda Deploy ─────────────────────────────────────────────────
  deploy-lambdas:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/ollinai-deploy
          aws-region: us-east-1

      - name: Package and deploy Lambdas
        run: |
          # Build all Lambda handlers
          npx esbuild src/lambdas/correlator/handler.ts --bundle --platform=node --target=node20 --outfile=dist/correlator/handler.js
          npx esbuild src/lambdas/risk-scorer/handler.ts --bundle --platform=node --target=node20 --outfile=dist/risk-scorer/handler.js
          npx esbuild src/lambdas/dora-computer/handler.ts --bundle --platform=node --target=node20 --outfile=dist/dora-computer/handler.js
          npx esbuild src/lambdas/recommendation-engine/handler.ts --bundle --platform=node --target=node20 --outfile=dist/recommendation-engine/handler.js
          npx esbuild src/lambdas/telemetry-processor/handler.ts --bundle --platform=node --target=node20 --outfile=dist/telemetry-processor/handler.js
          npx esbuild src/lambdas/retention-archiver/handler.ts --bundle --platform=node --target=node20 --outfile=dist/retention-archiver/handler.js
          npx esbuild src/lambdas/ml-inference/handler.ts --bundle --platform=node --target=node20 --outfile=dist/ml-inference/handler.js
          npx esbuild src/lambdas/ml-training/handler.ts --bundle --platform=node --target=node20 --outfile=dist/ml-training/handler.js
          npx esbuild src/lambdas/remediation/handler.ts --bundle --platform=node --target=node20 --outfile=dist/remediation/handler.js
          npx esbuild src/lambdas/rule-publisher/handler.ts --bundle --platform=node --target=node20 --outfile=dist/rule-publisher/handler.js
          npx esbuild src/lambdas/residency-processor/handler.ts --bundle --platform=node --target=node20 --outfile=dist/residency-processor/handler.js

          # Zip and deploy each
          for lambda in correlator risk-scorer dora-computer recommendation-engine telemetry-processor retention-archiver ml-inference ml-training remediation rule-publisher residency-processor; do
            cd dist/$lambda
            zip -r ../../$lambda.zip .
            cd ../..
            aws lambda update-function-code \
              --function-name ollinai-$lambda \
              --zip-file fileb://$lambda.zip
          done

  # ─── Terraform (infra changes only) ────────────────────────────────────
  deploy-infra:
    needs: test
    runs-on: ubuntu-latest
    if: contains(github.event.head_commit.message, '[infra]')
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/ollinai-deploy
          aws-region: us-east-1

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.0

      - name: Terraform Apply
        working-directory: infra/terraform
        run: |
          terraform init
          terraform plan -out=tfplan
          terraform apply -auto-approve tfplan
```

---

## 4. Environment-Specific Configuration

### Development
```bash
# .env.local (auto-loaded by Next.js in dev)
NEXTAUTH_SECRET=dev-secret-for-local-only
NEXTAUTH_URL=http://localhost:3000
AWS_REGION=us-east-1
DYNAMODB_ENDPOINT=http://localhost:8000  # DynamoDB Local
SQS_ENDPOINT=http://localhost:4566       # LocalStack
```

### Staging
- Vercel preview deployments (automatic per PR)
- Separate AWS account or prefixed resources (`ollinai-staging-*`)

### Production
- Vercel production deployment (auto on push to `main`)
- Production AWS account with Terraform-managed resources
- Vercel KV enabled for rate limiting
- DAX cluster enabled for read acceleration

---

## 5. eBPF Agent Distribution

The Rust agent is distributed separately:

```bash
# Build and push container image
cd agent
docker build -f Dockerfile.agent -t ollinai-agent:latest .
docker tag ollinai-agent:latest $ECR_REPO_URL:latest
docker push $ECR_REPO_URL:latest

# Or download static binary (for VM-based runners)
# Distributed via GitHub Releases or S3 bucket
```

---

## 6. Post-Deployment Verification

```bash
# Check health endpoint
curl https://app.ollinai.com/health

# Verify webhook ingestion
curl -X POST https://app.ollinai.com/api/webhooks/deployments \
  -H "Content-Type: application/json" \
  -H "X-OllinAI-Signature: $(echo -n $PAYLOAD | openssl dgst -sha256 -hmac $SECRET)" \
  -H "X-OllinAI-Integration: $TENANT:$INTEGRATION" \
  -d '{"commitShas":["abc123"],"author":"test","services":["test-svc"],"deploymentTimestamp":"2024-01-01T00:00:00Z","environment":"test"}'

# Check dashboard loads
open https://app.ollinai.com/dashboard
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Vercel build fails | Check `next.config.js` serverComponentsExternalPackages includes AWS SDK |
| Lambda timeout | Increase `timeout` in `lambda.tf` or check DynamoDB access |
| CORS errors | Vercel handles CORS automatically for same-origin; for cross-origin, configure in `vercel.json` headers |
| DynamoDB access denied | Verify IAM credentials have correct table permissions |
| Rate limiter not working | Enable Vercel KV and set `KV_REST_API_URL` env var |
| Health check returns 404 | Verify `/api/health/route.ts` exists and `vercel.json` rewrite is correct |
