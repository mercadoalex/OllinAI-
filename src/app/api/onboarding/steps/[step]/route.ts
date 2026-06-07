/**
 * Onboarding Step Completion API — PUT /api/onboarding/steps/[step]
 *
 * Marks a specific onboarding step as complete for the authenticated tenant.
 * Validates that the step parameter is one of the three valid step names.
 *
 * Requirements: 1.2, 1.8
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import { completeStep, type OnboardingStepName } from "@/lib/onboarding/state";

const VALID_STEPS: OnboardingStepName[] = [
  "integration_created",
  "pipeline_configured",
  "first_event_received",
];

export async function PUT(
  request: NextRequest,
  { params }: { params: { step: string } }
) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;
    const { step } = params;

    // Validate step parameter
    if (!VALID_STEPS.includes(step as OnboardingStepName)) {
      return NextResponse.json(
        {
          error: `Invalid step name: "${step}". Must be one of: ${VALID_STEPS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const updatedState = await completeStep(
      tenantId,
      step as OnboardingStepName
    );

    return NextResponse.json(updatedState, { status: 200 });
  } catch (error) {
    console.error("[onboarding/steps] Error:", error);
    return NextResponse.json(
      { error: "Failed to complete onboarding step" },
      { status: 500 }
    );
  }
}
