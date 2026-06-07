# Implementation Plan: User Onboarding Flow

## Overview

This plan implements a multi-step guided onboarding experience for new OllinAI tenants. The implementation proceeds bottom-up: data layer and validation utilities first, then API routes, middleware enhancement, and finally the UI components. Each step produces integrated, working code.

## Tasks

- [x] 1. Implement onboarding state service and validation utilities
  - [x] 1.1 Create the onboarding state service (`src/lib/onboarding/state.ts`)
    - Define `OnboardingState`, `StepState`, and `OnboardingStepName` TypeScript interfaces
    - Implement `initializeOnboardingState(tenantId)` with retry logic (3 attempts, exponential backoff 200ms/400ms/800ms)
    - Implement `getOnboardingState(tenantId)` to read from `ollinai-config` table with PK=`TENANT#{tenantId}`, SK=`ONBOARDING#state`
    - Implement `completeStep(tenantId, step)` with DynamoDB conditional write to prevent overwriting already-completed steps
    - Implement `skipOnboarding(tenantId)` to set status to `'skipped'` and record `skippedAt` timestamp
    - Implement `resumeOnboarding(tenantId)` to set status back to `'in_progress'`
    - Implement `dismissBanner(tenantId)` to set `bannerDismissed = true`
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 7.2, 7.4_

  - [ ]* 1.2 Write property test: Onboarding state initialization invariant
    - **Property 1: Onboarding state initialization invariant**
    - Generate random valid tenant IDs, call `initializeOnboardingState`, verify all three steps have `completed = false` and no `completedAt`, with `status = 'in_progress'`
    - **Validates: Requirements 1.1**

  - [x] 1.3 Create the onboarding routing logic (`src/lib/onboarding/routing.ts`)
    - Define `STEP_SEQUENCE` constant array: `['integration_created', 'pipeline_configured', 'first_event_received']`
    - Implement `determineRoute(state)` returning `RoutingDecision` (onboarding step, dashboard, or dashboard_with_banner)
    - Implement `canNavigateToStep(state, targetStep)` enforcing prerequisite completion
    - Implement `getFirstIncompleteStep(state)` returning the first step in sequence with `completed = false`
    - _Requirements: 1.3, 1.4, 6.3, 7.3_

  - [ ]* 1.4 Write property test: Routing decision correctness
    - **Property 3: Routing decision correctness**
    - Generate random `OnboardingState` objects covering all step completion combinations and status values, verify routing decision matches the specification
    - **Validates: Requirements 1.3, 1.4, 7.3**

  - [x] 1.5 Create the integration name validator (`src/lib/onboarding/validation.ts`)
    - Implement `validateIntegrationName(name)` that accepts strings of 1-100 characters matching `[a-zA-Z0-9_-]`
    - Return `{ valid: boolean; error?: string }` with specific error messages for empty, too long, or invalid characters
    - _Requirements: 2.2, 2.6_

  - [ ]* 1.6 Write property test: Integration name validation
    - **Property 4: Integration name validation**
    - Generate random strings (valid and invalid), verify acceptance/rejection matches the regex pattern `^[a-zA-Z0-9_-]{1,100}$`
    - **Validates: Requirements 2.2, 2.6**

  - [ ]* 1.7 Write property test: Navigation guard enforcement
    - **Property 7: Navigation guard enforcement**
    - Generate random `OnboardingState` objects and target steps, verify `canNavigateToStep` permits navigation only when all preceding steps are complete
    - **Validates: Requirements 6.3**

- [x] 2. Implement code snippet generator and test event builder
  - [x] 2.1 Create the code snippet generator (`src/lib/onboarding/snippets.ts`)
    - Define `SnippetContext` and `GeneratedSnippet` interfaces
    - Implement `generateSnippet(context)` that reads existing templates from `integrations/github-actions/` and `integrations/gitlab-ci/`
    - For `github_actions`: generate YAML workflow snippet with `webhookUrl` and `secretKeyVarName` placeholder
    - For `gitlab_ci`: generate `.gitlab-ci.yml` snippet with `webhookUrl` and `secretKeyVarName` placeholder
    - For `custom`: generate cURL example with `webhookUrl`, headers, and sample JSON payload showing all required `DeploymentEvent` fields
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 2.2 Write property test: Code snippet generation contains required fields
    - **Property 5: Code snippet generation contains required fields**
    - Generate random valid `SnippetContext` objects, verify output contains `webhookUrl` and `secretKeyVarName` verbatim; for `custom` type, verify all DeploymentEvent fields appear
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 2.3 Create the test event builder (`src/lib/onboarding/test-event.ts`)
    - Implement `buildTestEventPayload()` returning a valid `DeploymentEventPayload` with placeholder values (test commit SHA, service name, environment, author)
    - Implement `signPayload(payload, secretKey)` using HMAC-SHA256 (reuse `@/lib/webhooks/hmac`)
    - Implement `sendTestEvent(tenantId, integrationId)` that constructs the payload, signs it, and sends it to the webhook endpoint, returning `TestEventResult`
    - _Requirements: 4.1, 4.2_

  - [ ]* 2.4 Write property test: Test event payload validity and signature verification
    - **Property 6: Test event payload validity and signature verification**
    - Generate random integration data (tenantId, integrationId, secretKey), build test event, verify payload passes `DeploymentEventSchema` validation and HMAC signature round-trips correctly
    - **Validates: Requirements 4.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement onboarding API routes
  - [x] 4.1 Create `GET /api/onboarding/state` route (`src/app/api/onboarding/state/route.ts`)
    - Authenticate request via session, extract `tenantId` from JWT
    - Call `getOnboardingState(tenantId)`; if null, call `initializeOnboardingState(tenantId)` (self-healing per Requirement 1.7)
    - Return the onboarding state JSON
    - _Requirements: 1.3, 1.7_

  - [x] 4.2 Create `PUT /api/onboarding/steps/[step]` route (`src/app/api/onboarding/steps/[step]/route.ts`)
    - Validate `step` parameter is one of the three valid step names
    - Call `completeStep(tenantId, step)` with conditional write
    - Return updated onboarding state
    - _Requirements: 1.2, 1.8_

  - [x] 4.3 Create `POST /api/onboarding/skip` route (`src/app/api/onboarding/skip/route.ts`)
    - Call `skipOnboarding(tenantId)`, return updated state
    - _Requirements: 7.2_

  - [x] 4.4 Create `POST /api/onboarding/resume` route (`src/app/api/onboarding/resume/route.ts`)
    - Call `resumeOnboarding(tenantId)`, return updated state with first incomplete step
    - _Requirements: 7.4_

  - [x] 4.5 Create `POST /api/onboarding/test-event` route (`src/app/api/onboarding/test-event/route.ts`)
    - Look up the tenant's integration from DynamoDB
    - Call `sendTestEvent(tenantId, integrationId)`, return result
    - _Requirements: 4.2, 4.3_

  - [x] 4.6 Create `GET /api/onboarding/snippet` route (`src/app/api/onboarding/snippet/route.ts`)
    - Accept `integrationId` query parameter
    - Look up integration to get type, construct `SnippetContext` with the tenant's webhook URL
    - Call `generateSnippet(context)`, return the snippet
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

  - [x] 4.7 Create `GET /api/onboarding/poll` route (`src/app/api/onboarding/poll/route.ts`)
    - Check if the tenant has received a real deployment event by querying `ollinai-events` table
    - Return `{ received: boolean, eventId?: string }`
    - _Requirements: 4.5, 4.6_

  - [x] 4.8 Create `POST /api/onboarding/banner/dismiss` route (`src/app/api/onboarding/banner/dismiss/route.ts`)
    - Call `dismissBanner(tenantId)`, return success
    - _Requirements: 7.3_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Enhance middleware for onboarding routing
  - [x] 6.1 Extend middleware to check onboarding state (`src/middleware.ts`)
    - After JWT validation, check `onboardingComplete` claim in token
    - If `onboardingComplete` is false or missing and user is navigating to `/dashboard/*`, fetch onboarding state from DynamoDB and redirect to `/onboarding/{firstIncompleteStep}`
    - If onboarding is complete and user navigates to `/onboarding/*`, redirect to `/dashboard`
    - Add `/onboarding` to the public paths that don't need the onboarding check themselves
    - Implement fail-open behavior: if DynamoDB read times out, allow access to dashboard and log a warning
    - _Requirements: 1.3, 1.4_

  - [x] 6.2 Extend NextAuth session to include `onboardingComplete` claim
    - Modify the NextAuth JWT callback to check onboarding state on sign-in and set `onboardingComplete` boolean
    - Update session refresh to re-check onboarding state when steps complete
    - _Requirements: 1.3, 1.4_

  - [ ]* 6.3 Write property test: Step completion produces valid timestamp
    - **Property 2: Step completion timestamp**
    - Generate random valid tenantIds and step names, complete the step, verify `completedAt` is a valid UTC ISO-8601 timestamp not in the future
    - **Validates: Requirements 1.2**

- [x] 7. Implement onboarding UI components
  - [x] 7.1 Create onboarding layout with progress indicator (`src/app/onboarding/layout.tsx`)
    - Implement `OnboardingLayout` with a progress stepper showing three steps with states: completed, active, unavailable
    - Include a persistent "Skip onboarding" link visible without scrolling
    - Display contextual help text (max 200 characters) alongside each step
    - Fetch onboarding state on mount via `GET /api/onboarding/state`
    - _Requirements: 6.1, 6.2, 6.4, 7.1_

  - [x] 7.2 Create Integration Step page (`src/app/onboarding/integration/page.tsx`)
    - Render selectable cards for GitHub Actions, GitLab CI, and Custom Webhook
    - Render integration name input with client-side validation (1-100 chars, `[a-zA-Z0-9_-]`)
    - Disable submit until both selection and valid name are provided
    - On submit, call `POST /api/integrations` to create integration
    - Display generated secret key with copy-to-clipboard and one-time-view warning
    - On success, call `PUT /api/onboarding/steps/integration_created`
    - Handle API errors with retry-capable error display
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 7.3 Create Pipeline Configuration Step page (`src/app/onboarding/pipeline/page.tsx`)
    - Fetch code snippet via `GET /api/onboarding/snippet?integrationId={id}`
    - Render the code snippet in a syntax-highlighted block with copy-to-clipboard button
    - Show visible confirmation indicator for 2 seconds after successful copy
    - Include a "Continue" button that calls `PUT /api/onboarding/steps/pipeline_configured`
    - Handle snippet fetch errors with retry control
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 7.4 Create First Event Step page (`src/app/onboarding/event/page.tsx`)
    - Render two options: "Trigger a real deployment" and "Send a test event"
    - For test event: call `POST /api/onboarding/test-event`, show success/error with unlimited retries
    - For real deployment: enter polling mode calling `GET /api/onboarding/poll` every 5 seconds for up to 10 minutes
    - On success (HTTP 201 or poll finds event), call `PUT /api/onboarding/steps/first_event_received`
    - On timeout: show timeout message with retry or switch-to-test-event options
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 7.5 Create Completion Step page (`src/app/onboarding/complete/page.tsx`)
    - Display completion message including tenant name within 2 seconds of step completion
    - Render "Go to Dashboard" CTA button that redirects to `/dashboard` within 1 second
    - _Requirements: 5.1, 5.2_

  - [x] 7.6 Implement read-only view for previously completed steps
    - When navigating back to a completed step, render it in read-only mode showing saved data (integration type, name) without modification controls
    - Block navigation to steps with incomplete prerequisites and display prerequisite message
    - _Requirements: 6.2, 6.3_

- [x] 8. Implement skip/resume onboarding and dashboard integration
  - [x] 8.1 Implement skip onboarding confirmation flow
    - Add confirmation modal/prompt triggered by the "Skip onboarding" control
    - On confirmation, call `POST /api/onboarding/skip` and redirect to `/dashboard` within 2 seconds
    - _Requirements: 7.1, 7.2_

  - [x] 8.2 Implement resume onboarding banner on dashboard
    - Create a dismissible banner component shown on `/dashboard` when onboarding status is `'skipped'`
    - "Resume onboarding" action calls `POST /api/onboarding/resume` and redirects to the first incomplete step
    - "Dismiss permanently" action calls `POST /api/onboarding/banner/dismiss`
    - Banner reappears on each visit until dismissed permanently or onboarding is resumed
    - _Requirements: 7.3, 7.4_

  - [x] 8.3 Update dashboard to show deployment data after onboarding completes
    - When onboarding is complete, ensure dashboard displays deployment timestamp, commit SHA, service name, environment, and author from the received event
    - If event data hasn't been processed yet, show loading indicator with auto-refresh for up to 30 seconds, then show "data still processing" message with manual refresh
    - _Requirements: 5.3, 5.4_

- [ ] 9. Wire webhook ingestion to mark onboarding step complete
  - [x] 9.1 Update webhook ingestion to trigger onboarding step completion (`src/app/api/webhooks/deployments/route.ts`)
    - After successfully persisting a deployment event, check if the tenant's `first_event_received` step is incomplete
    - If incomplete, call `completeStep(tenantId, 'first_event_received')`
    - This allows real pipeline deployments to automatically advance onboarding
    - _Requirements: 4.5_

  - [ ]* 9.2 Write unit tests for webhook-triggered onboarding completion
    - Test that a deployment event for a tenant with incomplete onboarding marks the step complete
    - Test that a deployment event for a tenant with already-completed onboarding is a no-op
    - _Requirements: 4.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, consistent with the existing Next.js 14 codebase
- DynamoDB operations use the existing `ollinai-config` table with PK/SK pattern `TENANT#{tenantId}` / `ONBOARDING#state`
- The existing integration API at `/api/integrations` is reused for step 1; no duplication needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.6"] },
    { "id": 2, "tasks": ["1.4", "1.7", "2.1", "2.3"] },
    { "id": 3, "tasks": ["2.2", "2.4"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 8, "tasks": ["7.6", "8.1", "8.2", "8.3", "9.1"] },
    { "id": 9, "tasks": ["9.2"] }
  ]
}
```
