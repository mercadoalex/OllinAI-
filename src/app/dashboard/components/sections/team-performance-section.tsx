"use client";

/**
 * Team Performance Section Display Component
 *
 * Renders team list with CFR%, deploy frequency, and risk profile color dots.
 * Sorted descending by CFR.
 *
 * Requirements: 3.1
 */

import type { TeamPerformanceResponse } from "@/lib/metrics/computers/types";

export interface TeamPerformanceSectionProps {
  data: TeamPerformanceResponse;
}

const RISK_DOT_COLORS: Record<string, string> = {
  low: "bg-green-400",
  medium: "bg-yellow-400",
  high: "bg-orange-400",
  critical: "bg-red-500",
};

export function TeamPerformanceSection({ data }: TeamPerformanceSectionProps) {
  const { teams } = data;

  if (teams.length === 0) {
    return <p className="text-sm text-gray-400">No team data available</p>;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                Team
              </th>
              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                CFR%
              </th>
              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                Deploy Freq
              </th>
              <th className="text-center px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                Risk Profile
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.teamId} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-700 font-medium">
                  {team.teamName}
                  {team.insufficientData && (
                    <span className="ml-2 text-xs text-gray-400">(insufficient data)</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-gray-900">
                  {team.insufficientData ? "—" : `${team.changeFailureRate.toFixed(1)}%`}
                </td>
                <td className="px-4 py-2 text-right text-gray-900">
                  {team.insufficientData ? "—" : team.deploymentFrequency.toFixed(2)}
                </td>
                <td className="px-4 py-2">
                  {team.insufficientData ? (
                    <span className="text-center block text-gray-400">—</span>
                  ) : (
                    <div className="flex items-center justify-center gap-1">
                      {(["low", "medium", "high", "critical"] as const).map((level) => {
                        const count = team.riskProfile[level];
                        if (count === 0) return null;
                        return (
                          <span
                            key={level}
                            className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${RISK_DOT_COLORS[level]}`}
                            title={`${level}: ${count}`}
                          >
                            {count}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
