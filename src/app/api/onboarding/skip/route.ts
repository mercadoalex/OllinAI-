/**
 * Skip Onboarding API — POST /api/onboarding/skip
 *
 * Marks the onboarding as skipped for the authenticated tenant.
 * Sets status to 'skipped' and records a skippedAt timestamp.
 *
 * Requirements: 7.2
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import { skipOnboarding } from "@/lib/onboarding/state";

export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;

    const updatedState = await skipOnboarding(tenantId);

    return NextResponse.json(updatedState, { status: 200 });
  } catch (error) {
    console.error("[onboarding/skip] Error:", error);
    return NextResponse.json(
      { error: "Failed to skip onboarding" },
      { status: 500 }
    );
  }
}
