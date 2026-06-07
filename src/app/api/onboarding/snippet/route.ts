/**
 * Code Snippet API — GET /api/onboarding/snippet
 *
 * Generates a CI/CD configuration snippet for the specified integration.
 * Looks up the integration type from DynamoDB and builds the snippet
 * with the tenant's webhook URL.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.6
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  generateSnippet,
  type IntegrationType,
  type SnippetContext,
} from "@/lib/onboarding/snippets";
import type { IntegrationConfigItem } from "@/lib/types/dynamo";

export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;

    // Read integrationId from query params
    const { searchParams } = new URL(request.url);
    const integrationId = searchParams.get("integrationId");

    if (!integrationId) {
      return NextResponse.json(
        { error: "integrationId query parameter is required" },
        { status: 400 }
      );
    }

    // Look up integration from DynamoDB
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
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    const entityData = result.Item
      .entityData as IntegrationConfigItem["entityData"];

    // Build the webhook URL
    const baseUrl =
      process.env.NEXTAUTH_URL || "https://ollin-ai.vercel.app";
    const webhookUrl = `${baseUrl}/api/webhooks/deployments`;

    // Build snippet context
    const context: SnippetContext = {
      webhookUrl,
      integrationKey: `${tenantId}:${integrationId}`,
      secretKeyVarName: "OLLINAI_SECRET_KEY",
      integrationType: entityData.type as IntegrationType,
    };

    const snippet = generateSnippet(context);

    return NextResponse.json(snippet, { status: 200 });
  } catch (error) {
    console.error("[onboarding/snippet] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate code snippet" },
      { status: 500 }
    );
  }
}
