"use client";

/**
 * Onboarding Resume Banner
 *
 * Displays a dismissible banner on the dashboard when a user has skipped
 * onboarding. Offers the option to resume setup or permanently dismiss.
 *
 * Requirements: 7.3, 7.4
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface OnboardingState {
  status: "in_progress" | "completed" | "skipped";
  bannerDismissed?: boolean;
  steps: {
    integration_created: { completed: boolean };
    pipeline_configured: { completed: boolean };
    first_event_received: { completed: boolean };
  };
}

const STEP_PATHS: Record<string, string> = {
  integration_created: "/onboarding/integration",
  pipeline_configured: "/onboarding/pipeline",
  first_event_received: "/onboarding/event",
};

const STEP_ORDER = [
  "integration_created",
  "pipeline_configured",
  "first_event_received",
] as const;

export function OnboardingBanner() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    async function checkState() {
      try {
        const res = await fetch("/api/onboarding/state", {
          credentials: "include",
        });
        if (!res.ok) return;

        const state: OnboardingState = await res.json();
        if (state.status === "skipped" && !state.bannerDismissed) {
          setVisible(true);
        }
      } catch {
        // Fail silently — banner is non-critical
      }
    }
    checkState();
  }, []);

  async function handleResume() {
    setIsResuming(true);
    try {
      const res = await fetch("/api/onboarding/resume", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const state: OnboardingState = await res.json();
        // Find first incomplete step
        const firstIncomplete = STEP_ORDER.find(
          (step) => !state.steps[step]?.completed
        );
        const path = firstIncomplete
          ? STEP_PATHS[firstIncomplete]
          : "/onboarding/integration";
        router.push(path);
      }
    } catch {
      // Allow retry on next interaction
      setIsResuming(false);
    }
  }

  async function handleDismiss() {
    setIsDismissing(true);
    try {
      await fetch("/api/onboarding/banner/dismiss", {
        method: "POST",
        credentials: "include",
      });
      setVisible(false);
    } catch {
      // Allow retry on next interaction
      setIsDismissing(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-blue-800">
          You skipped onboarding setup. Want to complete it?
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleResume}
            disabled={isResuming}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isResuming ? "Resuming…" : "Resume Setup"}
          </button>
          <button
            onClick={handleDismiss}
            disabled={isDismissing}
            className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-md hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isDismissing ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}
