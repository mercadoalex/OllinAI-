# OllinAI — Competitive Positioning

## One-Line Positioning

> "Vercel tells you a deploy happened. OllinAI tells you if it'll break production — before you ship."

## The Problem We Solve

Engineering teams deploy 10-50 times per day across dozens of services. Each deployment is a gamble — will it cause an incident? Traditional monitoring tells you *after* something breaks. By then, users are affected, SLAs are breached, and your on-call team is firefighting.

OllinAI shifts risk assessment left — before the deployment reaches production.

## Where Existing Tools Fall Short

### Deployment Platforms (Vercel, Netlify, Railway)

These platforms **execute** deployments. They can tell you:
- When a deploy happened
- If the build succeeded
- Basic performance metrics post-deploy

They cannot tell you:
- Whether this deploy is likely to cause an incident
- Which previous deploy caused the current PagerDuty alert
- Why your team's change failure rate doubled this quarter
- That a suspicious package is exfiltrating credentials during build

### Monitoring Tools (Datadog, New Relic, Grafana)

These tools **observe** production. They can tell you:
- Something is broken right now
- Which metric is abnormal
- Historical trends in system health

They cannot tell you:
- Which specific deployment caused the anomaly
- Whether the next deploy will make things worse
- That your deployment pattern (Friday evening, large batch, risky author) predicts failure
- What to do about it automatically

### CI/CD Pipelines (GitHub Actions, GitLab CI, Jenkins)

These tools **automate** build and deploy. They can tell you:
- Tests passed/failed
- Build is green
- Deploy succeeded mechanically

They cannot tell you:
- The historical risk profile of changes like this one
- That deployments by this author to this service fail 40% of the time
- That your build process is being compromised by a malicious dependency

## OllinAI's Unique Value

### 1. Predictive Risk Scoring (Pre-Deployment)

Every deployment gets a risk score **before** it ships, computed from:
- Change failure rate for this service (35% weight)
- Change size — lines, files, blast radius (25% weight)
- Deployment timing — Friday 11pm is riskier than Tuesday 2pm (20% weight)
- Author failure rate — historical track record (20% weight)

Result: a clear signal — proceed, warn, or block.

No other tool computes deployment risk proactively from historical patterns.

### 2. Incident-Deployment Correlation

When an incident fires, OllinAI automatically answers: "Which deployment caused this?"

- Ingests deployments from any CI/CD (GitHub, GitLab, Jenkins, ArgoCD)
- Ingests incidents from any monitoring tool (PagerDuty, Datadog, OpsGenie)
- Correlates within a configurable time window
- Ranks causal candidates by temporal proximity

This cross-platform correlation is unique. Vercel can't correlate a PagerDuty alert with a GitLab deploy. Datadog can't attribute an anomaly to a specific commit.

### 3. ML-Powered Incident Prediction

After 100+ deployments and 10+ incidents, OllinAI trains a model specific to your organization:

- Predicts incident probability per deployment (0-1.0 score)
- Detects anomalies via 3σ deviation from model prediction intervals
- Performs root cause analysis — ranks top 3 causal deployments with confidence scores
- Improves continuously: retrains daily, detects model drift, falls back to rules when insufficient data

### 4. Supply Chain Security (eBPF Agent)

Lightweight agent observes CI/CD pipelines at the kernel level:

- Detects credential file access from package installation processes
- Flags network connections to domains not in the baseline
- Generates signed build attestations (in-toto compatible)
- Catches compromised dependencies before they exfiltrate secrets

No deployment platform or monitoring tool has visibility inside your build pipeline.

### 5. Automated Remediation

When prediction confidence is high enough:
- Auto-rollback on critical predictions (>0.9 score, >0.85 confidence)
- Halt canary deployments on early warning signals
- Scale up infrastructure preemptively
- Notify on-call with full context (not just "something broke")

Operator override always available. Actions logged for audit.

### 6. Team-Level DORA Metrics

Not just "how's the org doing" — but which specific team, service, and environment is degrading:

- Deployment Frequency, Lead Time, Change Failure Rate, MTTR — per team, per service
- Trend detection: 20pp CFR increase triggers proactive recommendations
- Actionable suggestions: "reduce change size", "adjust timing", "increase review"
- Historical attribution: who owned this service when it broke?

### 7. Enterprise Data Residency

For regulated industries:
- Raw telemetry stays in the customer's AWS account
- Only derived metrics (risk scores, predictions) leave their environment
- Cross-account processing via IAM role assumption
- Full audit trail with 365-day retention

## Competitive Landscape

| Capability | OllinAI | Vercel | Datadog | LinearB | Sleuth | Faros AI |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Pre-deploy risk scoring | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ |
| Incident-deployment correlation | ✅ | ❌ | ⚠️ | ❌ | ✅ | ⚠️ |
| ML incident prediction | ✅ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| DORA metrics (team-level) | ✅ | ❌ | ⚠️ | ✅ | ✅ | ✅ |
| Deployment gating | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Supply chain security (eBPF) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Automated remediation | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ |
| Custom rule engine | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Data residency | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Multi-CI/CD support | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |

⚠️ = partial/limited support

## Who OllinAI Is For

**Primary:** Platform engineering teams at companies with 5-50+ services, deploying multiple times daily, who need to reduce change failure rates without slowing down delivery.

**Signals they're ready for OllinAI:**
- "We had 3 incidents last month caused by deployments we could have caught"
- "We don't know which deploy broke production until 30 minutes into the incident"
- "Our DORA metrics are getting worse and we can't pinpoint why"
- "We want to deploy faster but leadership is risk-averse after recent outages"
- "We have no visibility into what happens inside our CI pipelines"

## What We Learn From Competitors

| From | Lesson |
|------|--------|
| **Vercel** | Developer experience is king. Zero-config defaults, fast UI, git-centric flow. |
| **Datadog** | Integrations win markets. Support every tool in the ecosystem. |
| **LinearB** | Team-level engineering metrics resonate with engineering leaders. |
| **Sleuth** | Deploy tracking + change failure rate is table stakes. Go beyond it. |
| **LaunchDarkly** | Feature flags prove that pre-production risk controls have demand. |

## Key Messaging

**For engineering leaders:**
"Reduce your change failure rate by 40% without slowing deployments. Know which deploys are risky before they ship."

**For platform teams:**
"One integration point for all your CI/CD and monitoring tools. Automatic correlation, risk scoring, and DORA metrics across every service and team."

**For security teams:**
"Kernel-level visibility into CI/CD pipelines. Detect supply chain attacks during build time, not after production compromise."
