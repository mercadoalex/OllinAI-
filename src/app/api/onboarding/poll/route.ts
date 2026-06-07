/**
 * Event Polling API — GET /api/onboarding/poll
 *
 * Checks whether the tenant has received any deployment events
 * by querying the ollinai-events table.
 *
 * Requirements: 4.5, 4.6
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;

    // Query ollinai-events table for any events belonging to this tenant
    const client = getDocumentClient();
    const result = await client.send(
      new QueryCommand({
        TableName: TableNames.EVENTS,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}`,
        },
        Limit: 1,
        ScanIndexForward: false, // Most recent first
      })
    );

    const hasEvents = (result.Items?.length ?? 0) > 0;
    const firstEvent = hasEvents ? result.Items![0] : null;

    return NextResponse.json(
      {
        received: hasEvents,
        ...(firstEvent && { eventId: firstEvent.SK?.replace("EVENT#", "") }),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[onboarding/poll] Error:", error);
    return NextResponse.json(
      { error: "Failed to check for events" },
      { status: 500 }
    );
  }
}
