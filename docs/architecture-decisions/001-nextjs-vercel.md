# ADR-001: Next.js on Vercel as Frontend and API Platform

**Status:** Accepted  
**Date:** 2026-06-03  
**Decision Makers:** OllinAI Engineering  

## Context

OllinAI is a B2B SaaS platform for Change Intelligence and Deployment Risk analysis. The platform requires:

- An interactive dashboard with real-time metrics (DORA, risk scores, deployment timelines)
- 20+ API endpoints for webhook ingestion, data export, and configuration
- Multi-tenant authentication and authorization
- Server-side rendering for fast initial loads and SEO on marketing pages
- Rapid iteration with a small team

We evaluated multiple frontend frameworks and hosting platforms before selecting our stack.

## Decision

We chose **Next.js** as our full-stack framework, deployed on **Vercel**, with AWS handling backend processing (Lambdas, DynamoDB, SQS, EventBridge, SageMaker).

## Alternatives Considered

### Frameworks

| Option | Evaluated For | Rejected Because |
|--------|--------------|-----------------|
| **React (Vite/CRA)** | Client-side SPA | No server-side rendering, requires separate backend for API routes, two deployments to manage |
| **Angular** | Enterprise SPA | Requires separate backend (Express/NestJS), heavier bundle size, steeper learning curve for new hires, RxJS complexity for our use case |
| **Django** | Full-stack Python | Rich interactive dashboards require a JS framework anyway (double stack), Django templating insufficient for real-time charts and timelines, deployment complexity (Gunicorn + Nginx) |
| **Remix** | Full-stack React | Less mature ecosystem, smaller community, fewer deployment targets |
| **SvelteKit** | Full-stack Svelte | Smaller talent pool, less enterprise adoption, fewer integrations |

### Hosting Platforms

| Option | Evaluated For | Rejected Because |
|--------|--------------|-----------------|
| **Cloudflare Pages + Workers** | Edge-first hosting | Incomplete Next.js support (RSC, ISR limitations), V8 isolates don't support full Node.js API (AWS SDK compatibility risk) |
| **AWS Amplify** | AWS-native hosting | Slower deployments, less polished DX, Next.js feature support lags behind Vercel |
| **Self-hosted (ECS/Fargate)** | Full control | Significant ops overhead (load balancers, auto-scaling, SSL, container orchestration) for a small team |
| **Supabase** | BaaS | Solves a different problem (database/auth layer), doesn't replace hosting; our architecture is committed to DynamoDB and AWS services |

## Arguments for Next.js

### 1. Unified Full-Stack Codebase

One TypeScript project houses the dashboard UI, all API routes, webhook endpoints, and shared type definitions. This eliminates:
- Cross-service type drift
- Separate deployment pipelines for frontend and backend
- Context switching between languages

Our Zod validation schemas are shared between API input validation and frontend form handling.

### 2. Server Components and Streaming

The dashboard renders DORA metrics and risk distributions server-side. Users see data immediately without loading spinners or client-side fetch waterfalls. Server components also reduce the JavaScript bundle shipped to the browser.

### 3. Incremental Static Regeneration (ISR)

Dashboard pages revalidate every 30 seconds — fresh data without rebuilding or hitting the database on every request. This gives us near-real-time metrics at minimal compute cost.

### 4. API Routes as First-Class Citizens

Next.js API routes handle:
- Webhook ingestion (deployments, incidents)
- REST API (v1 data export)
- Settings and configuration endpoints
- Collector API for agent telemetry
- Deployment gate decisions

Each route is a serverless function with independent scaling — a spike in webhook traffic doesn't affect dashboard rendering.

### 5. TypeScript End-to-End

Shared types between frontend and API routes catch contract mismatches at compile time. Our DynamoDB item types, API response types, and Zod schemas form a single type system across the entire application.

### 6. Ecosystem and Talent

React is the most widely adopted frontend library. Next.js is the most popular React framework. Hiring developers who can contribute from day one is significantly easier compared to Angular, Svelte, or Django + separate frontend.

## Arguments for Vercel

### 1. Zero-Configuration Deployment

`git push origin main` → production deployment in ~30 seconds. No CI/CD pipeline to maintain for the frontend layer, no container builds, no infrastructure to provision.

### 2. Native Next.js Optimization

Vercel built Next.js. Server components, ISR, middleware, image optimization, and edge functions work without configuration workarounds. Other platforms require adapters or have incomplete feature support.

### 3. Preview Deployments

Every pull request generates a unique URL. The team reviews UI changes visually before merging — critical for a dashboard-heavy product where layout regressions aren't caught by unit tests.

### 4. Edge Network and Performance

Static assets and ISR-cached pages are served from Vercel's global CDN. API routes execute in the region closest to our AWS backend (configured as `cle1` to minimize latency to `us-east-2` DynamoDB).

### 5. Built-in Infrastructure

- **Vercel KV (Redis):** Powers our rate limiting middleware (100 req/min per tenant) without provisioning ElastiCache.
- **Automatic SSL/TLS:** No certificate management.
- **DDoS protection:** Included at the platform level.
- **Security headers:** Configured in `vercel.json`, enforced globally.

### 6. Cost Efficiency at Our Stage

Compared to self-hosted (ECS + ALB + CloudFront):
- No idle compute costs
- No load balancer fees ($18/month minimum on AWS)
- No NAT gateway charges
- Pay only for actual usage

### 7. Separation of Concerns

Vercel handles what it's best at (serving web applications), while AWS handles what it's best at (event-driven backend processing). Neither platform is forced into a role it wasn't designed for.

## Architecture Alignment

```
┌─────────────────────────────────────────────────┐
│                    Vercel                         │
│                                                  │
│  Dashboard (SSR + ISR)    API Routes (Serverless)│
│  - DORA metrics           - Webhook ingestion    │
│  - Risk timelines         - Data export API      │
│  - Settings UI            - Gate decisions       │
│  - Team management        - Collector API        │
│                                                  │
│  Vercel KV (Rate Limiting)                       │
└──────────────────────┬──────────────────────────┘
                       │ AWS SDK calls
┌──────────────────────▼──────────────────────────┐
│                     AWS                          │
│                                                  │
│  DynamoDB (multi-tenant data)                    │
│  SQS (event queues + DLQs)                      │
│  EventBridge (event routing)                     │
│  Lambda (correlation, risk scoring, DORA, ML)    │
│  SageMaker (ML training + inference)             │
│  ECR (eBPF agent + rule bundles)                 │
└─────────────────────────────────────────────────┘
```

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Vercel pricing increases at scale | Medium | Next.js is portable; can migrate to self-hosted on ECS if needed |
| Function timeout limits (30s max) | Low | Heavy processing already runs in AWS Lambdas, not Vercel functions |
| Vercel outage affects dashboard | Low | Health endpoint monitoring + status page; backend processing continues independently |
| Vendor lock-in | Medium | Only Vercel-specific features used are KV (replaceable with ElastiCache) and deployment pipeline (replaceable with GitHub Actions + ECS) |

## Consequences

**Positive:**
- Ship features faster with less infrastructure management
- Single language (TypeScript) across the entire frontend + API layer
- Automatic scaling without capacity planning
- Preview deployments improve code review quality

**Negative:**
- Dependent on Vercel for frontend availability
- Function execution limits require backend processing to live in AWS Lambdas
- Team must stay within Next.js patterns (no arbitrary long-running server processes)

## Review Triggers

Re-evaluate this decision if:
- Monthly Vercel costs exceed $500/month (consider self-hosted)
- We need WebSocket connections for real-time dashboard updates (consider adding a dedicated WebSocket service)
- Next.js major version introduces breaking changes that affect our architecture
- A competitor platform offers significantly better Next.js support at lower cost
