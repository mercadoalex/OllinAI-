/**
 * Onboarding Routing Logic
 *
 * Pure functions that determine where a user should be directed based on their
 * onboarding state. No external dependencies beyond the state types.
 *
 * Rules:
 * - status = 'completed' OR all steps complete → dashboard
 * - status = 'skipped' AND bannerDismissed = false → dashboard_with_banner
 * - status = 'skipped' AND bannerDismissed = true → dashboard
 * - status = 'in_progress' → onboarding step (first incomplete)
 *
 * Requirements: 1.3, 1.4, 6.3, 7.3
 */

import {
  OnboardingState,
  OnboardingStepName,
  ONBOARDING_STEPS,
} from "./state";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** The routing decision returned by determineRoute */
export type RoutingDecision =
  | { type: "onboarding"; step: OnboardingStepName }
  | { type: "dashboard" }
  | { type: "dashboard_with_banner" };

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Determines where a user should be routed based on their onboarding state.
 *
 * @param state - The tenant's current onboarding state
 * @returns A RoutingDecision indicating the target destination
 *
 * Requirements: 1.3, 1.4, 7.3
 */
export function determineRoute(state: OnboardingState): RoutingDecision {
  // If status is completed or all steps are done, go to dashboard
  if (state.status === "completed" || allStepsComplete(state)) {
    return { type: "dashboard" };
  }

  // If skipped, show dashboard with or without banner
  if (state.status === "skipped") {
    if (state.bannerDismissed) {
      return { type: "dashboard" };
    }
    return { type: "dashboard_with_banner" };
  }

  // Otherwise in_progress: route to the first incomplete step
  const firstIncomplete = getFirstIncompleteStep(state);

  // Edge case: all steps are complete but status hasn't been updated yet
  if (firstIncomplete === null) {
    return { type: "dashboard" };
  }

  return { type: "onboarding", step: firstIncomplete };
}

/**
 * Determines whether a user can navigate to a specific onboarding step.
 *
 * Navigation is allowed only if all steps preceding the target in the
 * defined sequence are marked as complete.
 *
 * @param state - The tenant's current onboarding state
 * @param targetStep - The step the user wants to navigate to
 * @returns true if navigation is permitted, false otherwise
 *
 * Requirements: 6.3
 */
export function canNavigateToStep(
  state: OnboardingState,
  targetStep: OnboardingStepName
): boolean {
  const targetIndex = ONBOARDING_STEPS.indexOf(targetStep);

  // If step not found in sequence, disallow navigation
  if (targetIndex === -1) {
    return false;
  }

  // First step is always accessible
  if (targetIndex === 0) {
    return true;
  }

  // All preceding steps must be complete
  for (let i = 0; i < targetIndex; i++) {
    const precedingStep = ONBOARDING_STEPS[i];
    if (!state.steps[precedingStep].completed) {
      return false;
    }
  }

  return true;
}

/**
 * Returns the first step in the sequence that has not been completed.
 *
 * @param state - The tenant's current onboarding state
 * @returns The first incomplete step name, or null if all steps are complete
 *
 * Requirements: 1.3
 */
export function getFirstIncompleteStep(
  state: OnboardingState
): OnboardingStepName | null {
  for (const step of ONBOARDING_STEPS) {
    if (!state.steps[step].completed) {
      return step;
    }
  }
  return null;
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Checks if all steps in the onboarding state are complete.
 */
function allStepsComplete(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.every((step) => state.steps[step].completed);
}
