# Design Document: User Onboarding Flow

## Overview

This design describes a multi-step guided onboarding experience for new OllinAI tenants. The flow walks users through three sequential steps—creating an integration, configuring their CI/CD pipeline, and verifying their first deployment event—before redirecting them to a populated dashboard.

The onboarding system introduces:
- A persistent **OnboardingState** record per tenant in the `ollinai-config` DynamoDB table
- A new **`/onboarding`** route group in the Next.js App Router with step-based navigation
- A **server-side routing guard** in middleware that redirects users with incomplete onboarding
- A **code snippet generator** that templates CI/CD configuration based on integration type
- A **test event sender** that constructs and HMAC-signs a synthetic deployment payload

### Design Decisions

1. **Single DynamoDB record per tenant** for onboarding state (not per-user) because onboarding is a tenant-level concern. Multiple users in the same tenant share progress.
2. **Server-side redirect in middleware** rather than client-side checks, preventing flash of wrong content and ensuring the onboarding guard cannot be bypassed.
3. **Conditional writes** for step completion to handle concurrent users safely—once a step is marked complete, it stays complete regardless of race conditions.
4. **Code snippets generated server-side** (via API route) to avoid exposing template logic in the client bundle and to keep endpoint URLs and variable naming centralized.

## Architecture

```mermaid
graph TD
    subgraph "Next.js App Router"
        MW[Middleware] --> |incomplete onboarding| OB[/onboarding/[step]]
        MW --> |complete onboarding| DB[/dashboard]
        OB --> API_OB[/api/onboarding/*]
    end

    subgraph "API Routes"
        API_OB --> |GET state| DDB[(ollinai-config)]
        API_OB --> |PUT step complete| DDB
        API_OB --> |POST test-event| WH[/api/webhooks/deployments]
        API_INT[/api/integrations] --> DDB
    end

    subgraph "Existing Infrastructure"
        WH --> DDB_EV[(ollinai-events)]
        WH --> SQS[SQS Queue]
    end

    subgraph "Client Components"
        STEP1[IntegrationStep] --> API_INT
        STEP2[PipelineStep] --> API_OB
        STEP3[EventStep] --> API_OB
        PROG[ProgressIndicator] --> OB
    end
```

### Request Flow

1. **User signs in** → middleware checks JWT → reads onboarding state from `ollinai-config`
2. **Incomplete onboarding** → redirect to `/onboarding/{first_incomplete_step}`
3. **User completes steps** → each step calls `PUT /api/onboarding/steps/{stepName}` to mark complete
4. **All steps complete** → middleware allows dashboard access; onboarding routes redirect to dashboard

## Components and Interfaces

### 1. Onboarding State Service (`src/lib/onboarding/state.ts`)

Core data access layer for onboarding state management.

```typescript
interface OnboardingState {
  tenantId: string;
  status: 'in_progress' | 'completed' | 'skipped';
  steps: {
    integration_created: StepState;
    pipeline_configured: StepState;
    first_event_received: StepState;
  };
  createdAt: string;   // ISO-8601
  updatedAt: string;   // ISO-8601
  skippedAt?: string;  // ISO-8601, set when user skips
  bannerDismissed?: boolean; // true when resume banner permanently dismissed
}

interface StepState {
  completed: boolean;
  completedAt?: string; // ISO-8601 UTC timestamp
}

// Public API
function initializeOnboardingState(tenantId: string): Promise<OnboardingState>;
function getOnboardingState(tenantId: string): Promise<OnboardingState | null>;
function completeStep(tenantId: string, step: OnboardingStepName): Promise<OnboardingState>;
function skipOnboarding(tenantId: string): Promise<OnboardingState>;
function resumeOnboarding(tenantId: string): Promise<OnboardingState>;
function dismissBanner(tenantId: string): Promise<void>;
```

### 2. Onboarding Routing Logic (`src/lib/onboarding/routing.ts`)

Pure function that determines where a user should be redirected based on their onboarding state.

```typescript
type OnboardingStepName = 'integration_created' | 'pipeline_configured' | 'first_event_received';

const STEP_SEQUENCE: OnboardingStepName[] = [
  'integration_created',
  'pipeline_configured', 
  'first_event_received',
];

type RoutingDecision = 
  | { type: 'onboarding'; step: OnboardingStepName }
  | { type: 'dashboard' }
  | { type: 'dashboard_with_banner' };

function determineRoute(state: OnboardingState): RoutingDecision;
function canNavigateToStep(state: OnboardingState, targetStep: OnboardingStepName): boolean;
function getFirstIncompleteStep(state: OnboardingState): OnboardingStepName | null;
```

### 3. Code Snippet Generator (`src/lib/onboarding/snippets.ts`)

Generates pre-populated CI/CD configuration snippets.

```typescript
type IntegrationType = 'github_actions' | 'gitlab_ci' | 'custom';

interface SnippetContext {
  webhookUrl: string;        // e.g., https://app.ollinai.com/api/webhooks/deployments
  integrationKey: string;    // {tenantId}:{integrationId}
  secretKeyVarName: string;  // e.g., OLLINAI_SECRET_KEY
  integrationType: IntegrationType;
}

interface GeneratedSnippet {
  language: string;     // 'yaml' | 'bash'
  content: string;      // The full snippet content
  filename: string;     // Suggested filename
  instructions: string; // Brief setup instructions
}

function generateSnippet(context: SnippetContext): GeneratedSnippet;
```

### 4. Test Event Builder (`src/lib/onboarding/test-event.ts`)

Constructs and signs a synthetic deployment event for onboarding verification.

```typescript
interface TestEventResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

function buildTestEventPayload(): DeploymentEventPayload;
function signPayload(payload: string, secretKey: string): string;
function sendTestEvent(tenantId: string, integrationId: string): Promise<TestEventResult>;
```

### 5. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/onboarding/state` | GET | Retrieve current onboarding state |
| `/api/onboarding/steps/[step]` | PUT | Mark a step as complete |
| `/api/onboarding/skip` | POST | Skip onboarding |
| `/api/onboarding/resume` | POST | Resume skipped onboarding |
| `/api/onboarding/test-event` | POST | Send a test deployment event |
| `/api/onboarding/snippet` | GET | Generate code snippet for integration |
| `/api/onboarding/poll` | GET | Check if a real event has arrived |
| `/api/onboarding/banner/dismiss` | POST | Permanently dismiss resume banner |

### 6. Page Components

| Route | Component | Purpose |
|-------|-----------|---------|
| `/onboarding/integration` | `IntegrationStep` | Step 1: Select CI/CD tool, name integration |
| `/onboarding/pipeline` | `PipelineStep` | Step 2: Display code snippet |
| `/onboarding/event` | `EventStep` | Step 3: Send/await first event |
| `/onboarding/complete` | `CompletionStep` | Success screen with CTA |
| `/onboarding/layout.tsx` | `OnboardingLayout` | Progress indicator + skip control |

### 7. Middleware Enhancement (`src/middleware.ts`)

The existing middleware is extended to:
1. After JWT validation, fetch onboarding state for the tenant
2. If state is incomplete and user is navigating to `/dashboard/*`, redirect to `/onboarding/{firstIncompleteStep}`
3. If state is complete and user is navigating to `/onboarding/*`, redirect to `/dashboard`
4. Cache the onboarding state check in the JWT session to avoid DynamoDB reads on every request (refresh on step completion via session update)

### 8. Integration Name Validator (`src/lib/onboarding/validation.ts`)

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateIntegrationName(name: string): ValidationResult;
// Rules: 1-100 chars, only [a-zA-Z0-9_-]
```

## Data Models

### Onboarding State Record (ollinai-config table)

| Attribute | Value | Notes |
|-----------|-------|-------|
| PK | `TENANT#{tenantId}` | Standard tenant partition |
| SK | `ONBOARDING#state` | Single record per tenant |
| entityData | `OnboardingState` object | See interface above |

**Example DynamoDB Item:**

```json
{
  "PK": "TENANT#abc-123",
  "SK": "ONBOARDING#state",
  "entityData": {
    "tenantId": "abc-123",
    "status": "in_progress",
    "steps": {
      "integration_created": { "completed": true, "completedAt": "2024-03-15T10:30:00Z" },
      "pipeline_configured": { "completed": false },
      "first_event_received": { "completed": false }
    },
    "createdAt": "2024-03-15T10:00:00Z",
    "updatedAt": "2024-03-15T10:30:00Z"
  }
}
```

### Conditional Write for Step Completion

To prevent race conditions when multiple users complete steps concurrently:

```typescript
// Only mark complete if not already completed
ConditionExpression: "attribute_exists(PK) AND entityData.steps.#step.completed = :false"
ExpressionAttributeNames: { "#step": stepName }
ExpressionAttributeValues: { ":false": false }
```

If the condition fails (step already complete), the operation is a no-op rather than an error.

### Middleware Session Enhancement

The JWT token is extended with an `onboardingComplete` boolean claim:

```typescript
interface ExtendedJWT {
  tenantId: string;
  userId: string;
  role: UserRole;
  teamIds: string[];
  onboardingComplete: boolean; // New field
}
```

This is set during sign-in and refreshed when onboarding completes, reducing per-request DynamoDB reads.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Onboarding state initialization invariant

*For any* valid tenantId, initializing an onboarding state SHALL produce a record where all three steps (`integration_created`, `pipeline_configured`, `first_event_received`) have `completed = false` and no `completedAt` timestamp, with `status = 'in_progress'`.

**Validates: Requirements 1.1**

### Property 2: Step completion produces valid timestamp

*For any* valid tenantId and any valid step name in the defined sequence, completing that step SHALL produce a record where that step has `completed = true` and `completedAt` is a valid UTC ISO-8601 timestamp that is not in the future relative to the current time (within a reasonable tolerance).

**Validates: Requirements 1.2**

### Property 3: Routing decision correctness

*For any* OnboardingState, the routing decision SHALL satisfy: if `status = 'completed'` or all steps are complete, route to dashboard; if `status = 'skipped'`, route to dashboard with banner (unless banner dismissed); otherwise route to the first incomplete step in the sequence `[integration_created, pipeline_configured, first_event_received]`.

**Validates: Requirements 1.3, 1.4, 7.3**

### Property 4: Integration name validation

*For any* string input, the integration name validator SHALL accept the input if and only if it has length between 1 and 100 (inclusive) and contains only characters matching the pattern `[a-zA-Z0-9_-]`. All other inputs SHALL be rejected.

**Validates: Requirements 2.2, 2.6**

### Property 5: Code snippet generation contains required fields

*For any* valid SnippetContext (with a valid webhookUrl, integrationKey, and secretKeyVarName), the generated snippet SHALL contain the webhookUrl string and the secretKeyVarName string verbatim within the output content. Additionally, for `custom` type, the output SHALL contain all required DeploymentEvent fields (`commitShas`, `author`, `services`, `environment`, `deploymentTimestamp`).

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 6: Test event payload validity and signature verification

*For any* valid integration data (tenantId, integrationId, secretKey), the test event builder SHALL produce a payload that passes the DeploymentEventSchema validation, and the HMAC-SHA256 signature computed with the secretKey SHALL verify successfully against that payload using the `verifySignature` function.

**Validates: Requirements 4.2**

### Property 7: Navigation guard enforcement

*For any* OnboardingState and any target step, navigation to that step SHALL be permitted if and only if all steps preceding it in the defined sequence are marked as complete. Navigation to a step whose prerequisites are incomplete SHALL be blocked.

**Validates: Requirements 6.3**

## Error Handling

| Scenario | Handling Strategy |
|----------|-------------------|
| Onboarding state initialization failure | Retry up to 3 times with exponential backoff (200ms, 400ms, 800ms). If all retries fail, display an error message with a manual retry button. |
| Integration creation API error | Display the API error message in a dismissible alert. Keep the form populated so the user can correct and retry. |
| Code snippet data unavailable | Show inline error with "Retry" button. Do not advance the step. |
| Test event webhook failure | Display the error reason from the webhook response. Allow unlimited retries. Show troubleshooting hints (check secret key, verify endpoint). |
| Polling timeout (10 min) | Display timeout message with two options: retry polling or switch to test event. |
| Conditional write conflict | Silently succeed—if the step is already complete, the user sees the next step regardless of which concurrent request "won". |
| DynamoDB read timeout on middleware check | Fall through to dashboard (fail-open for reads). Log warning. The dashboard will handle showing onboarding banner if needed. |
| Missing onboarding state record | Auto-create with all steps incomplete (self-healing). Log the anomaly. |

## Testing Strategy

### Property-Based Tests (fast-check)

The project will use **fast-check** as the property-based testing library for TypeScript. Each property test runs a minimum of **100 iterations** with randomized inputs.

Properties to implement:
1. **Initialization invariant** — Generate random tenant IDs, verify state shape
2. **Step completion timestamp** — Generate random steps, verify ISO-8601 format and chronological correctness
3. **Routing decision** — Generate random `OnboardingState` objects (all possible step combinations × status values), verify correct routing
4. **Integration name validation** — Generate random strings (valid and invalid), verify acceptance/rejection matches the rules
5. **Code snippet generation** — Generate random `SnippetContext` objects, verify output contains required fields
6. **Test event validity** — Generate random integration credentials, verify payload schema compliance and HMAC round-trip
7. **Navigation guard** — Generate random states and target steps, verify prerequisite enforcement

Tag format: `Feature: user-onboarding-flow, Property {N}: {description}`

### Unit Tests (Jest / Vitest)

- Onboarding state service: CRUD operations with mocked DynamoDB
- Middleware redirect logic: mock JWT token scenarios
- Skip/resume flow: state transitions
- Component rendering: progress indicator states, help text length verification
- Error scenarios: retry exhaustion, API failures

### Integration Tests

- End-to-end onboarding flow with DynamoDB Local
- Concurrent step completion with conditional writes
- Real webhook ingestion triggering onboarding step completion
- Middleware redirect behavior with authenticated sessions

### E2E Tests (Playwright)

- Complete onboarding happy path (all three steps)
- Skip onboarding and verify banner
- Resume onboarding from banner
- Copy-to-clipboard interactions
- Polling timeout and recovery
