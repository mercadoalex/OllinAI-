"use client";

/**
 * MetricSection Wrapper Component
 *
 * Progressive loading wrapper for dashboard metric sections.
 * Handles data fetching, polling, loading/error states, and tier gating.
 *
 * Requirements: 8.5, 9.4, 9.5
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LockedSection } from "./locked-section";

/** Polling interval: 30 seconds */
const POLL_INTERVAL_MS = 30_000;

export interface MetricSectionProps {
  /** Section ID for scroll targeting */
  id: string;
  /** Section title displayed as heading */
  title: string;
  /** API endpoint to fetch section data from */
  apiEndpoint: string;
  /** Render function receiving fetched data */
  children: (data: unknown) => ReactNode;
  /** Tier required to view this section (e.g., "Pro", "Enterprise") */
  tierRequired?: string;
  /** Current tenant tier */
  currentTier: string;
}

/** Simple tier hierarchy for comparison */
const TIER_HIERARCHY: Record<string, number> = {
  starter: 0,
  pro: 1,
  enterprise: 2,
};

function hasSufficientTier(currentTier: string, requiredTier: string): boolean {
  const current = TIER_HIERARCHY[currentTier.toLowerCase()] ?? 0;
  const required = TIER_HIERARCHY[requiredTier.toLowerCase()] ?? 0;
  return current >= required;
}

export function MetricSection({
  id,
  title,
  apiEndpoint,
  children,
  tierRequired,
  currentTier,
}: MetricSectionProps) {
  const [data, setData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isLocked = Boolean(tierRequired && !hasSufficientTier(currentTier, tierRequired));

  const fetchData = useCallback(async () => {
    if (isLocked) return;
    try {
      const res = await fetch(apiEndpoint, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [apiEndpoint, isLocked]);

  // Initial fetch and polling setup
  useEffect(() => {
    if (isLocked) {
      setIsLoading(false);
      return;
    }

    fetchData();

    intervalRef.current = setInterval(() => {
      fetchData();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData, isLocked]);

  // Locked state — tier insufficient
  if (isLocked) {
    return (
      <section id={id} className="scroll-mt-16">
        <LockedSection sectionName={title} requiredTier={tierRequired!} />
      </section>
    );
  }

  // Loading skeleton
  if (isLoading && !data) {
    return (
      <section id={id} className="scroll-mt-16">
        <h2 className="text-base font-semibold text-gray-700 mb-3">{title}</h2>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
            <div className="h-4 bg-gray-200 rounded w-2/3" />
          </div>
        </div>
      </section>
    );
  }

  // Error state with retry
  if (error && !data) {
    return (
      <section id={id} className="scroll-mt-16">
        <h2 className="text-base font-semibold text-gray-700 mb-3">{title}</h2>
        <div className="bg-white rounded-lg border border-red-200 p-6 text-center">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button
            onClick={() => {
              setIsLoading(true);
              setError(null);
              fetchData();
            }}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section id={id} className="scroll-mt-16">
      <h2 className="text-base font-semibold text-gray-700 mb-3">{title}</h2>
      <div className="bg-gray-50 rounded-lg p-4">
        {data ? children(data) : null}
      </div>
    </section>
  );
}
