/**
 * Onboarding State API — GET /api/onboarding/state
 *
 * Returns the current onboarding state for the authenticated tenant.
 * If no state record exists, auto-initializes one (self-healing).
 *
 * Requirements: 1.3, 1.7
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import {
  getOnboardingState,
  initializeOnboardingState,
} from "@/lib/onboarding/state";

export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;

    let state = await getOnboardingState(tenantId);

    // Self-healing: initialize if no record exists (Requirement 1.7)
    if (!state) {
      state = await initializeOnboardingState(tenantId);
    }

    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    console.error("[onboarding/state] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve onboarding state" },
      { status: 500 }
    );
  }
}
