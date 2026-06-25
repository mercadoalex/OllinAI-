# OllinAI — Hackathon Story

## Inspiration

I spent years watching mid-market engineering teams (50–500 engineers) struggle with the same invisible problem: they deploy fast, but they have no idea which deployment just broke production. Incident correlation happens manually — hours later — while DORA metrics rot in quarterly spreadsheets that nobody reads.

The breaking point was seeing a supply chain attack exfiltrate credentials during a CI/CD run and leave zero trace. The runner was ephemeral. The evidence was gone. Nobody even knew it happened.

I wanted to build something that gives engineering teams real-time visibility, automated correlation, and kernel-level security — all in one platform. And I wanted DynamoDB's partition key model to be the security foundation, not just the storage layer.

The name "Ollin" comes from Nahuatl (the Aztec language) — it means "movement" or "change." Every deployment is a change. OllinAI understands the risk profile of every single one.

## What it does

OllinAI is a B2B SaaS platform that:

- **Automates DORA metrics in real-time** — Deployment Frequency, Lead Time, Change Failure Rate, and MTTR computed incrementally as CI/CD events flow in
- **Scores every deployment for risk** — weighted factors including historical failure rate, change size, timing, and author patterns produce a low/medium/high/critical classification
- **Correlates incidents to deployments automatically** — when PagerDuty fires, OllinAI links it to the causing deployment within seconds
- **Predicts failures before they happen** — an ML engine trained on deployment history forecasts which pushes will cause incidents
- **Detects supply chain attacks at the kernel level** — a Rust eBPF agent captures process ancestry trees and credential access during CI/CD execution
- **Generates cryptographic build attestations** — in-toto framework attestations prove exactly what ran in every pipeline

Teams get a live dashboard with risk distribution, team comparisons, service health, predictions, and business impact metrics — all updating in real-time.

## How we built it

**Frontend:** Next.js 14 (App Router) deployed on Vercel with ISR caching and client-side polling every 30 seconds. Progressive loading for advanced metric sections.

**Database:** Amazon DynamoDB — the architectural centerpiece. We use:
- Single-table design for configuration (10+ entity types, zero migrations)
- 3 Global Secondary Indexes on the events table for correlation, team views, and deduplication
- DynamoDB Streams triggering Lambda-based risk scoring and DORA computation
- ACID transactions for atomic integration creation + audit logging
- Conditional writes for concurrent onboarding safety
- TTL for automatic token cleanup
- DAX for microsecond dashboard reads under load

**The key insight:** DynamoDB's partition key model (`TENANT#{id}`) IS the security model. Cross-tenant data access isn't prevented by application code — it's physically impossible at the storage layer. There's no forgotten WHERE clause, no SQL injection vector, no accidental data leak.

**eBPF Agent:** Written in Rust with libbpf. Attaches to kernel tracepoints to capture process ancestry, network connections, and credential file access during CI/CD runs. Detects supply chain attacks by correlating package installer processes with unauthorized network connections.

**ML Pipeline:** Amazon SageMaker for training and inference. Feature vectors built from deployment metadata, historical patterns, and service-level risk profiles. Models retrain continuously with drift detection.

**Infrastructure:** Terraform-managed AWS resources — DynamoDB tables, SQS queues, EventBridge rules, Lambda functions, IAM policies. Vercel for frontend deployment.

## Challenges we ran into

**DynamoDB access pattern design** was the hardest upfront investment. Single-table design requires you to think about every query before writing a single line of code. We iterated on the partition key schema multiple times before landing on the final structure that supports all 4 access patterns with 3 GSIs.

**Multi-tenant isolation testing** — proving that cross-tenant access is truly impossible required writing property-based tests (fast-check) that generate random tenant IDs and verify zero data leakage across thousands of randomized scenarios.

**eBPF on ephemeral CI/CD runners** — containers are destroyed after each job. We had to buffer telemetry in a ring buffer and flush attestations before the runner terminates. Static musl binaries were necessary because runners have unpredictable library environments.

**Real-time DORA computation** — computing metrics incrementally (not batch) from DynamoDB Streams required careful handling of out-of-order events and idempotent processing to avoid double-counting.

**Credential management across destroy/rebuild cycles** — every `terraform destroy` + `apply` generates new IAM credentials that must be synced to Vercel. We built backup/restore scripts and sync tooling to make this manageable.

## Accomplishments that we're proud of

- **The partition key IS the security model** — we didn't bolt security onto a database. We chose a database whose architecture enforces our most critical requirement structurally. Every compliance auditor we've shown this to immediately understands it.
- **Sub-100ms webhook ingestion** — DynamoDB on-demand mode handles bursty CI/CD traffic without throttling while Streams process downstream in parallel.
- **120-second threat-to-mitigation pipeline** — from a rogue socket connection to frozen pipeline, isolated blast radius, and cryptographic proof.
- **Zero-migration agility** — we shipped 7 entity types, 3 settings schemas, and an onboarding state machine without a single ALTER TABLE.
- **Property-based testing for isolation** — formal verification that no sequence of operations can access another tenant's data.
- **Full working product** — auth, onboarding, 7 CI/CD integrations, subscription tiers, RBAC, and 8 metric dashboard sections. Not a prototype — a platform.

## What we learned

- **DynamoDB forces good design upfront.** You can't add a JOIN later. You can't SELECT * across tenants. This constraint is a feature — it makes security breaches structurally impossible rather than merely unlikely.
- **Single-table design pays off at scale** but requires discipline. The upfront cost of modeling access patterns is repaid every time you add a feature without a migration.
- **DynamoDB Streams + Lambda is the ideal event-driven architecture** for real-time metric computation. The coupling is loose, retries are built in, and scaling is automatic.
- **eBPF is production-ready for security monitoring** — kernel-level visibility without kernel module risk. The Rust ecosystem (libbpf-rs) makes this accessible.
- **Property-based testing reveals bugs unit tests never find.** Random input generation caught edge cases in our correlation window logic that hand-written tests missed entirely.

## What's next for OllinAI: Engineering Intelligence & Security

- **DynamoDB Global Tables activation** — multi-region active-active replication for enterprise data residency (EU, APAC)
- **DAX cluster deployment** — microsecond reads for high-traffic dashboards
- **Expanded ML models** — anomaly detection on deployment patterns, team velocity prediction, automated remediation suggestions
- **GitHub App marketplace listing** — one-click integration for GitHub Actions users
- **SOC2 Type II certification** — leveraging DynamoDB's built-in encryption, PITR, and audit trails
- **Open-source the eBPF agent** — community-driven detection rules for CI/CD supply chain threats
- **EventBridge Pipes integration** — simplified stream processing without custom Lambda glue code


## Built with

**Languages:** TypeScript, Rust, HCL (Terraform)

**Frameworks:** Next.js 14 (App Router), NextAuth.js, libbpf-rs, Tailwind CSS, shadcn/ui

**Platforms:** Vercel (frontend + serverless), AWS (backend + infrastructure)

**Cloud Services (AWS):**
- Amazon DynamoDB (single-table design, Streams, GSIs, TTL, DAX, Global Tables, PITR)
- AWS Lambda (risk scoring, DORA computation, incident correlation, ML inference)
- Amazon SQS (async event processing, dead-letter queues)
- Amazon EventBridge (event routing, scheduled rules)
- Amazon SageMaker (ML model training + inference)
- Amazon S3 (data residency, artifact storage)
- AWS IAM (cross-account roles, least-privilege policies)
- Amazon ECR (OCI artifact distribution for eBPF rules)

**Databases:** Amazon DynamoDB, DynamoDB DAX (caching layer)

**APIs:** REST webhooks (GitHub, GitLab, Bitbucket, Azure DevOps, CircleCI, Jenkins, ArgoCD), in-toto attestation framework

**Testing:** Vitest, fast-check (property-based testing), Playwright (E2E), proptest (Rust)

**Security:** eBPF kernel tracing, Ed25519 cryptographic signing, HMAC webhook verification, bcrypt password hashing, JWT session tokens

**Other:** Docker, Terraform, GitHub Actions (CI/CD), DynamoDB Streams event-driven architecture


## Try it out

- **Live Platform:** [https://ollin-ai.vercel.app](https://ollin-ai.vercel.app)
- **Source Code:** [https://github.com/mercadoalex/OllinAI-](https://github.com/mercadoalex/OllinAI-)
- **Blog / Write-up:** [https://alexmarket.medium.com](https://alexmarket.medium.com)
