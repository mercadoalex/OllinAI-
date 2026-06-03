# Testing Guide — OllinAI

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Run all tests (unit + property-based)
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run only property-based tests
npm run test:properties

# Run E2E tests (requires running dev server)
npm run test:e2e
```

## Test Commands

| Command | What it does |
|---------|-------------|
| `npm test` | Runs all 899 unit + property tests once (Vitest) |
| `npm run test:watch` | Runs tests in watch mode (re-runs on save) |
| `npm run test:properties` | Runs only `tests/properties/` (fast-check property tests) |
| `npm run test:e2e` | Runs Playwright end-to-end tests |
| `npx vitest run --reporter=verbose` | Shows every test name as it runs |
| `npx vitest run tests/unit/hmac.test.ts` | Run a specific test file |
| `npx vitest run --coverage` | Run with code coverage report |

## Test Structure

```
tests/
├── unit/                    # Unit tests for all modules
│   ├── auth-session.test.ts
│   ├── rbac.test.ts
│   ├── hmac.test.ts
│   ├── webhook-deployments.test.ts
│   ├── incidents-webhook.test.ts
│   ├── correlator-handler.test.ts
│   ├── risk-scorer-handler.test.ts
│   ├── dora-computer-handler.test.ts
│   ├── recommendation-engine-handler.test.ts
│   ├── teams-api.test.ts
│   ├── services-api.test.ts
│   ├── integrations-api.test.ts
│   ├── ...and more
│
├── properties/              # Property-based tests (fast-check)
│   └── setup.test.ts
│
└── e2e/                     # End-to-end tests (Playwright)
    └── (future E2E tests)

src/                         # Co-located tests (some modules)
├── lambdas/
│   ├── remediation/handler.test.ts
│   ├── ml-inference/handler.test.ts
│   ├── ml-training/handler.test.ts
│   └── residency-processor/handler.test.ts
├── app/api/
│   ├── gates/deploy/route.test.ts
│   ├── predictions/route.test.ts
│   ├── rules/route.test.ts
│   └── settings/residency/route.test.ts
```

## Running Specific Test Groups

```bash
# Auth & security tests
npx vitest run tests/unit/auth-session.test.ts tests/unit/rbac.test.ts tests/unit/hmac.test.ts

# Webhook ingestion tests
npx vitest run tests/unit/webhook-deployments.test.ts tests/unit/incidents-webhook.test.ts

# Processing pipeline (correlator, risk, DORA, recommendations)
npx vitest run tests/unit/correlator-handler.test.ts tests/unit/risk-scorer-handler.test.ts tests/unit/dora-computer-handler.test.ts tests/unit/recommendation-engine-handler.test.ts

# ML engine tests
npx vitest run src/lambdas/ml-inference/handler.test.ts src/lambdas/ml-training/handler.test.ts

# API tests
npx vitest run tests/unit/teams-api.test.ts tests/unit/services-api.test.ts tests/unit/integrations-api.test.ts

# Dashboard
npx vitest run tests/unit/dashboard.test.ts
```

## Running the Rust Agent Tests

The eBPF agent has its own test suite using `proptest` (property-based testing for Rust):

```bash
cd agent

# Run all agent tests (requires Rust toolchain)
cargo test

# Run with output visible
cargo test -- --nocapture

# Run specific module tests
cargo test ancestry
cargo test baseline
cargo test buffer
cargo test credential
cargo test canary
cargo test signing
cargo test rules
cargo test residency
cargo test fallback
```

**Note:** The agent requires a Linux environment for full compilation (libbpf depends on kernel headers). On macOS, unit tests that don't require eBPF probes will still run. Use the Dockerfile for full builds:

```bash
docker build -f Dockerfile.agent -t ollinai-agent .
```

## Development Workflow

### 1. Running the dev server + tests together

Terminal 1:
```bash
npm run dev          # Next.js dev server on http://localhost:3000
```

Terminal 2:
```bash
npm run test:watch   # Tests re-run on every save
```

### 2. DynamoDB Local (for integration testing)

```bash
# Start DynamoDB Local
docker run -p 8000:8000 amazon/dynamodb-local

# Create tables
npm run db:local:create

# Recreate tables (drops existing data)
npm run db:local:recreate
```

### 3. Running with coverage

```bash
npx vitest run --coverage
# Coverage report generated in ./coverage/
# Open ./coverage/index.html in browser
```

## What the Tests Validate

| Category | Tests | What's verified |
|----------|-------|-----------------|
| Auth | 48 | JWT validation, RBAC enforcement, tenant isolation |
| Webhooks | 43 | HMAC signatures, Zod validation, deduplication, team assignment |
| Correlation | 23 | Window queries, temporal ranking, EventBridge emission |
| Risk Scoring | 55 | Weight computation, classification, baseline fallback |
| DORA Metrics | 30 | All 4 metrics, insufficient data handling, incremental recompute |
| Recommendations | 71 | Category mapping, trend detection, suppression, dismissal |
| Tiers | 71 | Feature gates, service limits, upgrade/downgrade |
| Dashboard | 19 | Trend computation (10% threshold rule) |
| Integrations | 27 | CRUD, key generation/rotation, revocation |
| API Export | 17 | Pagination, filters, rate limiting, tier gate |
| Audit | 25 | Enterprise gate, append-only, field completeness |
| ML Engine | 48 | Feature vectors, inference fallback, training pipeline, gate decisions |
| Telemetry | 54 | Collector API, batch validation, anomaly extraction, canary results |
| Remediation | 15 | Action determination, auto-execute thresholds, confidence scoring |
| Data Residency | 17 | Config validation, routing, cross-account processing |
| Rust Agent | 131 | Ancestry trees, batching, anomaly detection, credentials, canary, rules, signing |

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
      - run: npx vitest run --coverage
```

For the Rust agent:
```yaml
  test-agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-lang/setup-rust-toolchain@v1
      - run: cargo test
        working-directory: ./agent
```
