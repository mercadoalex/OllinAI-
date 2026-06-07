"use client";

import { useState } from "react";
import { type Deployment, RISK_STYLES } from "./data";
import { fullTime } from "./utils";

interface TimelineViewProps {
  deployments: Deployment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TimelineView({
  deployments,
  selectedId,
  onSelect,
}: TimelineViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // oldest -> newest left to right
  const ordered = [...deployments].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (ordered.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500">
        No deployments match the selected filters.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="overflow-x-auto pb-4">
        <div className="relative min-w-full" style={{ minWidth: ordered.length * 44 }}>
          {/* baseline */}
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-gray-200" />
          <div className="relative flex items-center justify-between">
            {ordered.map((d) => {
              const risk = RISK_STYLES[d.riskLevel];
              const isActive = d.id === selectedId;
              const isHovered = d.id === hoveredId;
              return (
                <div
                  key={d.id}
                  className="relative flex flex-col items-center"
                  onMouseEnter={() => setHoveredId(d.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <button
                    type="button"
                    aria-label={`Deployment ${d.id} on ${d.service}, ${risk.label} risk`}
                    onClick={() => onSelect(d.id)}
                    className={`relative z-10 rounded-full ${risk.dot} transition-transform hover:scale-125 ${
                      isActive
                        ? "h-4 w-4 ring-2 ring-gray-900 ring-offset-2"
                        : "h-3 w-3"
                    }`}
                  />
                  {(isHovered || isActive) && (
                    <div className="absolute bottom-full z-20 mb-3 w-56 -translate-x-1/2 left-1/2 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-gray-900">
                          {d.service}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${risk.badgeBg} ${risk.badgeText}`}
                        >
                          {risk.label} · {d.riskScore}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{fullTime(d.timestamp)}</p>
                      <p className="mt-1 text-xs text-gray-700">{d.author}</p>
                      <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-gray-200 bg-white" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-4">
        {(Object.keys(RISK_STYLES) as (keyof typeof RISK_STYLES)[]).map((level) => (
          <span key={level} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`h-2.5 w-2.5 rounded-full ${RISK_STYLES[level].dot}`} />
            {RISK_STYLES[level].label}
          </span>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          Oldest → newest · hover a dot for details
        </span>
      </div>
    </div>
  );
}
