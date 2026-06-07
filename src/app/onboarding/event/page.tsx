"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type EventOption = "test" | "real" | null;

export default function EventPage() {
  const router = useRouter();
  const [selectedOption, setSelectedOption] = useState<EventOption>(null);
  const [testSending, setTestSending] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState("");
  const [polling, setPolling] = useState(false);
  const [pollElapsed, setPollElapsed] = useState(0);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [completing, setCompleting] = useState(false);

  const POLL_INTERVAL_MS = 5000;
  const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  function getIntegrationId(): string | null {
    if (typeof window !== "undefined") {
      return localStorage.getItem("onboarding_integrationId");
    }
    return null;
  }

  async function markStepComplete() {
    setCompleting(true);
    try {
      await fetch("/api/onboarding/steps/first_event_received", {
        method: "PUT",
        credentials: "include",
      });
    } catch {
      // Continue anyway
    }
    router.push("/onboarding/complete");
  }

  async function handleSendTestEvent() {
    setTestSending(true);
    setTestError("");
    setTestSuccess(false);

    const integrationId = getIntegrationId();

    try {
      const res = await fetch("/api/onboarding/test-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ integrationId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Test event failed");
      }

      setTestSuccess(true);
      // Auto-proceed after success
      setTimeout(() => {
        markStepComplete();
      }, 1500);
    } catch (err: any) {
      setTestError(err.message || "Failed to send test event. Please try again.");
    } finally {
      setTestSending(false);
    }
  }

  function startPolling() {
    setPolling(true);
    setPollElapsed(0);
    setPollTimedOut(false);

    const startTime = Date.now();

    pollIntervalRef.current = setInterval(async () => {
      const elapsed = Date.now() - startTime;
      setPollElapsed(elapsed);

      if (elapsed >= POLL_TIMEOUT_MS) {
        stopPolling();
        setPollTimedOut(true);
        return;
      }

      try {
        const res = await fetch("/api/onboarding/poll", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.received) {
            stopPolling();
            markStepComplete();
          }
        }
      } catch {
        // Continue polling on error
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  }

  useEffect(() => {
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetryPolling() {
    setPollTimedOut(false);
    startPolling();
  }

  function handleSwitchToTest() {
    setPollTimedOut(false);
    setSelectedOption("test");
  }

  function formatElapsed(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  // Timeout view
  if (pollTimedOut) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-900">
            No Event Received
          </h2>
          <p className="text-sm text-gray-500">
            We waited 10 minutes but didn&apos;t receive a deployment event.
            Check your pipeline configuration or try sending a test event
            instead.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleRetryPolling}
            className="py-2.5 px-4 bg-white text-gray-900 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Retry Listening
          </button>
          <button
            onClick={handleSwitchToTest}
            className="py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Send Test Event
          </button>
        </div>
      </div>
    );
  }

  // Polling/waiting view
  if (polling) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-900">
            Waiting for Deployment Event...
          </h2>
          <p className="text-sm text-gray-500">
            Trigger a deployment from your pipeline. We&apos;ll detect it
            automatically.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 py-8">
          {/* Spinning animation */}
          <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">
            Listening... {formatElapsed(pollElapsed)} elapsed
          </p>
          <p className="text-xs text-gray-400">
            Timeout in {formatElapsed(POLL_TIMEOUT_MS - pollElapsed)}
          </p>
        </div>

        <button
          onClick={stopPolling}
          className="w-full py-2.5 px-4 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          Cancel
        </button>
      </div>
    );
  }

  // Test event success view
  if (testSuccess) {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-green-600"
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
        <h2 className="text-xl font-bold text-gray-900">Event Received!</h2>
        <p className="text-sm text-gray-500">
          Redirecting to completion...
        </p>
      </div>
    );
  }

  // Main option selection view
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-gray-900">
          Verify Your Integration
        </h2>
        <p className="text-sm text-gray-500">
          Choose how you&apos;d like to verify that events are flowing from your
          pipeline to OllinAI.
        </p>
      </div>

      {testError && (
        <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg">
          {testError}
        </div>
      )}

      {/* Option cards */}
      <div className="grid grid-cols-1 gap-3">
        {/* Send Test Event card */}
        <button
          onClick={() => setSelectedOption("test")}
          className={`p-4 rounded-lg border-2 text-left transition-colors ${
            selectedOption === "test"
              ? "border-gray-900 bg-gray-50"
              : "border-gray-200 hover:border-gray-300"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧪</span>
            <div>
              <div className="font-medium text-gray-900">Send Test Event</div>
              <div className="text-sm text-gray-500">
                Send a simulated deployment event to verify your connection
              </div>
            </div>
          </div>
        </button>

        {/* Wait for Real Deployment card */}
        <button
          onClick={() => setSelectedOption("real")}
          className={`p-4 rounded-lg border-2 text-left transition-colors ${
            selectedOption === "real"
              ? "border-gray-900 bg-gray-50"
              : "border-gray-200 hover:border-gray-300"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <div>
              <div className="font-medium text-gray-900">
                Wait for Real Deployment
              </div>
              <div className="text-sm text-gray-500">
                Trigger a deployment from your pipeline and we&apos;ll detect it
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Action button */}
      {selectedOption === "test" && (
        <button
          onClick={handleSendTestEvent}
          disabled={testSending}
          className="w-full py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testSending ? "Sending..." : "Send Test Event"}
        </button>
      )}

      {selectedOption === "real" && (
        <button
          onClick={startPolling}
          className="w-full py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          Start Listening
        </button>
      )}
    </div>
  );
}
