/**
 * Test Event API — POST /api/onboarding/test-event
 *
 * Sends a synthetic test deployment event to verify integration configuration.
 * Accepts integrationId in the request body and delegates to the test event builder.
 *
 * Requirements: 4.2, 4.3
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import { sendTestEvent } from "@/lib/onboarding/test-event";

export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;

    // Parse request body for integrationId
    let body: { integrationId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { integrationId } = body;
    if (!integrationId) {
      return NextResponse.json(
        { error: "integrationId is required" },
        { status: 400 }
      );
    }

    const result = await sendTestEvent(tenantId, integrationId);

    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
    });
  } catch (error) {
    console.error("[onboarding/test-event] Error:", error);
    return NextResponse.json(
      { error: "Failed to send test event" },
      { status: 500 }
    );
  }
}
