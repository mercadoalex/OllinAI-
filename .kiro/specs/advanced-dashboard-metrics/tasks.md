# Implementation Plan: Advanced Dashboard Metrics

## Overview

This plan implements six new metric sections (Risk, Correlation, Team Performance, Service Health, Predictions & Prevention, Business Impact) for the OllinAI dashboard. The implementation follows a bottom-up approach: shared utilities first, then computation layer, then API routes, and finally UI components wired together with progressive loading. Each task builds incrementally on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Set up shared metric computation utilities
  - [x] 1.1 Create shared types and interfaces for the computation layer
    - Create `src/lib/metrics/computers/types.ts` with `MetricComputeContext`, `TrendIndicator`, `InsufficientDataResult` interfaces
    - Create `src/lib/metrics/utils/index.ts` barrel export
    - Define the `RISK_SCORE_NUMERIC` mapping and common constants
    - _Requirements: 1.2, 1.3, 7.2_

  - [x] 1.2 Implement trend indicator utility
    - Create `src/lib/metrics/utils/trend.ts` with `computeTrendIndicator(current, previous, lowerIsBetter)` function
    - Implement the 10% threshold rule: "improving" when change exceeds 10% in favorable direction, "degrading" for 10% unfavorable, "stable" otherwise
    - Handle edge cases: zero previous value, negative values, equal values
    - _Requirements: 2.5, 5.7, 6.4_

  - [ ]* 1.3 Write property test for trend indicator (Property 6)
    - **Property 6: Trend indicator follows 10% threshold rule**
    - **Validates: Requirements 2.5, 5.7, 6.4**
    - Test file: `src/lib/metrics/utils/__tests__/trend.property.test.ts`

  - [x] 1.4 Implement event filter utility
    - Create `src/lib/metrics/utils/filters.ts` with `applyEventFilters(events, context)` function
    - Filter by team, service, and time range (conjunction of all active filters)
    - _Requirements: 1.4, 8.7_

  - [ ]* 1.5 Write property test for filter application (Property 3)
    - **Property 3: Filter application produces correct subset**
    - **Validates: Requirements 1.4, 8.7**
    - Test file: `src/lib/metrics/utils/__tests__/filters.property.test.ts`

  - [x] 1.6 Implement risk score and time grouping utilities
    - Create `src/lib/metrics/utils/risk-score.ts` with `computeAverageRiskScore(events)` function and `RISK_SCORE_NUMERIC` map
    - Create `src/lib/metrics/utils/time-grouping.ts` with `groupEventsByDay(events, from, to)` function that returns all days in range (including zero-count days)
    - _Requirements: 1.2, 1.3_

- [x] 2. Implement Risk and Correlation metric computers
  - [x] 2.1 Implement Risk metrics computer
    - Create `src/lib/metrics/computers/risk.ts` with `computeRiskMetrics(context)` function
    - Compute: risk distribution counts, high/critical daily trend (all days in range), per-service averages (top 10 sorted descending)
    - Query `ollinai-events` via GSI-2 TeamView and service PK patterns
    - Handle insufficient data (< 3 events)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [ ]* 2.2 Write property tests for Risk computer (Properties 1, 2)
    - **Property 1: High/critical deploy trend groups correctly by day**
    - **Property 2: Average risk score per service is correctly computed and ranked**
    - **Validates: Requirements 1.2, 1.3**
    - Test file: `src/lib/metrics/computers/__tests__/risk.property.test.ts`

  - [x] 2.3 Implement Correlation metrics computer
    - Create `src/lib/metrics/computers/correlation.ts` with `computeCorrelationMetrics(context)` function
    - Compute: correlation rate (correlated / total × 100), average time-to-correlation, uncorrelated count
    - Query `ollinai-incidents` via GSI-1 TimeRange
    - Handle zero incidents case with informational note
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [ ]* 2.4 Write property tests for Correlation computer (Properties 4, 5)
    - **Property 4: Incident correlation rate computation**
    - **Property 5: Average time-to-correlation computation**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - Test file: `src/lib/metrics/computers/__tests__/correlation.property.test.ts`

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Team Performance and Service Health computers
  - [x] 4.1 Implement Team Performance computer
    - Create `src/lib/metrics/computers/team-performance.ts` with `computeTeamPerformance(context)` function
    - Compute: per-team CFR (events with correlatedIncident / total × 100), deployment frequency per team, risk profile per team (low/medium/high/critical counts)
    - Sort by CFR descending by default; support sortBy and sortOrder params
    - Handle insufficient data per team (< 3 events); include org averages when no team filter active
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 4.2 Write property tests for Team Performance computer (Properties 7, 8)
    - **Property 7: Per-team change failure rate sorted descending**
    - **Property 8: Per-team risk profile counts**
    - **Validates: Requirements 3.2, 3.4, 3.5**
    - Test file: `src/lib/metrics/computers/__tests__/team-performance.property.test.ts`

  - [x] 4.3 Implement Service Health computer
    - Create `src/lib/metrics/computers/service-health.ts` with `computeServiceHealth(context)` function
    - Compute: services at risk (high/critical in last 7 days), service-level DORA metrics table, blast radius per incident (distinct services from correlated deployments)
    - Query across `ollinai-events`, `ollinai-incidents`, `ollinai-metrics`
    - Compute average and maximum blast radius
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 4.4 Write property tests for Service Health computer (Properties 9, 10)
    - **Property 9: Services at risk identification**
    - **Property 10: Blast radius computation**
    - **Validates: Requirements 4.2, 4.3, 4.5, 4.6**
    - Test file: `src/lib/metrics/computers/__tests__/service-health.property.test.ts`

- [ ] 5. Implement Predictions and Business Impact computers
  - [~] 5.1 Implement Predictions computer
    - Create `src/lib/metrics/computers/predictions.ts` with `computePredictions(context)` function
    - Compute: prediction accuracy (predicted matches actual), blocked count (gateDecision "blocked"), warned count (gateDecision "warned"), false positive rate (above threshold with no incident), early warning count (earlyWarning = true)
    - Handle ML inactive case (no events with predictionScore)
    - Include trend indicators for accuracy and FPR
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 5.2 Write property tests for Predictions computer (Properties 11, 12, 13)
    - **Property 11: Prediction accuracy computation**
    - **Property 12: False positive rate computation**
    - **Property 13: Gate and warning event counts**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**
    - Test file: `src/lib/metrics/computers/__tests__/predictions.property.test.ts`

  - [~] 5.3 Implement Business Impact computer
    - Create `src/lib/metrics/computers/business-impact.ts` with `computeBusinessImpact(context)` function
    - Compute: estimated downtime avoided (blocked high/critical × avg MTTR), SLA compliance % (minutes without critical incident / total minutes × 100), incident trend indicator
    - Cap unresolved incidents at period end time for SLA calculation
    - Handle zero blocked deployments and zero critical incidents cases
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 5.4 Write property tests for Business Impact computer (Properties 14, 15)
    - **Property 14: Estimated downtime avoided computation**
    - **Property 15: SLA compliance percentage computation**
    - **Validates: Requirements 6.2, 6.3**
    - Test file: `src/lib/metrics/computers/__tests__/business-impact.property.test.ts`

- [~] 6. Checkpoint - Ensure all computation layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement API route handlers
  - [~] 7.1 Create shared API validation and response utilities
    - Create `src/app/api/metrics/shared.ts` with common request validation logic (time range parsing, 365-day max, from < to check)
    - Implement tenant ID extraction and common error response helpers
    - Define the feature-to-endpoint tier mapping constant
    - _Requirements: 7.2, 7.3, 7.4, 7.5_

  - [ ]* 7.2 Write property test for time range validation (Property 16)
    - **Property 16: Invalid time range validation**
    - **Validates: Requirements 7.5**
    - Test file: `src/app/api/metrics/__tests__/validation.property.test.ts`

  - [~] 7.3 Implement GET /api/metrics/risk route
    - Create `src/app/api/metrics/risk/route.ts` following the existing DORA route pattern
    - Apply `withAuthorization` + `withTierGate("risk_score")` middleware
    - Parse query params (from, to, team, service), validate, call `computeRiskMetrics`
    - Return `RiskMetricsResponse` shape with tier gating (Pro+)
    - _Requirements: 7.1, 9.2, 9.6_

  - [~] 7.4 Implement GET /api/metrics/correlation route
    - Create `src/app/api/metrics/correlation/route.ts`
    - Apply `withAuthorization` + `withTierGate("incident_correlation")` middleware
    - Call `computeCorrelationMetrics`, return `CorrelationMetricsResponse`
    - _Requirements: 7.1, 9.2, 9.6_

  - [~] 7.5 Implement GET /api/metrics/team-performance route
    - Create `src/app/api/metrics/team-performance/route.ts`
    - Apply `withAuthorization` + `withTierGate("risk_score")` middleware
    - Accept optional sortBy and sortOrder query params
    - Call `computeTeamPerformance`, return `TeamPerformanceResponse`
    - _Requirements: 7.1, 9.2, 9.6_

  - [~] 7.6 Implement GET /api/metrics/service-health route
    - Create `src/app/api/metrics/service-health/route.ts`
    - Apply `withAuthorization` + `withTierGate("risk_score")` middleware
    - Call `computeServiceHealth`, return `ServiceHealthResponse`
    - _Requirements: 7.1, 9.2, 9.6_

  - [~] 7.7 Implement GET /api/metrics/predictions route
    - Create `src/app/api/metrics/predictions/route.ts`
    - Apply `withAuthorization` + `withTierGate("aiops_predictions")` middleware (Enterprise only)
    - Call `computePredictions`, return `PredictionsMetricsResponse`
    - _Requirements: 7.1, 9.3, 9.6_

  - [~] 7.8 Implement GET /api/metrics/business-impact route
    - Create `src/app/api/metrics/business-impact/route.ts`
    - Apply `withAuthorization` + `withTierGate("aiops_predictions")` middleware (Enterprise only)
    - Call `computeBusinessImpact`, return `BusinessImpactResponse`
    - _Requirements: 7.1, 9.3, 9.6_

  - [ ]* 7.9 Write property test for tier-based access control (Property 17)
    - **Property 17: Tier-based access control enforcement**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.6**
    - Test file: `src/lib/middleware/__tests__/tier-access.property.test.ts`

- [~] 8. Checkpoint - Ensure API routes work with computation layer
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement dashboard UI components
  - [~] 9.1 Create MetricSection wrapper component with progressive loading
    - Create `src/app/dashboard/components/metric-section.tsx`
    - Implement loading skeleton, error boundary, and data fetching with SWR or fetch + useEffect
    - Accept `apiEndpoint`, `tierRequired`, `currentTier`, `timeRange`, `filters` props
    - Display locked state when tier is insufficient with upgrade CTA
    - _Requirements: 8.5, 9.4, 9.5_

  - [~] 9.2 Create section navigation bar component
    - Create `src/app/dashboard/components/section-nav-bar.tsx`
    - Render horizontal nav with section labels; highlight active section
    - On click, smooth-scroll to the target section
    - Collapse to dropdown on viewport < 768px
    - Show only sections available for the current tier
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [~] 9.3 Create individual metric section display components
    - Create `src/app/dashboard/components/risk-metrics-section.tsx` — histogram, line chart placeholder, bar chart placeholder
    - Create `src/app/dashboard/components/correlation-metrics-section.tsx` — 3 metric cards with trends
    - Create `src/app/dashboard/components/team-performance-section.tsx` — bar charts with sort control
    - Create `src/app/dashboard/components/service-health-section.tsx` — at-risk list, DORA table, blast radius
    - Create `src/app/dashboard/components/predictions-section.tsx` — 4 metric cards, ML inactive state
    - Create `src/app/dashboard/components/business-impact-section.tsx` — 3 metric cards with notes
    - Each section uses the MetricSection wrapper for fetching and tier gating
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1_

  - [~] 9.4 Create LockedSection component for tier-restricted content
    - Create `src/app/dashboard/components/locked-section.tsx`
    - Display section name, required tier badge, and upgrade call-to-action button
    - _Requirements: 9.4_

  - [ ]* 9.5 Write unit tests for dashboard UI components
    - Test MetricSection loading, error, and data states
    - Test LockedSection renders correct tier information
    - Test SectionNavBar section visibility based on tier
    - Test responsive layout behavior
    - _Requirements: 8.2, 8.6, 9.4_

- [ ] 10. Wire everything together in the dashboard page
  - [~] 10.1 Update DashboardClient to integrate new metric sections
    - Modify `src/app/dashboard/components/dashboard-client.tsx` to include the section nav bar and all new metric sections
    - Pass current tier, time range, and filters to each section
    - Implement progressive loading: DORA + Risk SSR, rest client-side
    - Maintain 30-second polling for visible sections
    - _Requirements: 8.1, 8.5, 8.7, 1.6_

  - [~] 10.2 Update dashboard page server component for tier and risk SSR
    - Modify `src/app/dashboard/page.tsx` to fetch tenant tier on server
    - Pass tier info to DashboardClient for immediate section visibility decisions
    - Ensure Risk Metrics section data is fetched server-side alongside DORA for ISR
    - _Requirements: 8.5, 9.1, 9.2, 9.3_

  - [ ]* 10.3 Write integration tests for dashboard progressive loading
    - Test that DORA + Risk render on initial load (SSR)
    - Test that remaining sections fetch client-side after hydration
    - Test that tier-restricted sections show locked state for lower tiers
    - Test 30-second polling updates visible sections
    - _Requirements: 8.4, 8.5, 9.1, 9.2, 9.3_

- [~] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The computation layer is pure functions (events → metrics) making property testing straightforward
- All API routes follow the established `/api/metrics/dora` pattern with `withAuthorization` + `withTierGate`
- UI components use Tailwind CSS consistent with the existing dashboard styling
- Progressive loading preserves fast LCP by SSR-rendering DORA + Risk first

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6"] },
    { "id": 2, "tasks": ["1.3", "1.5", "2.1", "2.3"] },
    { "id": 3, "tasks": ["2.2", "2.4", "4.1", "4.3"] },
    { "id": 4, "tasks": ["4.2", "4.4", "5.1", "5.3"] },
    { "id": 5, "tasks": ["5.2", "5.4", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 7, "tasks": ["7.9", "9.1", "9.2", "9.4"] },
    { "id": 8, "tasks": ["9.3", "9.5"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3"] }
  ]
}
```
