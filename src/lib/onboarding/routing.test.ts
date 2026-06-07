import { describe, it, expect } from "vitest";
import {
  determineRoute,
  canNavigateToStep,
  getFirstIncompleteStep,
} from "./routing";
import { OnboardingState } from "./state";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function makeState(
  overrides: Partial<OnboardingState> = {}
): OnboardingState {
  return {
    tenantId: "test-tenant",
    status: "in_progress",
    steps: {
      integration_created: { completed: false },
      pipeline_configured: { completed: false },
      first_event_received: { completed: false },
    },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── determineRoute ────────────────────────────────────────────────────────────

describe("determineRoute", () => {
  it("routes to dashboard when status is completed", () => {
    const state = makeState({ status: "completed" });
    expect(determineRoute(state)).toEqual({ type: "dashboard" });
  });

  it("routes to dashboard when all steps are complete regardless of status", () => {
    const state = makeState({
      status: "in_progress",
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: true, completedAt: "2024-01-01T02:00:00Z" },
        first_event_received: { completed: true, completedAt: "2024-01-01T03:00:00Z" },
      },
    });
    expect(determineRoute(state)).toEqual({ type: "dashboard" });
  });

  it("routes to dashboard_with_banner when skipped and banner not dismissed", () => {
    const state = makeState({
      status: "skipped",
      bannerDismissed: false,
    });
    expect(determineRoute(state)).toEqual({ type: "dashboard_with_banner" });
  });

  it("routes to dashboard_with_banner when skipped and bannerDismissed is undefined", () => {
    const state = makeState({
      status: "skipped",
    });
    // bannerDismissed is undefined (falsy)
    expect(determineRoute(state)).toEqual({ type: "dashboard_with_banner" });
  });

  it("routes to dashboard when skipped and banner is dismissed", () => {
    const state = makeState({
      status: "skipped",
      bannerDismissed: true,
    });
    expect(determineRoute(state)).toEqual({ type: "dashboard" });
  });

  it("routes to first incomplete step when in_progress with no steps done", () => {
    const state = makeState({ status: "in_progress" });
    expect(determineRoute(state)).toEqual({
      type: "onboarding",
      step: "integration_created",
    });
  });

  it("routes to pipeline_configured when integration_created is complete", () => {
    const state = makeState({
      status: "in_progress",
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: false },
        first_event_received: { completed: false },
      },
    });
    expect(determineRoute(state)).toEqual({
      type: "onboarding",
      step: "pipeline_configured",
    });
  });

  it("routes to first_event_received when first two steps are complete", () => {
    const state = makeState({
      status: "in_progress",
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: true, completedAt: "2024-01-01T02:00:00Z" },
        first_event_received: { completed: false },
      },
    });
    expect(determineRoute(state)).toEqual({
      type: "onboarding",
      step: "first_event_received",
    });
  });
});

// ─── canNavigateToStep ─────────────────────────────────────────────────────────

describe("canNavigateToStep", () => {
  it("allows navigation to the first step with no prerequisites", () => {
    const state = makeState();
    expect(canNavigateToStep(state, "integration_created")).toBe(true);
  });

  it("blocks navigation to pipeline_configured when integration_created is incomplete", () => {
    const state = makeState();
    expect(canNavigateToStep(state, "pipeline_configured")).toBe(false);
  });

  it("allows navigation to pipeline_configured when integration_created is complete", () => {
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: false },
        first_event_received: { completed: false },
      },
    });
    expect(canNavigateToStep(state, "pipeline_configured")).toBe(true);
  });

  it("blocks navigation to first_event_received when pipeline_configured is incomplete", () => {
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: false },
        first_event_received: { completed: false },
      },
    });
    expect(canNavigateToStep(state, "first_event_received")).toBe(false);
  });

  it("allows navigation to first_event_received when both preceding steps are complete", () => {
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: true, completedAt: "2024-01-01T02:00:00Z" },
        first_event_received: { completed: false },
      },
    });
    expect(canNavigateToStep(state, "first_event_received")).toBe(true);
  });

  it("allows navigation to any step when all steps are complete", () => {
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: true, completedAt: "2024-01-01T02:00:00Z" },
        first_event_received: { completed: true, completedAt: "2024-01-01T03:00:00Z" },
      },
    });
    expect(canNavigateToStep(state, "integration_created")).toBe(true);
    expect(canNavigateToStep(state, "pipeline_configured")).toBe(true);
    expect(canNavigateToStep(state, "first_event_received")).toBe(true);
  });
});

// ─── getFirstIncompleteStep ────────────────────────────────────────────────────

describe("getFirstIncompleteStep", () => {
  it("returns integration_created when no steps are complete", () => {
    const state = makeState();
    expect(getFirstIncompleteStep(state)).toBe("integration_created");
  });

  it("returns pipeline_configured when only first step is complete", () => {
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: false },
        first_event_received: { completed: false },
      },
    });
    expect(getFirstIncompleteStep(state)).toBe("pipeline_configured");
  });

  it("returns first_event_received when first two steps are complete", () => {
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: true, completedAt: "2024-01-01T02:00:00Z" },
        first_event_received: { completed: false },
      },
    });
    expect(getFirstIncompleteStep(state)).toBe("first_event_received");
  });

  it("returns null when all steps are complete", () => {
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: true, completedAt: "2024-01-01T02:00:00Z" },
        first_event_received: { completed: true, completedAt: "2024-01-01T03:00:00Z" },
      },
    });
    expect(getFirstIncompleteStep(state)).toBeNull();
  });

  it("returns the first step in sequence order even if a later step is incomplete", () => {
    // Edge case: step 1 and 3 complete, step 2 not (shouldn't happen but test the logic)
    const state = makeState({
      steps: {
        integration_created: { completed: true, completedAt: "2024-01-01T01:00:00Z" },
        pipeline_configured: { completed: false },
        first_event_received: { completed: true, completedAt: "2024-01-01T03:00:00Z" },
      },
    });
    expect(getFirstIncompleteStep(state)).toBe("pipeline_configured");
  });
});
