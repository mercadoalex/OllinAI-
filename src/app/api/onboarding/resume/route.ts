/**
 * Resume Onboarding API — POST /api/onboarding/resume
 *
 * Resumes onboarding for a tenant that previously skipped.
 * Returns the updated state with the first incomplete step information.
 *
 * Requirements: 7.4
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import { resumeOnboarding } from "@/lib/onboarding/state";
import { getFirstIncompleteStep } from "@/lib/onboarding/routing";

export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;

    const updatedState = await resumeOnboarding(tenantId);
    const firstIncompleteStep = getFirstIncompleteStep(updatedState);

    return NextResponse.json(
      {
        ...updatedState,
        nextStep: firstIncompleteStep,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[onboarding/resume] Error:", error);
    return NextResponse.json(
      { error: "Failed to resume onboarding" },
      { status: 500 }
    );
  }
}
