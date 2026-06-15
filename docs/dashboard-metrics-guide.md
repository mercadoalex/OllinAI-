# Dashboard Metrics Guide — OllinAI

## Overview

The OllinAI dashboard provides a comprehensive view of deployment health across 8 metric sections. Metrics are computed in real-time from deployment events, incidents, and pre-aggregated DORA data stored in DynamoDB. The dashboard uses progressive loading (DORA + Risk render server-side, remaining sections load client-side) with 30-second automatic polling.

---

## Metric Sections

### 1. DORA Metrics (All Tiers)

The four DORA metrics are the industry standard for measuring engineering delivery performance:

| Metric | What It Measures | Good Direction |
|--------|-----------------|----------------|
| **Deployment Frequency** | How often your team deploys to production | Higher is better |
| **Lead Time for Changes** | Time from commit to production deployment | Lower is better |
| **Change Failure Rate** | % of deployments that cause incidents | Lower is better |
| **MTTR** | Mean time to recover from failures | Lower is better |

**Trend indicators:**
- 🟢 ↑ Improving (>10% favorable change vs. previous period)
- 🔴 ↓ Degrading (>10% unfavorable change)
- ⚪ — Stable (within 10% of previous period)

**Minimum data:** 3 deployment events required for display.

---

### 2. Risk Score Distribution (All Tiers)

Shows how your deployments are distributed across risk levels:

| Level | Score Range | Color | Meaning |
|-------|------------|-------|---------|
| Low | 0 – 0.3 | 🟢 Green | Safe to deploy |
| Medium | 0.3 – 0.55 | 🟡 Amber | Proceed with awareness |
| High | 0.55 – 0.8 | 🟠 Orange | Review before deploying |
| Critical | 0.8 – 1.0 | 🔴 Red | Block or require manual approval |

---

### 3. Risk Metrics (Pro+)

Deeper risk analysis beyond the distribution histogram:

- **High/Critical Trend:** Daily count of high/critical deployments over the selected time range. Shows whether your deployments are getting riskier over time.
- **Average Risk by Service:** Top 10 services ranked by their average risk score. Helps identify which services need stability investment.

**Risk score factors:**
- Change Failure Rate (35% weight) — historical failure rate for this service
- Change Size (25%) — lines changed, files modified
- Deployment Timing (20%) — time of day, day of week risk
- Author Failure Rate (20%) — deployer's historical track record

---

### 4. Correlation Metrics (Pro+)

Shows how effectively OllinAI links incidents to their root cause deployments:

| Metric | What It Means |
|--------|--------------|
| **Correlation Rate** | % of incidents successfully linked to a deployment |
| **Avg Time to Correlation** | How fast (seconds) the system identifies root cause |
| **Uncorrelated Incidents** | Incidents where no matching deployment was found |

A high correlation rate (>80%) means the system effectively identifies which deployment caused each incident. A high uncorrelated count may indicate the correlation window needs tuning (Settings → Correlation Window).

---

### 5. Team Performance (Pro+)

Compare engineering teams side-by-side:

- **Change Failure Rate per Team** — Which teams have the highest incident-causing deployment rate?
- **Deployment Frequency per Team** — Which teams ship fastest?
- **Risk Profile per Team** — Distribution of risk scores per team (colored dots)

Teams are sorted by CFR descending by default (worst performers first) to help identify teams needing support. Organization-wide averages are shown for comparison.

**Insufficient data:** Teams with fewer than 3 deployments in the selected period show "insufficient data" rather than misleading metrics.

---

### 6. Service Health (Pro+)

Identify services that need attention:

- **Services at Risk:** Count and list of services with high/critical deployments in the last 7 days. Each shows the count and most recent risk level.
- **Service-Level DORA:** Per-service deployment frequency, lead time, CFR, and MTTR in a sortable table.
- **Blast Radius:** Average and maximum number of services affected per incident. High blast radius indicates tight coupling between services.

---

### 7. Predictions & Prevention (Enterprise)

ML-powered insights and deployment gate effectiveness:

| Metric | What It Means |
|--------|--------------|
| **Prediction Accuracy** | % of times the ML model correctly predicted the outcome |
| **Deployments Blocked** | Count of deployments prevented by the gate (score > 0.8) |
| **Deployments Warned** | Count of deployments that received a warning (score 0.5–0.8) |
| **False Positive Rate** | % of blocked/warned deployments that didn't actually cause incidents |
| **Early Warnings** | Count of proactive alerts issued before incidents materialized |

**ML Inactive:** When the model doesn't have enough training data (< 100 events or < 10 incidents), the section shows "ML Model Inactive" and falls back to rule-based scoring.

---

### 8. Business Impact (Enterprise)

Quantifies the value OllinAI provides to the organization:

| Metric | How It's Computed |
|--------|------------------|
| **Estimated Downtime Avoided** | (Blocked high/critical deploys) × (Average MTTR) = hours saved |
| **SLA Compliance** | % of time with no active critical incidents in the period |
| **Incident Trend** | Are incidents increasing or decreasing vs. previous period? |

---

## Subscription Tier Access

| Section | Starter | Pro | Enterprise |
|---------|:-------:|:---:|:----------:|
| DORA Metrics | ✅ | ✅ | ✅ |
| Risk Distribution | ✅ | ✅ | ✅ |
| Risk Metrics | 🔒 | ✅ | ✅ |
| Correlation Metrics | 🔒 | ✅ | ✅ |
| Team Performance | 🔒 | ✅ | ✅ |
| Service Health | 🔒 | ✅ | ✅ |
| Predictions & Prevention | 🔒 | 🔒 | ✅ |
| Business Impact | 🔒 | 🔒 | ✅ |

Locked sections show a clear upgrade CTA directing users to Settings → Billing.

---

## API Endpoints

All metrics are available via REST API for custom integrations and reporting:

| Endpoint | Tier | Description |
|----------|------|-------------|
| `GET /api/metrics/dora` | All | DORA metrics for scope/period |
| `GET /api/metrics/risk` | Pro+ | Risk distribution, trend, per-service averages |
| `GET /api/metrics/correlation` | Pro+ | Correlation rate, time-to-correlation, uncorrelated count |
| `GET /api/metrics/team-performance` | Pro+ | Per-team CFR, frequency, risk profiles |
| `GET /api/metrics/service-health` | Pro+ | Services at risk, blast radius, service DORA |
| `GET /api/metrics/predictions` | Enterprise | Prediction accuracy, gate decisions, FPR |
| `GET /api/metrics/business-impact` | Enterprise | Downtime avoided, SLA, incident trend |

**Common query parameters:**
- `from` — Start of time range (ISO 8601, default: 30 days ago)
- `to` — End of time range (ISO 8601, default: now)
- `team` — Filter by team ID (optional)
- `service` — Filter by service ID (optional)

**Validation rules:**
- `from` must be before `to`
- Maximum range: 365 days
- Invalid parameters return HTTP 400 with descriptive error

---

## How Data Flows

```
CI/CD Pipeline Push
       ↓
POST /api/webhooks/deployments (HMAC-signed)
       ↓
DynamoDB: ollinai-events (stored with risk score)
       ↓
SQS → Risk Scorer Lambda → EventBridge → DORA Computer Lambda
       ↓                                        ↓
ollinai-events (risk updated)           ollinai-metrics (DORA updated)
       ↓
Dashboard fetches via API endpoints every 30 seconds
```

---

## Time Range and Filters

- **Time range selector:** 7, 14, 30, 60, 90 days (constrained by retention period)
- **Team filter:** Filter all sections to a specific team's data
- **Service filter:** Filter to a specific service's data

All filters apply consistently across all sections. Changing the time range triggers a re-fetch of all visible sections.

---

## Interpreting Trends

The dashboard uses a **10% threshold** rule for trend indicators:

1. Compare current period value to the previous period of equal length
2. Compute percentage change: `((current - previous) / |previous|) × 100`
3. If change exceeds 10% in the favorable direction → **Improving** (green ↑)
4. If change exceeds 10% in the unfavorable direction → **Degrading** (red ↓)
5. If change is within 10% → **Stable** (gray —)

Example: If your CFR was 20% last period and 15% this period, that's a 25% decrease (favorable since lower is better) → **Improving**.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Insufficient data" | Fewer than 3 events in time range | Send more deployment webhooks or expand time range |
| "ML Model Inactive" | < 100 events or < 10 incidents | Accumulate more deployment history |
| Metrics show 0 | No events match filters | Remove team/service filters or check webhook configuration |
| Section shows error | DynamoDB connectivity issue | Check AWS credentials in Vercel env vars |
| Locked section | Tier insufficient | Upgrade subscription (Settings → Billing) |
