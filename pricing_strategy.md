# OllinAI — Pricing Strategy (Draft)

> This document captures initial pricing thinking. To be revisited before launch.

## Subscription Tiers

| Feature | Starter ($299/mo) | Pro ($799/mo) | Enterprise ($2,499/mo) |
|---------|:-:|:-:|:-:|
| DORA Metrics | ✅ | ✅ | ✅ |
| Services | Max 5 | Unlimited | Unlimited |
| Retention | 30 days | 90 days | Unlimited |
| Risk Scoring | — | ✅ | ✅ |
| Incident Correlation | — | ✅ | ✅ |
| Recommendations | — | ✅ | ✅ |
| AIOps Predictions | — | ✅ | ✅ |
| SSO | — | — | ✅ |
| Audit Logs | — | — | ✅ |
| REST API Export | — | — | ✅ |
| Data Residency | — | — | ✅ |
| Build Attestation | — | — | ✅ |
| Custom Integrations | — | — | ✅ |

## Target Market

Mid-market engineering organizations (50–500 engineers) who need data-driven insights into their deployment practices.

**Key buyers:** Engineering Managers, Platform Team Leads, VPs of Engineering.

## Competitive Landscape

Positioned against:
- **Sleuth** — DORA metrics focused, limited risk scoring
- **LinearB** — Developer productivity, less CI/CD security focus
- **Faros AI** — Engineering intelligence, no eBPF runtime layer
- **Cortex** — Service catalog, not deployment-risk focused

## Pricing Rationale

- **Starter** — Low barrier entry for teams wanting DORA visibility. Enough to prove value and create upgrade pressure (5-service limit).
- **Pro** — Core value proposition unlocked: risk scoring + correlation + ML predictions. Where most mid-market teams land.
- **Enterprise** — Full platform with compliance features (audit, SSO, data residency) that larger orgs require for procurement approval.

## Open Questions

- [ ] Should there be a free tier or free trial period?
- [ ] Usage-based pricing component (per deployment event)?
- [ ] Annual discount structure?
- [ ] Self-serve vs sales-assisted for Enterprise?
- [ ] eBPF agent pricing — included in Pro or Enterprise-only?
- [ ] Per-seat vs per-team vs flat pricing?
