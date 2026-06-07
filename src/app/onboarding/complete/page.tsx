"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export default function CompletePage() {
  const { update: updateSession } = useSession();
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    // Refresh the session to update onboardingComplete claim in JWT
    async function refreshAndRedirect() {
      try {
        await updateSession(); // Triggers JWT callback with trigger="update"
      } catch {}
      // Use full page navigation so middleware gets the fresh token
      const timeout = setTimeout(() => {
        window.location.href = "/dashboard";
      }, 3000);
      return () => clearTimeout(timeout);
    }
    refreshAndRedirect();
  }, [updateSession]);

  useEffect(() => {
    // Try to fetch tenant name for personalization
    async function fetchState() {
      try {
        const res = await fetch("/api/onboarding/state", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.tenantName) {
            setTenantName(data.tenantName);
          }
        }
      } catch {
        // Not critical — display without tenant name
      }
    }
    fetchState();
  }, []);

  function handleGoToDashboard() {
    window.location.href = "/dashboard";
  }

  return (
    <div className="space-y-8 text-center py-8">
      {/* Celebration */}
      <div className="text-6xl">🎉</div>

      {/* Heading */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">
          {tenantName
            ? `${tenantName} is ready!`
            : "OllinAI is ready!"}
        </h1>
        <p className="text-sm text-gray-500">
          Your pipeline is connected and deployment events are flowing.
          You&apos;re all set to start tracking deployment risk and DORA metrics.
        </p>
      </div>

      {/* CTA Button */}
      <button
        onClick={handleGoToDashboard}
        className="w-full max-w-xs mx-auto py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
      >
        Go to Dashboard
      </button>

      {/* Auto-redirect notice */}
      <p className="text-xs text-gray-400">
        Redirecting to dashboard in a few seconds...
      </p>
    </div>
  );
}
