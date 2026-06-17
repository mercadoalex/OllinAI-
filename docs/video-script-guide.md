# Video Script Guide — OllinAI Demo

## Dashboard Overview (Main Screen)

When you open the dashboard, you see the full picture of your engineering team's deployment health at a glance.

### DORA Metrics (Top Section)

These are the 4 industry-standard metrics that Google's DORA research identified as predictors of high-performing engineering teams:

| Tile | What to Say | What Judges Should Notice |
|------|-------------|--------------------------|
| **Deployment Frequency** | "How often our team ships to production — 1.0 deploys per day" | Higher = better. Elite teams deploy multiple times per day. |
| **Lead Time** | "Average time from commit to production — 4.2 hours" | Lower = better. Shows how fast value reaches users. |
| **Change Failure Rate** | "15.3% of our deployments caused incidents — we're working to bring this down" | Lower = better. Elite teams are below 15%. |
| **MTTR** | "When something breaks, we recover in 2.1 hours on average" | Lower = better. Elite teams recover in under 1 hour. |

**Talking point:** "These metrics update in real-time as deployments flow through our webhook pipeline. The trend arrows show we're improving compared to the previous 30-day period."

### Risk Score Distribution (Below DORA)

Shows a histogram of your deployments by risk level.

**Talking point:** "Every deployment gets scored before it reaches production. Most of ours are low risk (green), but we can see some high and critical ones — those are the deployments we want to catch proactively."

### Advanced Metric Sections (Progressive Loading)

| Section | What to Say |
|---------|-------------|
| **Risk Metrics** | "We can drill into risk trends — see which days had the most risky deploys, and which services carry the highest average risk." |
| **Correlation Metrics** | "OllinAI automatically correlates 60% of our incidents to the deployment that caused them — no manual investigation needed." |
| **Team Performance** | "We compare teams side by side — Platform Engineering has a 15% failure rate while DevOps is at 8%." |
| **Service Health** | "2 services are currently at risk — api-gateway had 3 high-risk deploys this week." |
| **Predictions** | "Our ML model has 78% accuracy predicting which deployments will cause incidents. We've blocked 5 deployments this month." |
| **Business Impact** | "We estimate 12 hours of downtime avoided this month. SLA compliance is at 99.2%." |

---

## Deployments Page

**What it shows:** The full history of every deployment event ingested from your CI/CD pipelines.

**Key features to highlight:**
- Color-coded timeline — each deployment is a dot colored by risk level (green/amber/orange/red)
- Filterable by service, team, environment, and risk level
- Each deployment shows: commit SHA, author, timestamp, risk score breakdown
- Risk factors visible: change failure rate contribution (35%), change size (25%), timing (20%), author track record (20%)
- Correlated incidents linked directly to the deployment

**Talking point:** "This is the deployment that caused last Thursday's outage — OllinAI correlated it automatically within 30 seconds. You can see the risk score was 0.82 (critical) — we should have blocked it."

---

## Incidents Page

**What it shows:** All production incidents ingested from monitoring tools, with their correlation status.

**Key features to highlight:**
- Severity levels (low/medium/high/critical) with colored indicators
- Correlation status: which incidents are linked to a deployment vs. uncorrelated
- Duration tracking: detection time → resolution time
- Expandable details showing which deployment caused it and when the correlation was made

**Talking point:** "When PagerDuty fires an alert, OllinAI immediately searches for deployments within our 60-minute correlation window. 3 out of 5 incidents this month were automatically linked to the causing deployment."

---

## Services Page

**What it shows:** Your service registry with health indicators and ownership.

**Key features to highlight:**
- Health status per service (green/amber/red based on recent risk scores)
- Owning team visible for each service
- Mini DORA metrics per service — deploy frequency and change failure rate
- "Services at Risk" highlight — services with recent high/critical deployments
- Last deployment timestamp and risk level

**Talking point:** "api-gateway is our riskiest service right now — 3 high-risk deploys this week. The service ownership model means Platform Engineering is responsible and can see their specific DORA metrics."

---

## Teams Page

**What it shows:** Team-level performance comparison and member management.

**Key features to highlight:**
- Side-by-side team comparison on change failure rate
- Deployment frequency by team — who ships fastest
- Risk profile distribution per team (colored dots showing risk spread)
- Team health indicator (green/amber/red)
- Member list with contribution metrics

**Talking point:** "Our VP of Engineering uses this view to identify teams needing support. Backend Team's failure rate doubled this quarter — time to invest in their testing infrastructure."

---

## Predictions Page

**What it shows:** ML-powered deployment risk predictions and automated gate decisions.

**Key features to highlight:**
- Model status indicator (Active v1.3.2 or Fallback: Rule Engine)
- Prediction accuracy percentage with trend
- Deployments blocked/warned by the gate
- False positive rate — how often we block unnecessarily
- Early warnings issued before incidents materialize

**Talking point:** "The ML model trains on our deployment history and gets better over time. Today it's 78% accurate. When it predicts > 80% incident probability, the deployment gate blocks automatically — no human intervention needed."

---

## Key Demo Flow (Suggested Order)

1. **Landing page** → "This is OllinAI — deployment risk intelligence"
2. **Sign up** → "Let me create an account" (auto-seeds demo data)
3. **Dashboard** → "Immediately I see DORA metrics, risk distribution, and all advanced sections"
4. **Scroll through sections** → "Risk trends, correlation rate, team comparison, predictions"
5. **Deployments page** → "Here's every deployment with risk scores"
6. **Incidents page** → "And here are incidents, automatically correlated"
7. **Settings → Integrations** → "Adding a new CI/CD integration takes 30 seconds"
8. **Docs page** → "Full documentation for self-service onboarding"

---

## Key Talking Points for Judges

**On DynamoDB:**
"Every query you see here maps directly to a DynamoDB access pattern. The partition key design makes cross-tenant data access physically impossible — it's not just a security layer, it's how the database fundamentally works."

**On Architecture:**
"The dashboard renders server-side with ISR caching, polls every 30 seconds client-side, and progressively loads advanced sections to keep initial paint fast."

**On Real-World Impact:**
"This isn't a toy — it's a working product with auth, onboarding, 7 CI/CD integrations, subscription tiers, and 8 metric sections. A platform team could use it today."

**On Originality:**
"Our insight is that DynamoDB's partition key model IS the security model. We didn't bolt security onto a database — we chose a database whose architecture enforces our most critical requirement structurally."
