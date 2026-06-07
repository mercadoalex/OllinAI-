"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

type StepStatus = "completed" | "active" | "unavailable";

interface StepInfo {
  key: string;
  label: string;
  path: string;
  helpText: string;
}

const STEPS: StepInfo[] = [
  {
    key: "integration_created",
    label: "Create Integration",
    path: "/onboarding/integration",
    helpText:
      "Connect your CI/CD pipeline to OllinAI by selecting your tool and naming your integration.",
  },
  {
    key: "pipeline_configured",
    label: "Configure Pipeline",
    path: "/onboarding/pipeline",
    helpText:
      "Add the generated code snippet to your CI/CD configuration to start sending deployment events.",
  },
  {
    key: "first_event_received",
    label: "Verify Event",
    path: "/onboarding/event",
    helpText:
      "Confirm your pipeline is connected by sending a test event or triggering a real deployment.",
  },
];

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [onboardingState, setOnboardingState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [skipConfirm, setSkipConfirm] = useState(false);

  useEffect(() => {
    async function fetchState() {
      try {
        const res = await fetch("/api/onboarding/state", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setOnboardingState(data);
        }
      } catch {
        // Fail silently — layout still renders
      } finally {
        setLoading(false);
      }
    }
    fetchState();
  }, []);

  function getStepStatus(stepKey: string): StepStatus {
    if (!onboardingState?.steps) return "unavailable";

    const steps = onboardingState.steps;
    const stepIndex = STEPS.findIndex((s) => s.key === stepKey);

    if (steps[stepKey]?.completed) return "completed";

    // Active if all previous steps are complete and this one isn't
    const allPreviousComplete = STEPS.slice(0, stepIndex).every(
      (s) => steps[s.key]?.completed
    );
    if (allPreviousComplete) return "active";

    return "unavailable";
  }

  function getActiveStepIndex(): number {
    if (!onboardingState?.steps) return 0;
    for (let i = 0; i < STEPS.length; i++) {
      if (!onboardingState.steps[STEPS[i].key]?.completed) return i;
    }
    return STEPS.length - 1;
  }

  function getCurrentHelpText(): string {
    // Determine help text based on current path
    const currentStep = STEPS.find((s) => pathname?.startsWith(s.path));
    if (currentStep) return currentStep.helpText;
    // Default to the active step's help text
    return STEPS[getActiveStepIndex()]?.helpText || "";
  }

  async function handleSkip() {
    if (!skipConfirm) {
      setSkipConfirm(true);
      return;
    }

    try {
      const res = await fetch("/api/onboarding/skip", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setTimeout(() => {
          router.push("/dashboard");
        }, 200);
      }
    } catch {
      // Allow retry
    }
    setSkipConfirm(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="w-full max-w-2xl mx-auto">
        {/* Progress Stepper */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            {STEPS.map((step, index) => {
              const status = getStepStatus(step.key);
              return (
                <div key={step.key} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    {/* Step indicator */}
                    <div className="flex items-center justify-center w-8 h-8 rounded-full mb-1.5">
                      {status === "completed" ? (
                        <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                          <svg
                            className="w-4 h-4 text-white"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>
                      ) : status === "active" ? (
                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-white" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-gray-100" />
                        </div>
                      )}
                    </div>
                    {/* Step label */}
                    <span
                      className={`text-xs font-medium text-center ${
                        status === "completed"
                          ? "text-green-700"
                          : status === "active"
                          ? "text-blue-700"
                          : "text-gray-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {/* Connector line */}
                  {index < STEPS.length - 1 && (
                    <div
                      className={`h-0.5 flex-1 mx-2 mt-[-18px] ${
                        getStepStatus(STEPS[index + 1].key) !== "unavailable"
                          ? "bg-green-500"
                          : "bg-gray-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Contextual help text */}
          {pathname !== "/onboarding/complete" && (
            <p className="text-sm text-gray-500 text-center mt-2">
              {getCurrentHelpText()}
            </p>
          )}

          {/* Skip onboarding link */}
          {pathname !== "/onboarding/complete" && (
            <div className="text-center mt-3">
              {skipConfirm ? (
                <span className="text-sm text-gray-500">
                  Are you sure?{" "}
                  <button
                    onClick={handleSkip}
                    className="text-red-600 hover:text-red-700 font-medium"
                  >
                    Yes, skip
                  </button>
                  {" · "}
                  <button
                    onClick={() => setSkipConfirm(false)}
                    className="text-gray-600 hover:text-gray-700 font-medium"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={handleSkip}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Skip onboarding
                </button>
              )}
            </div>
          )}
        </div>

        {/* Page content */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
