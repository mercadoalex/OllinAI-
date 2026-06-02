# Implementation Plan: OllinAI B2B SaaS Platform

## Overview

Incremental implementation of the OllinAI Change Intelligence and Deployment Risk platform. Phase 1 establishes core infrastructure (auth, multi-tenant DynamoDB, webhook ingestion, correlation, risk scoring, DORA metrics, dashboard). Phase 2 layers on advanced capabilities (eBPF agent, AIOps ML engine, externalized rule engine, data residency). Each task builds on prior work and integrates immediately — no orphaned code.

## Tasks

- [x] 1. Project structure, core interfaces, and infrastructure setup
  - [x] 1.1 Initialize Next.js project with TypeScript, Vitest, fast-check, and Playwright
    - Configure `next.config.js`, `tsconfig.json`, `vitest.config.ts`
    - Install dependencies: `next`, `react`, `zod`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sqs`, `next-auth`, `fast-check`, `vitest`, `@playwright/test`
    - Create directory structure: `src/lib/`, `src/app/api/`, `src/app/dashboard/`, `tests/properties/`, `tests/unit/`, `tests/e2e/`
    - _Requirements: 1.1, 9.1, 10.1_

  - [x] 1.2 Define core TypeScript interfaces and types
    - Create `src/lib/types/` with interfaces for: `DeploymentEventPayload`, `IncidentPayload`, `WebhookResponse`, `CorrelationResult`, `RiskFactors`, `RiskScoreResult`, `DORAMetrics`, `Recommendation`, `PaginatedResponse`
    - Create `src/lib/types/dynamo.ts` with DynamoDB item type definitions matching table schemas (ollinai-events, ollinai-incidents, ollinai-metrics, ollinai-config, ollinai-audit)
    - Create `src/lib/types/auth.ts` with JWT payload, roles, and permissions types
    - _Requirements: 1.2, 2.1, 3.1, 4.1, 7.2_

  - [x] 1.3 Set up DynamoDB table definitions and local development tooling
    - Create `infra/dynamodb-tables.ts` with CloudFormation/CDK table definitions for all Phase 1 tables (ollinai-events, ollinai-incidents, ollinai-metrics, ollinai-config, ollinai-audit) including GSIs
    - Create `scripts/create-local-tables.ts` using DynamoDB Local for development/testing
    - Create `src/lib/dynamo/client.ts` DynamoDB document client factory with DAX support toggle
    - _Requirements: 7.1, 1.1_

  - [x] 1.4 Set up SQS queue definitions and EventBridge rules
    - Create `infra/sqs-queues.ts` with queue definitions: `deployment-events`, `incidents`, `agent-telemetry` (each with DLQ)
    - Create `infra/eventbridge-rules.ts` with event patterns for correlation, DORA recomputation, and recommendation triggers
    - Create `src/lib/sqs/client.ts` SQS send/receive utility
    - _Requirements: 1.1, 2.2, 3.6_

- [x] 2. Authentication, authorization, and multi-tenant isolation
  - [x] 2.1 Implement NextAuth.js configuration with JWT
    - Create `src/app/api/auth/[...nextauth]/route.ts` with NextAuth config
    - Configure JWT strategy with 1-hour token validity
    - Include `tenantId`, `userId`, `role`, and `teamIds` in JWT payload
    - Create `src/lib/auth/session.ts` helper to extract session from request
    - _Requirements: 7.4, 7.5_

  - [x] 2.2 Implement RBAC middleware
    - Create `src/lib/auth/rbac.ts` with role validation logic (Tenant Admin, Team Lead, Viewer)
    - Create `src/lib/middleware/authorize.ts` that checks role permissions per endpoint
    - Implement Team Lead scope check (can only access own teams' resources)
    - Return HTTP 403 with descriptive error for unauthorized operations
    - _Requirements: 7.2, 7.3, 7.7_

  - [x] 2.3 Implement tenant isolation data access layer
    - Create `src/lib/dynamo/tenant-scope.ts` that prepends `TENANT#{tenantId}` to all partition keys
    - Ensure all DynamoDB queries are partition-key-scoped to the authenticated tenant
    - Create helper `withTenantScope(tenantId, query)` for all data access
    - _Requirements: 7.1_

  - [ ]* 2.4 Write property tests for authentication and authorization
    - **Property 16: Tenant data isolation**
    - **Property 17: RBAC enforcement**
    - **Property 18: JWT authentication validation**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7**

- [x] 3. Webhook ingestion and HMAC validation
  - [x] 3.1 Implement HMAC-SHA256 webhook signature verification
    - Create `src/lib/webhooks/hmac.ts` with signature generation and verification functions
    - Support per-integration secret keys (minimum 32 bytes)
    - Return HTTP 401 on signature mismatch with audit log entry
    - _Requirements: 10.5, 10.6_

  - [x] 3.2 Implement deployment event ingestion endpoint
    - Create `src/app/api/webhooks/deployments/route.ts`
    - Implement Zod schema validation for `DeploymentEventPayload` (1-50 SHAs, 1-20 services, required fields)
    - Persist `Deployment_Event` to DynamoDB `ollinai-events` table
    - Enqueue event reference to SQS `deployment-events` queue
    - Return HTTP 201 with `eventId` on success, HTTP 400 with field-level errors on validation failure
    - Implement deduplication check via GSI-3 (commit SHA + service + environment)
    - Auto-create unregistered services as "UNASSIGNED"
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7_

  - [x] 3.3 Implement incident ingestion endpoint
    - Create `src/app/api/webhooks/incidents/route.ts`
    - Implement Zod schema validation for `IncidentPayload`
    - Persist Incident to DynamoDB `ollinai-incidents` table
    - Enqueue incident reference to SQS `incidents` queue
    - Support resolution timestamp updates for existing incidents
    - Return HTTP 201/400 appropriately
    - _Requirements: 2.1, 2.6, 2.8_

  - [ ]* 3.4 Write property tests for ingestion
    - **Property 1: Deployment event round-trip persistence**
    - **Property 2: Validation error specificity**
    - **Property 3: Deduplication idempotence**
    - **Property 20: HMAC webhook authentication**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 10.5, 10.6**

- [x] 4. Checkpoint — Core ingestion
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Team and service management
  - [x] 5.1 Implement team CRUD API
    - Create `src/app/api/teams/route.ts` (GET list, POST create)
    - Create `src/app/api/teams/[teamId]/route.ts` (GET, PUT, DELETE/archive)
    - Enforce unique team names (1-100 chars), max 200 members
    - Reject archive when team owns services (return error with service list)
    - Store in `ollinai-config` table with SK prefix `TEAM#`
    - _Requirements: 6.1, 6.4, 6.6_

  - [x] 5.2 Implement service CRUD API
    - Create `src/app/api/services/route.ts` (GET list, POST create)
    - Create `src/app/api/services/[serviceId]/route.ts` (GET, PUT ownership change)
    - Enforce unique service names within tenant (1-150 chars)
    - Track ownership history for temporal attribution
    - Store in `ollinai-config` table with SK prefix `SVC#`
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

  - [ ]* 5.3 Write property tests for entity management
    - **Property 14: Entity uniqueness and archive constraints**
    - **Property 15: Service ownership temporal attribution**
    - **Property 4: Team assignment correctness**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6, 1.6, 1.7**

- [x] 6. Subscription tier enforcement
  - [x] 6.1 Implement subscription tier service and middleware
    - Create `src/lib/tiers/tier-config.ts` with tier definitions (Starter, Pro, Enterprise) and feature/limit mappings
    - Create `src/lib/middleware/tier-gate.ts` middleware that checks feature access per request
    - Implement service count enforcement for Starter tier (max 5)
    - Return descriptive upgrade messages when tier-restricted features are requested
    - Store subscription in `ollinai-config` with SK `SUBSCRIPTION#current`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 6.2 Implement tier upgrade/downgrade logic
    - Create `src/app/api/subscriptions/route.ts` for tier management
    - Apply new limits within 60 seconds on tier change
    - On downgrade: restrict feature access, retain data until retention policy archives
    - Implement 24-hour retention archival job (Lambda or cron)
    - _Requirements: 8.6, 8.7, 8.8_

  - [ ]* 6.3 Write property tests for tier enforcement
    - **Property 19: Subscription tier enforcement**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

- [x] 7. Incident correlation engine
  - [x] 7.1 Implement correlation Lambda function
    - Create `src/lambdas/correlator/handler.ts`
    - Query `ollinai-events` GSI-1 for deployments within Correlation_Window for the affected service
    - Rank correlations by temporal proximity (most recent first)
    - Write correlation links to both incident and event records
    - Emit `correlation.created` event to EventBridge
    - Handle zero-correlation case (mark incident as "uncorrelated")
    - _Requirements: 2.2, 2.3, 2.5, 2.7_

  - [x] 7.2 Implement correlation window configuration
    - Create `src/app/api/settings/correlation/route.ts`
    - Validate window between 5 minutes and 24 hours
    - Default to 60 minutes when not configured
    - Store in `ollinai-config` table
    - _Requirements: 2.3, 2.4_

  - [ ]* 7.3 Write property tests for correlation
    - **Property 5: Incident correlation correctness**
    - **Property 6: Correlation window bounds validation**
    - **Validates: Requirements 2.2, 2.4, 2.5, 2.7**

- [x] 8. Risk scoring engine
  - [x] 8.1 Implement risk scoring Lambda function
    - Create `src/lambdas/risk-scorer/handler.ts`
    - Compute weighted risk score from factors: change failure rate (0.35), change size (0.25), deployment timing (0.20), author failure rate (0.20)
    - Use 90-day lookback window for historical data
    - Classify into: low [0, 0.3), medium [0.3, 0.55), high [0.55, 0.8), critical [0.8, 1.0]
    - Fall back to org-wide baseline when <10 historical deployments
    - Handle computation failure: mark as "indeterminate", notify admin
    - Update event record with risk score in `ollinai-events`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.7_

  - [x] 8.2 Implement custom risk weight configuration
    - Create `src/app/api/settings/risk-weights/route.ts`
    - Validate: all weights in [0, 1], sum to 1.0
    - Store custom weights in `ollinai-config`
    - Risk scorer reads tenant-specific weights if configured
    - _Requirements: 4.4, 4.8_

  - [x] 8.3 Implement pre-deployment risk assessment API
    - Create `src/app/api/risk/assess/route.ts`
    - Accept proposed change metadata (service, author, change size, planned timestamp)
    - Compute and return projected risk score without persisting an event
    - Return within 5 seconds
    - _Requirements: 4.6_

  - [ ]* 8.4 Write property tests for risk scoring
    - **Property 8: Risk score weighted computation**
    - **Property 9: Risk weight validation**
    - **Property 10: Pre-deployment assessment is side-effect-free**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6, 4.8**

- [x] 9. DORA metrics computation
  - [x] 9.1 Implement DORA metrics Lambda function
    - Create `src/lambdas/dora-computer/handler.ts`
    - Compute: Deployment Frequency, Lead Time, Change Failure Rate, MTTR
    - Triggered by EventBridge events (new deployment or incident correlation)
    - Incremental update, reflect within 60 seconds
    - Handle "insufficient data" (fewer than 3 data points)
    - Exclude unresolved incidents from MTTR, report count separately
    - Write results to `ollinai-metrics` table
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8_

  - [x] 9.2 Implement DORA metrics query API
    - Create `src/app/api/metrics/dora/route.ts`
    - Support filters: team, service, environment, time range
    - Default time range: 30 days, max 365 days
    - Read from DAX cache when available
    - _Requirements: 3.5_

  - [ ]* 9.3 Write property tests for DORA metrics
    - **Property 7: DORA metrics computation correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8**

- [x] 10. Checkpoint — Core processing pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Recommendation engine
  - [x] 11.1 Implement recommendation Lambda function
    - Create `src/lambdas/recommendation-engine/handler.ts`
    - Generate recommendations for high/critical risk deployments within 10 seconds
    - Map dominant risk factor to category: reduce_change_size, adjust_timing, increase_review, split_service, add_canary
    - Include supporting data summary (metric values, time range, affected service/team)
    - Implement trend-based recommendations (20pp CFR increase in 7-day window, min 5 events)
    - Store recommendations in `ollinai-config`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_

  - [x] 11.2 Implement recommendation dismissal and suppression
    - Create `src/app/api/recommendations/[id]/dismiss/route.ts`
    - Record dismissal, suppress same category for same team+service for 14 days
    - Query suppression state before generating new recommendations
    - _Requirements: 5.5_

  - [ ]* 11.3 Write property tests for recommendations
    - **Property 11: Recommendation category mapping**
    - **Property 12: Trend-based recommendation trigger**
    - **Property 13: Recommendation suppression after dismissal**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

- [x] 12. Dashboard and visualization
  - [x] 12.1 Implement dashboard summary page
    - Create `src/app/dashboard/page.tsx` with server components
    - Display all four DORA metrics with trend indicators (improving/degrading/stable based on 10% threshold)
    - Display risk score distribution histogram
    - Implement 30-second ISR revalidation + client-side polling
    - Time range selector: 7, 14, 30, 60, 90 days (constrained by retention period)
    - Handle insufficient data state (<3 events)
    - _Requirements: 9.1, 9.4, 9.5, 9.7, 9.8_

  - [x] 12.2 Implement deployment timeline and filtered views
    - Create `src/app/dashboard/deployments/page.tsx` with color-coded risk timeline
    - Create `src/app/dashboard/[teamId]/page.tsx` for team-scoped view
    - Create `src/app/dashboard/[serviceId]/page.tsx` for service-scoped view
    - Overlay correlated incidents on timeline
    - Filter all visualizations by selected scope
    - _Requirements: 9.2, 9.3, 9.9_

  - [x] 12.3 Implement settings pages
    - Create `src/app/settings/teams/page.tsx` — Team/service CRUD UI
    - Create `src/app/settings/integrations/page.tsx` — Webhook config, secret key management
    - Create `src/app/settings/billing/page.tsx` — Subscription tier management UI
    - _Requirements: 6.1, 10.7, 8.7_

- [x] 13. Integration management
  - [x] 13.1 Implement integration configuration API
    - Create `src/app/api/integrations/route.ts` (CRUD for integrations)
    - Generate, rotate, and revoke secret keys per integration
    - Store in `ollinai-config` with SK prefix `INTEGRATION#`
    - _Requirements: 10.7_

  - [x] 13.2 Implement integration test connectivity
    - Create `src/app/api/integrations/[id]/test/route.ts`
    - Send test event and validate within 10 seconds
    - Return success/failure with processing confirmation
    - _Requirements: 10.4_

  - [x] 13.3 Create CI/CD pipeline action templates
    - Create `integrations/github-actions/ollinai-deploy-event/action.yml`
    - Create `integrations/gitlab-ci/.ollinai-deploy.yml` template
    - Document generic webhook schema for custom integrations
    - Support max 1 MB payload size per request
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 14. API access and data export (Enterprise)
  - [x] 14.1 Implement RESTful data export API
    - Create `src/app/api/v1/deployments/route.ts` — paginated deployment events
    - Create `src/app/api/v1/incidents/route.ts` — paginated incidents
    - Create `src/app/api/v1/metrics/route.ts` — DORA metrics export
    - Support filters: service, team, time range, risk score severity
    - Default page size 25, max 100, include totalCount, currentPage, hasMore
    - Gate behind Enterprise tier
    - _Requirements: 11.1, 11.2, 11.5, 11.7_

  - [x] 14.2 Implement rate limiting
    - Create `src/lib/middleware/rate-limit.ts` using Vercel KV (Redis) sliding window
    - Enforce 100 requests/min per tenant
    - Return HTTP 429 with Retry-After header on limit exceeded
    - _Requirements: 11.3, 11.4_

  - [ ]* 14.3 Write property tests for API access
    - **Property 21: Pagination consistency**
    - **Property 22: API filter correctness**
    - **Validates: Requirements 11.2, 11.5, 11.7**

- [x] 15. Audit logging
  - [x] 15.1 Implement audit logging service
    - Create `src/lib/audit/logger.ts` with structured audit event recording
    - Log: actor identity, action, target resource, UTC timestamp (ms precision), source IP, outcome
    - Write to `ollinai-audit` table (append-only, no delete/update operations exposed)
    - 365-day minimum retention regardless of tier retention period
    - Gate recording behind Enterprise tier (retain existing logs on downgrade)
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6_

  - [x] 15.2 Implement audit log query API
    - Create `src/app/api/audit/route.ts`
    - Paginated results (max 100/page), filterable by actor, action, resource, time range
    - Return within 5 seconds for queries up to 90 days
    - Enterprise tier only
    - _Requirements: 12.4_

  - [ ]* 15.3 Write property tests for audit logging
    - **Property 23: Audit log completeness and immutability**
    - **Validates: Requirements 12.1, 12.2, 12.5**

- [x] 16. Checkpoint — Complete Phase 1 platform
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. eBPF Agent — Core telemetry collection (Phase 2, Rust)
  - [x] 17.1 Initialize Rust agent project and eBPF probe infrastructure
    - Create `agent/` Rust workspace with `Cargo.toml`
    - Set up libbpf-rs dependencies, probe attachment for `execve`, `fork`, `clone`, network syscalls, file operations
    - Define `TelemetryEvent` enum and `AgentConfig` struct
    - Configure static binary build (musl) and distroless container image (Dockerfile)
    - _Requirements: 13.1, 13.2_

  - [x] 17.2 Implement process ancestry tree tracking
    - Implement `ProcessAncestry` and `ProcessNode` structs
    - Attach eBPF probes to track parent-child process relationships
    - Maintain in-memory process tree (HashMap-based)
    - Record command, arguments, working directory per process
    - _Requirements: 13.4_

  - [x] 17.3 Implement telemetry batching and transmission
    - Implement `TelemetryBuffer` ring buffer (5-minute capacity)
    - Batch events (max 500 per batch), transmit within 10 seconds of capture
    - Implement retry logic: buffer locally 5 min, retry every 30s
    - Handle buffer overflow: drop oldest events, record drop count
    - _Requirements: 13.9, 13.14, 13.15_

  - [x] 17.4 Implement anomaly detection against baseline
    - Implement rolling baseline computation (previous 10 executions)
    - Detect resource anomalies: >2x CPU or memory vs rolling average
    - Detect network anomalies: connections to domains not in baseline
    - Baseline-building mode for <5 executions (no flags generated)
    - _Requirements: 13.3, 13.8, 13.13_

  - [x] 17.5 Implement supply chain credential exfiltration detection
    - Detect credential file access from package installation descendants
    - Match patterns: `~/.aws/credentials`, `~/.docker/config.json`, SSH keys, GITHUB_TOKEN
    - Check Process_Ancestry for package installer ancestors (npm, pip, go, cargo)
    - Flag high-confidence exfiltration attempts
    - _Requirements: 13.5_

  - [x] 17.6 Implement userspace fallback mode
    - Detect when eBPF probe attachment fails (kernel version/permissions)
    - Fall back to userspace process tree and network connection collection
    - Log degraded-mode warning and report status to Collector_API
    - _Requirements: 13.12_

  - [ ]* 17.7 Write property tests for eBPF agent core (Rust proptest)
    - **Property 24: eBPF anomaly detection against baseline**
    - **Property 25: Telemetry batching invariant**
    - **Property 29: Process ancestry tree well-formedness**
    - **Property 30: Supply chain credential exfiltration detection**
    - **Validates: Requirements 13.3, 13.4, 13.5, 13.8, 13.9**

- [x] 18. eBPF Agent — Build attestation and canary observation (Phase 2)
  - [x] 18.1 Implement Build_Attestation generation
    - Serialize complete process tree, network connections, file writes at pipeline completion
    - Compute SHA-256 digest of complete telemetry stream
    - Generate in-toto-compatible attestation document
    - _Requirements: 13.6_

  - [x] 18.2 Implement Ed25519 attestation signing
    - Per-agent Ed25519 key pair management
    - Sign Build_Attestation with private key
    - Transmit signed attestation alongside telemetry batch
    - _Requirements: 13.7_

  - [x] 18.3 Implement post-deploy canary observation
    - Detect deployments via Kubernetes rollout events, systemd restarts, binary changes
    - Observe syscall profile, network, errors for configurable window (default 5 min, range 1-60 min)
    - Compare post-deploy profile against rolling baseline (10 previous deployments)
    - Flag deviations exceeding threshold (default 30%, configurable 5-95%)
    - Detect kernel-level errors (OOM, segfaults, 5+ failed connections in 30s)
    - Report healthy canary or early warning within 5 seconds
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6, 14.9_

  - [ ]* 18.4 Write property tests for attestation and canary (Rust proptest)
    - **Property 26: Syscall profile deviation detection**
    - **Property 31: Build attestation completeness and digest integrity**
    - **Property 32: Build attestation signature verification**
    - **Validates: Requirements 13.6, 13.7, 14.2, 14.5**

- [x] 19. Collector API and eBPF integration
  - [x] 19.1 Implement Collector API endpoint
    - Create `src/app/api/collector/telemetry/route.ts`
    - Accept telemetry batches from agents (max 500 events)
    - Validate batch format, persist to SQS `agent-telemetry` queue
    - Accept Build_Attestation documents, store in `ollinai-attestations` table
    - _Requirements: 13.9, 13.6, 13.7_

  - [x] 19.2 Implement telemetry processing Lambda
    - Create `src/lambdas/telemetry-processor/handler.ts`
    - Process agent telemetry: extract anomaly flags, resource metrics
    - Incorporate eBPF signals as Risk_Factors in Risk_Score computation
    - Correlate early warnings with Deployment_Events, escalate Risk_Score
    - Apply healthy canary results (reduce Risk_Score by one level)
    - _Requirements: 13.11, 14.4, 14.5_

- [x] 20. Checkpoint — eBPF Agent complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Externalized Rule Engine (Phase 2)
  - [x] 21.1 Implement rule YAML parser and engine (Rust)
    - Create `agent/src/rules/` module
    - Parse declarative YAML rule language
    - Support match types: processAncestry, fileAccess, networkDestination, resourceThreshold
    - Support AND/OR condition combinators
    - Implement hot-reload: replace in-memory rule set without restart
    - _Requirements: 18.1, 18.2, 18.4_

  - [x] 21.2 Implement monitor-only and enforcement modes
    - Monitor mode: log matches, do not terminate pipeline
    - Enforcement mode: critical matches terminate job immediately, info/warning continue
    - Emit alert events with: rule ID, matched process, Process_Ancestry chain, severity
    - _Requirements: 18.5, 18.6_

  - [x] 21.3 Implement OCI Rule_Bundle distribution (Lambda + ECR)
    - Create `src/lambdas/rule-publisher/handler.ts`
    - Package rules as OCI artifacts, push to private ECR registry
    - Implement semantic versioning and 3-version retention
    - Create Rule_Bundle metadata records in `ollinai-rule-bundles` table
    - Agent polls ECR at configurable interval (default 6h, range 1h-24h)
    - Handle fetch failures: continue with last loaded bundle
    - _Requirements: 18.1, 18.2, 18.7, 18.8_

  - [x] 21.4 Implement custom rule authoring API
    - Create `src/app/api/rules/route.ts` for rule CRUD
    - Create `src/app/api/rules/bundles/route.ts` for bundle management
    - Validate YAML rule syntax on submission
    - Provide baseline rules: credential access, exfiltration, crypto miner, malicious domains
    - _Requirements: 18.3, 18.4_

  - [ ]* 21.5 Write property tests for rule engine
    - **Property 33: Rule_Bundle update interval validation**
    - **Property 34: Detection rule YAML round-trip**
    - **Property 35: Detection alert event completeness**
    - **Property 36: Monitor vs enforcement mode behavior**
    - **Property 37: Rule_Bundle version retention**
    - **Validates: Requirements 18.2, 18.4, 18.5, 18.6, 18.8**

- [x] 22. AIOps ML Engine (Phase 2)
  - [x] 22.1 Implement feature vector construction
    - Create `src/lib/ml/features.ts`
    - Construct Feature_Vectors from: change size, deployment timing, service failure rate (30d), author failure rate (90d), time since last incident, dependency count, eBPF anomaly score
    - Validate feature completeness before inference
    - _Requirements: 15.10_

  - [x] 22.2 Implement ML inference Lambda
    - Create `src/lambdas/ml-inference/handler.ts`
    - Call SageMaker endpoint for prediction
    - Return Prediction_Score (0.0-1.0) with ≤200ms latency
    - Fall back to rule-based scoring when model unavailable or <100 events / <10 incidents
    - Label source as "ml_model" or "rule_engine"
    - _Requirements: 15.4, 15.8, 16.1, 16.8_

  - [x] 22.3 Implement training pipeline orchestration
    - Create `src/lambdas/ml-training/handler.ts`
    - Trigger SageMaker training at configurable interval (default 24h, range 6h-7d)
    - Validate against 20% holdout: promote only if accuracy improves ≥1pp
    - Store model metadata in `ollinai-ml` table (version, metrics, status)
    - Compute Drift_Score at each interval; trigger immediate retrain if >0.7
    - Alert after 3 consecutive promotion failures
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7_

  - [x] 22.4 Implement predictive intelligence APIs
    - Create `src/app/api/predictions/route.ts` — incident predictions per deployment
    - Implement continuous anomaly detection (3σ deviation from model prediction interval)
    - Correlate anomaly signals with deployments, generate early warnings within 30 seconds
    - Implement ML-based root cause analysis: rank deployments by causal patterns, top 3 with confidence scores
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.7_

  - [x] 22.5 Implement deployment gate API
    - Create `src/app/api/gates/deploy/route.ts`
    - Combine ML Prediction_Score + rule-based Risk_Score
    - Return: proceed (<0.5), warn (0.5-0.8), block (>0.8) — configurable per service
    - Include contributing factors and mitigations on "block"
    - _Requirements: 17.6, 17.7_

  - [x] 22.6 Implement automated remediation
    - Create `src/lambdas/remediation/handler.ts`
    - Generate Remediation_Action for critical+high-prediction deployments within 10 seconds
    - Action types: rollback, halt canary, scale up, notify on-call
    - Auto-execute when prediction >0.9, confidence >0.85, and auto-remediation enabled
    - Log all actions, notify team within 5 seconds
    - Recommendation-only mode when auto-remediation disabled
    - Track outcomes for model retraining
    - Handle conflicts with last operator decision (require confirmation)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.8, 17.9, 17.10_

  - [ ]* 22.7 Write property tests for ML engine
    - **Property 27: Deployment gate decision**
    - **Property 28: Model drift detection and retraining trigger**
    - **Validates: Requirements 15.5, 15.6, 17.6, 17.7**

- [x] 23. Checkpoint — ML engine complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 24. Data Residency Service (Phase 2)
  - [x] 24.1 Implement data residency configuration API
    - Create `src/app/api/settings/residency/route.ts`
    - Accept: S3 bucket ARN, region, cross-account role ARN, external ID
    - Validate connectivity: write/read test object within 30 seconds
    - Store config in `ollinai-data-residency` table
    - Enterprise tier only
    - _Requirements: 19.1, 19.2, 19.4_

  - [x] 24.2 Implement agent telemetry routing for data residency
    - Add Data_Residency_Mode to agent config (Rust)
    - When enabled: write telemetry + attestations to tenant S3 bucket
    - When disabled: route to Collector_API
    - Handle S3 write failures with standard buffer policy (5 min, retry 30s)
    - _Requirements: 19.1, 19.5_

  - [x] 24.3 Implement cross-account processing Lambda
    - Create `src/lambdas/residency-processor/handler.ts`
    - Assume cross-account IAM role via STS (with external ID)
    - Read telemetry from tenant S3 bucket
    - Deploy Lambda in same region as tenant bucket
    - Persist ONLY derived metrics (Risk_Scores, Anomaly_Signals, Predictions) — never raw telemetry
    - Handle assume-role failures: retry with backoff, mark config as "error"
    - _Requirements: 19.2, 19.3, 19.6_

  - [ ]* 24.4 Write property tests for data residency
    - **Property 38: Telemetry routing by Data Residency mode**
    - **Property 39: No raw telemetry persistence on OllinAI infrastructure**
    - **Property 40: Region-matched processing**
    - **Validates: Requirements 19.1, 19.3, 19.6**

- [x] 25. Final checkpoint — All phases complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between major phases
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Phase 1 (tasks 1-16) delivers a fully functional core platform
- Phase 2 (tasks 17-25) adds advanced capabilities: eBPF, ML, Rule Engine, Data Residency
- The eBPF agent tasks (17-18) use Rust with proptest; all other property tests use TypeScript with fast-check
- DynamoDB Local should be used for all integration tests during development

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "2.3"] },
    { "id": 3, "tasks": ["2.2", "3.1"] },
    { "id": 4, "tasks": ["2.4", "3.2", "3.3"] },
    { "id": 5, "tasks": ["3.4", "5.1", "5.2"] },
    { "id": 6, "tasks": ["5.3", "6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3", "8.1", "8.2"] },
    { "id": 9, "tasks": ["8.3", "8.4", "9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3", "11.1"] },
    { "id": 11, "tasks": ["11.2", "11.3", "12.1"] },
    { "id": 12, "tasks": ["12.2", "12.3", "13.1"] },
    { "id": 13, "tasks": ["13.2", "13.3", "14.1"] },
    { "id": 14, "tasks": ["14.2", "14.3", "15.1"] },
    { "id": 15, "tasks": ["15.2", "15.3"] },
    { "id": 16, "tasks": ["17.1"] },
    { "id": 17, "tasks": ["17.2", "17.3"] },
    { "id": 18, "tasks": ["17.4", "17.5", "17.6"] },
    { "id": 19, "tasks": ["17.7", "18.1"] },
    { "id": 20, "tasks": ["18.2", "18.3"] },
    { "id": 21, "tasks": ["18.4", "19.1"] },
    { "id": 22, "tasks": ["19.2", "21.1"] },
    { "id": 23, "tasks": ["21.2", "21.3"] },
    { "id": 24, "tasks": ["21.4", "21.5", "22.1"] },
    { "id": 25, "tasks": ["22.2", "22.3"] },
    { "id": 26, "tasks": ["22.4", "22.5"] },
    { "id": 27, "tasks": ["22.6", "22.7"] },
    { "id": 28, "tasks": ["24.1"] },
    { "id": 29, "tasks": ["24.2", "24.3"] },
    { "id": 30, "tasks": ["24.4"] }
  ]
}
```
