/**
 * Test Event Builder
 *
 * Constructs and signs a synthetic deployment event for onboarding verification.
 * Used during the "First Deployment Event" onboarding step to validate that the
 * integration is configured correctly without requiring a real CI/CD pipeline run.
 *
 * The test event uses obvious placeholder values so it's clearly distinguishable
 * from real deployment data.
 *
 * Requirements: 4.1, 4.2
 */

import { computeSignature } from "@/lib/webhooks/hmac";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { DeploymentEventPayload } from "@/lib/types";
import type { IntegrationConfigItem } from "@/lib/types/dynamo";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Result of sending a test event */
export interface TestEventResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Placeholder values for the test event payload */
const TEST_COMMIT_SHA = "test-commit-sha-onboarding";
const TEST_SERVICE_NAME = "onboarding-test-service";
const TEST_ENVIRONMENT = "staging";
const TEST_AUTHOR = "onboarding@ollinai.com";

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a test deployment event payload with placeholder values.
 *
 * Returns a valid DeploymentEventPayload that satisfies all schema requirements
 * but uses clearly synthetic data so it can be identified as a test event.
 *
 * @returns A valid DeploymentEventPayload with placeholder values
 *
 * Requirements: 4.2
 */
export function buildTestEventPayload(): DeploymentEventPayload {
  return {
    commitShas: [TEST_COMMIT_SHA],
    author: TEST_AUTHOR,
    services: [TEST_SERVICE_NAME],
    deploymentTimestamp: new Date().toISOString(),
    environment: TEST_ENVIRONMENT,
  };
}

/**
 * Signs a JSON payload string using HMAC-SHA256 with the provided secret key.
 *
 * Reuses the existing computeSignature function from @/lib/webhooks/hmac
 * to ensure signature compatibility with the webhook verification endpoint.
 *
 * @param payload - The JSON string payload to sign
 * @param secretKey - The hex-encoded secret key for the integration
 * @returns The hex-encoded HMAC-SHA256 signature
 *
 * Requirements: 4.2
 */
export function signPayload(payload: string, secretKey: string): string {
  return computeSignature(secretKey, payload);
}

/**
 * Constructs a test deployment event, signs it, and sends it to the webhook endpoint.
 *
 * Performs the following steps:
 * 1. Looks up the integration's secret key from DynamoDB
 * 2. Builds a test event payload with placeholder values
 * 3. Signs the payload using HMAC-SHA256
 * 4. Sends the signed payload to POST /api/webhooks/deployments
 * 5. Returns the result including the eventId on success
 *
 * @param tenantId - The tenant identifier
 * @param integrationId - The integration identifier
 * @returns TestEventResult indicating success or failure
 *
 * Requirements: 4.1, 4.2
 */
export async function sendTestEvent(
  tenantId: string,
  integrationId: string
): Promise<TestEventResult> {
  try {
    // 1. Look up integration secret key
    const secretKey = await getIntegrationSecretKey(tenantId, integrationId);
    if (!secretKey) {
      return {
        success: false,
        error: "Integration not found or missing secret key",
      };
    }

    // 2. Build the test event payload
    const payload = buildTestEventPayload();
    const payloadStr = JSON.stringify(payload);

    // 3. Sign the payload
    const signature = signPayload(payloadStr, secretKey);

    // 4. Send to webhook endpoint
    const baseUrl =
      process.env.NEXTAUTH_URL || "http://localhost:3000";
    const webhookUrl = `${baseUrl}/api/webhooks/deployments`;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OllinAI-Signature": signature,
        "X-OllinAI-Integration": `${tenantId}:${integrationId}`,
      },
      body: payloadStr,
    });

    // 5. Handle response
    const responseData = await response.json();

    if (response.status === 201) {
      return {
        success: true,
        eventId: responseData.eventId,
      };
    }

    // Also accept 200 for duplicate events (test event already sent)
    if (response.status === 200 && responseData.status === "duplicate") {
      return {
        success: true,
        eventId: responseData.eventId,
      };
    }

    return {
      success: false,
      error: responseData.error || `Webhook returned status ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error sending test event",
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retrieves the secret key for an integration from DynamoDB.
 *
 * @param tenantId - The tenant identifier
 * @param integrationId - The integration identifier
 * @returns The secret key string, or null if not found
 */
async function getIntegrationSecretKey(
  tenantId: string,
  integrationId: string
): Promise<string | null> {
  const client = getDocumentClient();

  const result = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INTEGRATION#${integrationId}`,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  const entityData = result.Item.entityData as IntegrationConfigItem["entityData"];
  return entityData.secretKeyHash || null;
}
