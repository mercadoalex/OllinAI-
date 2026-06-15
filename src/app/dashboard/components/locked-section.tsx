"use client";

/**
 * LockedSection Component
 *
 * Displays a locked state for tier-restricted metric sections.
 * Shows the section name, required tier, and an upgrade CTA.
 *
 * Requirements: 9.4
 */

export interface LockedSectionProps {
  /** Name of the locked section */
  sectionName: string;
  /** Tier required to unlock this section */
  requiredTier: string;
}

export function LockedSection({ sectionName, requiredTier }: LockedSectionProps) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center bg-gray-50">
      <div className="text-4xl mb-3" aria-hidden="true">
        🔒
      </div>
      <h3 className="text-lg font-semibold text-gray-700 mb-1">
        {sectionName}
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        Requires {requiredTier} plan
      </p>
      <a
        href="/dashboard/settings"
        className="inline-block px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
      >
        Upgrade
      </a>
    </div>
  );
}
