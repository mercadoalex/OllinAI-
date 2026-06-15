"use client";

/**
 * Section Navigation Bar Component
 *
 * Horizontal navigation for jumping between dashboard metric sections.
 * Collapses to a dropdown on mobile viewports (< 768px).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.6
 */

import { useCallback, useEffect, useState } from "react";

export interface NavSection {
  /** Section element ID for scroll targeting */
  id: string;
  /** Display label */
  label: string;
  /** Whether this section is available for the current tier */
  available: boolean;
}

export interface SectionNavBarProps {
  /** List of all sections */
  sections: NavSection[];
  /** Currently active section ID */
  activeSection: string;
}

export function SectionNavBar({ sections, activeSection }: SectionNavBarProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleScrollTo = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  const visibleSections = sections.filter((s) => s.available);

  if (visibleSections.length === 0) return null;

  // Mobile: dropdown/select
  if (isMobile) {
    return (
      <nav className="mb-4" aria-label="Section navigation">
        <select
          value={activeSection}
          onChange={(e) => handleScrollTo(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Jump to section"
        >
          {visibleSections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </nav>
    );
  }

  // Desktop: horizontal nav
  return (
    <nav
      className="mb-6 border-b border-gray-200 overflow-x-auto"
      aria-label="Section navigation"
    >
      <ul className="flex space-x-1 -mb-px">
        {visibleSections.map((section) => {
          const isActive = section.id === activeSection;
          return (
            <li key={section.id}>
              <button
                onClick={() => handleScrollTo(section.id)}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300"
                }`}
                aria-current={isActive ? "true" : undefined}
              >
                {section.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
