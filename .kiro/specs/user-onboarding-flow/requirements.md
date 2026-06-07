# Requirements Document

## Introduction

This feature adds a guided onboarding flow for new users of the OllinAI deployment risk platform. Currently, users who sign up land on an empty dashboard displaying "Insufficient Data" with no guidance on how to proceed. The onboarding flow will walk users through creating their first integration, adding OllinAI to their CI/CD pipeline, and sending their first deployment event, culminating in a redirect to a populated dashboard.

## Glossary

- **Onboarding_Flow**: The multi-step guided experience presented to new users after sign-up, consisting of sequential steps that must be completed to activate the platform.
- **Onboarding_Step**: A single discrete stage within the Onboarding_Flow, representing one action the user must complete.
- **Integration**: A configured connection between a tenant's CI/CD pipeline and OllinAI, identified by type (GitHub Actions, GitLab CI, or custom webhook) and authenticated via a secret key.
- **Secret_Key**: An HMAC-SHA256 signing key auto-generated when an Integration is created, used to authenticate webhook payloads.
- **Code_Snippet**: A pre-built CI/CD configuration template (GitHub Actions YAML or GitLab CI YAML) pre-populated with the user's Integration credentials.
- **Deployment_Event**: A webhook payload sent from a CI/CD pipeline to OllinAI's ingestion endpoint containing commit SHAs, services, environment, and author information.
- **Test_Event**: A simulated Deployment_Event sent from the onboarding UI to validate that the Integration is configured correctly.
- **Onboarding_State**: A persistent record tracking which Onboarding_Steps a tenant has completed, stored per-tenant in DynamoDB.
- **Dashboard**: The main application view displaying DORA metrics, risk scores, and deployment timeline for a tenant.
- **Tenant**: An organizational account in OllinAI, identified by a tenantId, containing users, integrations, and deployment data.

## Requirements

### Requirement 1: Onboarding State Tracking

**User Story:** As a platform operator, I want the system to track each tenant's onboarding progress, so that users can resume where they left off and the system knows when to show the onboarding flow versus the dashboard.

#### Acceptance Criteria

1. WHEN a new Tenant is created, THE Onboarding_Flow SHALL initialize an Onboarding_State record with all steps marked as incomplete.
2. WHEN a user completes an Onboarding_Step, THE Onboarding_Flow SHALL persist the completion status and a UTC ISO-8601 timestamp to the Onboarding_State record.
3. WHEN an authenticated user navigates to the Dashboard, THE Onboarding_Flow SHALL check the Onboarding_State and redirect users with incomplete onboarding to the first incomplete Onboarding_Step in the defined sequence (integration_created → pipeline_configured → first_event_received).
4. WHEN all Onboarding_Steps are marked complete in the Onboarding_State, THE Onboarding_Flow SHALL redirect the user to the Dashboard and cease displaying onboarding UI.
5. THE Onboarding_State SHALL support the following steps in order: integration_created, pipeline_configured, first_event_received.
6. IF the Onboarding_State record fails to initialize during Tenant creation, THEN THE Onboarding_Flow SHALL retry initialization up to 3 times, and if all retries fail, SHALL display an error message indicating onboarding setup could not be completed and allow the user to trigger initialization manually.
7. IF an authenticated user navigates to the Dashboard and no Onboarding_State record exists for their Tenant, THEN THE Onboarding_Flow SHALL create and initialize an Onboarding_State record with all steps marked as incomplete before performing the redirect check.
8. WHEN multiple users of the same Tenant complete Onboarding_Steps concurrently, THE Onboarding_Flow SHALL use conditional writes to prevent overwriting a step's completion status once it has been marked complete.

### Requirement 2: Integration Creation Step

**User Story:** As a new user, I want to select my CI/CD tool and have an integration automatically configured, so that I can connect my pipeline to OllinAI without manual setup.

#### Acceptance Criteria

1. WHEN the user reaches the integration creation step, THE Onboarding_Flow SHALL display selectable options for GitHub Actions, GitLab CI, and custom webhook.
2. WHEN the user selects a CI/CD tool and provides an integration name between 1 and 100 characters containing only alphanumeric characters, hyphens, and underscores, THE Onboarding_Flow SHALL call the Integration management API to create a new Integration with the selected type.
3. WHEN the Integration is created successfully, THE Onboarding_Flow SHALL display the generated Secret_Key to the user exactly once with a copy-to-clipboard control and a warning that the key will not be shown again after leaving this step.
4. WHEN the Integration is created successfully, THE Onboarding_Flow SHALL mark the integration_created step as complete in the Onboarding_State.
5. IF the Integration creation API returns an error, THEN THE Onboarding_Flow SHALL display an error message indicating the reason for failure and allow the user to retry.
6. IF the user has not selected a CI/CD tool or the integration name is empty or exceeds 100 characters or contains disallowed characters, THEN THE Onboarding_Flow SHALL keep the submission control disabled and display a validation message identifying the incomplete or invalid field.

### Requirement 3: Pipeline Configuration Step

**User Story:** As a new user, I want to see a ready-to-use code snippet for my chosen CI/CD tool, so that I can add OllinAI to my pipeline with minimal effort.

#### Acceptance Criteria

1. WHEN the user reaches the pipeline configuration step after selecting GitHub Actions, THE Onboarding_Flow SHALL display a Code_Snippet based on the GitHub Actions template pre-populated with the tenant's webhook endpoint URL and a placeholder referencing the Secret_Key variable name for the user to store as a repository secret.
2. WHEN the user reaches the pipeline configuration step after selecting GitLab CI, THE Onboarding_Flow SHALL display a Code_Snippet based on the GitLab CI template pre-populated with the tenant's webhook endpoint URL and a placeholder referencing the Secret_Key variable name for the user to store as a CI/CD variable.
3. WHEN the user reaches the pipeline configuration step after selecting custom webhook, THE Onboarding_Flow SHALL display a cURL example pre-populated with the tenant's webhook endpoint URL, the Authorization and Content-Type headers, and a sample JSON payload body showing all required fields of a Deployment_Event.
4. THE Onboarding_Flow SHALL provide a copy-to-clipboard control for the displayed Code_Snippet that displays a visible confirmation indicator for at least 2 seconds after a successful copy action.
5. WHEN the user clicks a "Continue" or "Next" button on the pipeline configuration step, THE Onboarding_Flow SHALL mark the pipeline_configured step as complete in the Onboarding_State.
6. IF the Onboarding_Flow cannot retrieve the Integration data needed to populate the Code_Snippet, THEN THE Onboarding_Flow SHALL display an error message indicating the integration data is unavailable and provide a retry control.

### Requirement 4: First Deployment Event Step

**User Story:** As a new user, I want to verify my integration works by sending a test deployment event, so that I can confirm my pipeline is connected before relying on it.

#### Acceptance Criteria

1. WHEN the user reaches the first event step, THE Onboarding_Flow SHALL display two options: trigger a real deployment from the pipeline, or send a Test_Event from the UI.
2. WHEN the user chooses to send a Test_Event, THE Onboarding_Flow SHALL construct a valid Deployment_Event payload populated with placeholder values for all required fields (commit SHA, service name, environment, and author) and send it to the webhook endpoint using the Integration's Secret_Key for HMAC signing.
3. WHEN the webhook endpoint returns HTTP 201 for the Test_Event, THE Onboarding_Flow SHALL mark the first_event_received step as complete in the Onboarding_State and display a success confirmation.
4. IF the webhook endpoint returns an error for the Test_Event, THEN THE Onboarding_Flow SHALL display an error message indicating the failure reason returned by the endpoint, preserve the user's current Onboarding_Step position, and allow the user to retry without limit.
5. WHEN the system receives a real Deployment_Event for a tenant with an incomplete first_event_received step, THE Onboarding_Flow SHALL mark the first_event_received step as complete in the Onboarding_State.
6. WHEN the user chooses to trigger a real deployment, THE Onboarding_Flow SHALL display a listening state that polls for an incoming Deployment_Event for up to 10 minutes, and update the UI to show success within 5 seconds of the event being received.
7. IF the listening state exceeds 10 minutes without receiving a Deployment_Event, THEN THE Onboarding_Flow SHALL display a timeout message indicating no event was received and allow the user to retry or switch to the Test_Event option.

### Requirement 5: Onboarding Completion and Dashboard Redirect

**User Story:** As a new user, I want to be directed to a populated dashboard after completing onboarding, so that I can immediately see value from the platform.

#### Acceptance Criteria

1. WHEN the first_event_received step is marked complete, THE Onboarding_Flow SHALL display a completion message within 2 seconds that includes the tenant name and confirms the platform is ready to receive deployments.
2. WHEN the user activates a call-to-action button on the completion message, THE Onboarding_Flow SHALL redirect the user to the Dashboard within 1 second.
3. WHEN a user with completed onboarding navigates to the Dashboard, THE Dashboard SHALL display at least the deployment timestamp, commit SHA, service name, environment, and author from the received Deployment_Event instead of the empty state.
4. IF a user with completed onboarding navigates to the Dashboard and the Deployment_Event data has not yet been processed, THEN THE Dashboard SHALL display a loading indicator and automatically refresh until deployment data appears or 30 seconds have elapsed, after which it SHALL display a message indicating data is still processing with an option to manually refresh.

### Requirement 6: Onboarding UI Navigation

**User Story:** As a new user, I want to see my progress through the onboarding steps, so that I know how much setup remains.

#### Acceptance Criteria

1. THE Onboarding_Flow SHALL display a progress indicator showing all Onboarding_Steps with each step visually distinguished as one of three states: completed, currently active, or not yet available.
2. THE Onboarding_Flow SHALL allow the user to navigate back to previously completed steps to review information in a read-only view without modifying the previously saved data.
3. IF the user attempts to navigate to a step that has prerequisite steps incomplete, THEN THE Onboarding_Flow SHALL keep the user on the current step and display a message indicating which prerequisite steps must be completed first.
4. WHILE the user is on an Onboarding_Step, THE Onboarding_Flow SHALL display contextual help text of no more than 200 characters that is persistently visible alongside the step content and explains the purpose of the current step.

### Requirement 7: Skip Onboarding

**User Story:** As an experienced user, I want to skip the onboarding flow, so that I can configure the platform manually if I already know what to do.

#### Acceptance Criteria

1. THE Onboarding_Flow SHALL provide a visible option to skip the onboarding at every Onboarding_Step, rendered as a persistent control that does not require scrolling to locate.
2. WHEN the user chooses to skip onboarding, THE Onboarding_Flow SHALL present a confirmation prompt before proceeding, and upon confirmation SHALL mark the Onboarding_State as skipped and redirect the user to the Dashboard within 2 seconds.
3. WHEN a user with skipped onboarding navigates to the Dashboard, THE Dashboard SHALL display a dismissible banner offering to resume onboarding setup, and the banner SHALL reappear on each visit until the user either resumes onboarding or explicitly dismisses the banner permanently.
4. WHEN a user with skipped onboarding chooses to resume onboarding from the banner, THE Onboarding_Flow SHALL set the Onboarding_State back to in-progress and redirect the user to the first incomplete Onboarding_Step.
