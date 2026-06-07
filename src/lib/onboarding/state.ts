/**
 * Onboarding State Service
 *
 * Core data access layer for managing tenant onboarding state in DynamoDB.
 * Stores onboarding progress in the ollinai-config table using the pattern:
 *   PK: TENANT#{tenantId}
 *   SK: ONBOARDING#state
 *
 * Features:
 * - Initialization with retry logic (3 attempts, exponential backoff)
 * - Conditional writes for step completion to handle concurrent users
 * - Skip/resume/dismiss operations for flexible onboarding lifecycle
 *
 * Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 7.2, 7.4
 */

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Names of onboarding steps in the defined sequence */
export type OnboardingStepName =
  | "integration_created"
  | "pipeline_configured"
  | "first_event_received";

/** State of an individual onboarding step */
export interface StepState {
  completed: boolean;
  completedAt?: string; // ISO-8601 UTC timestamp
}

/** Full onboarding state record for a tenant */
export interface OnboardingState {
  tenantId: string;
  status: "in_progress" | "completed" | "skipped";
  steps: {
    integration_created: StepState;
    pipeline_configured: StepState;
    first_event_received: StepState;
  };
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  skippedAt?: string; // ISO-8601, set when user skips
  bannerDismissed?: boolean; // true when resume banner permanently dismissed
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** The ordered sequence of onboarding steps */
export const ONBOARDING_STEPS: OnboardingStepName[] = [
  "integration_created",
  "pipeline_configured",
  "first_event_received",
];

/** Maximum retry attempts for initialization */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (200ms, 400ms, 800ms) */
const BASE_DELAY_MS = 200;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds the DynamoDB partition key for a tenant's onboarding state.
 */
function buildPK(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

/** Sort key for onboarding state record */
const ONBOARDING_SK = "ONBOARDING#state";

/**
 * Sleeps for the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if all steps in the state are complete and updates status accordingly.
 */
function areAllStepsComplete(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.every((step) => state.steps[step].completed);
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Initializes a new onboarding state record for a tenant.
 *
 * Creates the record with all steps marked as incomplete and status = 'in_progress'.
 * Uses retry logic with exponential backoff (200ms, 400ms, 800ms) for up to 3 attempts.
 *
 * @param tenantId - The tenant identifier
 * @returns The newly created OnboardingState
 * @throws Error if all retry attempts are exhausted
 *
 * Requirements: 1.1, 1.6
 */
export async function initializeOnboardingState(
  tenantId: string
): Promise<OnboardingState> {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required and cannot be empty");
  }

  const now = new Date().toISOString();
  const state: OnboardingState = {
    tenantId,
    status: "in_progress",
    steps: {
      integration_created: { completed: false },
      pipeline_configured: { completed: false },
      first_event_received: { completed: false },
    },
    createdAt: now,
    updatedAt: now,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const client = getDocumentClient();
      await client.send(
        new PutCommand({
          TableName: TableNames.CONFIG,
          Item: {
            PK: buildPK(tenantId),
            SK: ONBOARDING_SK,
            entityData: state,
          },
          // Only create if the record doesn't already exist
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        })
      );
      return state;
    } catch (error: unknown) {
      // If the record already exists, read and return it
      if (
        error instanceof ConditionalCheckFailedException ||
        (error as any)?.name === "ConditionalCheckFailedException"
      ) {
        const existing = await getOnboardingState(tenantId);
        if (existing) {
          return existing;
        }
      }

      lastError = error instanceof Error ? error : new Error(String(error));

      // Apply exponential backoff before retrying
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Failed to initialize onboarding state after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}

/**
 * Retrieves the onboarding state for a tenant.
 *
 * @param tenantId - The tenant identifier
 * @returns The OnboardingState or null if no record exists
 *
 * Requirements: 1.3, 1.7
 */
export async function getOnboardingState(
  tenantId: string
): Promise<OnboardingState | null> {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required and cannot be empty");
  }

  const client = getDocumentClient();
  const result = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: buildPK(tenantId),
        SK: ONBOARDING_SK,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return result.Item.entityData as OnboardingState;
}

/**
 * Marks a specific onboarding step as complete for a tenant.
 *
 * Uses a DynamoDB conditional write to prevent overwriting a step that has
 * already been marked complete (handles concurrent users safely).
 * If the step is already complete, the function returns the current state
 * without error (idempotent).
 *
 * @param tenantId - The tenant identifier
 * @param step - The step name to mark as complete
 * @returns The updated OnboardingState
 * @throws Error if the onboarding state record doesn't exist
 *
 * Requirements: 1.2, 1.8
 */
export async function completeStep(
  tenantId: string,
  step: OnboardingStepName
): Promise<OnboardingState> {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required and cannot be empty");
  }

  if (!ONBOARDING_STEPS.includes(step)) {
    throw new Error(`Invalid step name: ${step}`);
  }

  const now = new Date().toISOString();
  const client = getDocumentClient();

  try {
    const result = await client.send(
      new UpdateCommand({
        TableName: TableNames.CONFIG,
        Key: {
          PK: buildPK(tenantId),
          SK: ONBOARDING_SK,
        },
        UpdateExpression:
          "SET entityData.steps.#step.completed = :true, " +
          "entityData.steps.#step.completedAt = :now, " +
          "entityData.updatedAt = :now",
        ConditionExpression:
          "attribute_exists(PK) AND entityData.steps.#step.completed = :false",
        ExpressionAttributeNames: {
          "#step": step,
        },
        ExpressionAttributeValues: {
          ":true": true,
          ":false": false,
          ":now": now,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    const updatedState = result.Attributes?.entityData as OnboardingState;

    // Check if all steps are now complete and update status
    if (areAllStepsComplete(updatedState)) {
      const statusResult = await client.send(
        new UpdateCommand({
          TableName: TableNames.CONFIG,
          Key: {
            PK: buildPK(tenantId),
            SK: ONBOARDING_SK,
          },
          UpdateExpression:
            "SET entityData.#status = :completed, entityData.updatedAt = :now",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":completed": "completed",
            ":now": now,
          },
          ReturnValues: "ALL_NEW",
        })
      );
      return statusResult.Attributes?.entityData as OnboardingState;
    }

    return updatedState;
  } catch (error: unknown) {
    // If the conditional check fails, the step is already complete — return current state
    if (
      error instanceof ConditionalCheckFailedException ||
      (error as any)?.name === "ConditionalCheckFailedException"
    ) {
      const existing = await getOnboardingState(tenantId);
      if (existing) {
        return existing;
      }
      throw new Error(
        `Onboarding state record not found for tenant: ${tenantId}`
      );
    }
    throw error;
  }
}

/**
 * Marks the onboarding as skipped for a tenant.
 *
 * Sets status to 'skipped' and records a skippedAt timestamp.
 *
 * @param tenantId - The tenant identifier
 * @returns The updated OnboardingState
 *
 * Requirements: 7.2
 */
export async function skipOnboarding(
  tenantId: string
): Promise<OnboardingState> {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required and cannot be empty");
  }

  const now = new Date().toISOString();
  const client = getDocumentClient();

  const result = await client.send(
    new UpdateCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: buildPK(tenantId),
        SK: ONBOARDING_SK,
      },
      UpdateExpression:
        "SET entityData.#status = :skipped, " +
        "entityData.skippedAt = :now, " +
        "entityData.updatedAt = :now",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":skipped": "skipped",
        ":now": now,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes?.entityData as OnboardingState;
}

/**
 * Resumes onboarding for a tenant that previously skipped.
 *
 * Sets status back to 'in_progress'.
 *
 * @param tenantId - The tenant identifier
 * @returns The updated OnboardingState
 *
 * Requirements: 7.4
 */
export async function resumeOnboarding(
  tenantId: string
): Promise<OnboardingState> {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required and cannot be empty");
  }

  const now = new Date().toISOString();
  const client = getDocumentClient();

  const result = await client.send(
    new UpdateCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: buildPK(tenantId),
        SK: ONBOARDING_SK,
      },
      UpdateExpression:
        "SET entityData.#status = :inProgress, " +
        "entityData.updatedAt = :now " +
        "REMOVE entityData.skippedAt",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":inProgress": "in_progress",
        ":now": now,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes?.entityData as OnboardingState;
}

/**
 * Permanently dismisses the onboarding resume banner for a tenant.
 *
 * Sets bannerDismissed = true so the dashboard no longer shows the
 * resume onboarding prompt.
 *
 * @param tenantId - The tenant identifier
 *
 * Requirements: 7.3
 */
export async function dismissBanner(tenantId: string): Promise<void> {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("tenantId is required and cannot be empty");
  }

  const now = new Date().toISOString();
  const client = getDocumentClient();

  await client.send(
    new UpdateCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: buildPK(tenantId),
        SK: ONBOARDING_SK,
      },
      UpdateExpression:
        "SET entityData.bannerDismissed = :true, " +
        "entityData.updatedAt = :now",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: {
        ":true": true,
        ":now": now,
      },
      ReturnValues: "NONE",
    })
  );
}
