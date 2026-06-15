"use client";

/**
 * Risk Metrics Section Display Component
 *
 * Renders risk distribution bars, high/critical trend list, and average by service.
 *
 * Requirements: 1.1, 1.2, 1.3
 */

import type { RiskMetricsResponse } from "@/lib/metrics/computers/types";

export interface RiskMetricsSectionProps {
  data: RiskMetricsResponse;
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-400",
  medium: "bg-yellow-400",
  high: "bg-orange-400",
  critical: "bg-red-500",
};

const RISK_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function RiskMetricsSection({ data }: RiskMetricsSectionProps) {
  const { distribution, trend, averageByService } = data;
  const totalDist = distribution.low + distribution.medium + distribution.high + distribution.critical;
  const maxDist = Math.max(distribution.low, distribution.medium, distribution.high, distribution.critical, 1);

  return (
    <div className="space-y-6">
      {/* Risk Distribution */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-600 mb-3">Risk Distribution</h3>
        <div className="space-y-2">
          {(["low", "medium", "high", "critical"] as const).map((level) => {
            const count = distribution[level];
            const widthPercent = (count / maxDist) * 100;
            return (
              <div key={level} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-14">{RISK_LABELS[level]}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full ${RISK_COLORS[level]} rounded transition-all`}
                    style={{ width: `${Math.max(widthPercent, 2)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-700 w-8 text-right">{count}</span>
              </div>
            );
          })}
        </div>
        {totalDist > 0 && (
          <p className="text-xs text-gray-400 mt-2 text-right">Total: {totalDist}</p>
        )}
      </div>

      {/* High/Critical Trend (last 7 days) */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-600 mb-3">High/Critical Trend (Daily)</h3>
        {trend.length === 0 ? (
          <p className="text-xs text-gray-400">No trend data available</p>
        ) : (
          <ul className="space-y-1">
            {trend.slice(-7).map((entry) => (
              <li key={entry.date} className="flex justify-between text-xs">
                <span className="text-gray-500">{entry.date}</span>
                <span className={`font-medium ${entry.highCriticalCount > 0 ? "text-red-600" : "text-gray-400"}`}>
                  {entry.highCriticalCount} high/critical
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Average by Service (top 5) */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-600 mb-3">Average Risk by Service (Top 5)</h3>
        {averageByService.length === 0 ? (
          <p className="text-xs text-gray-400">No service data available</p>
        ) : (
          <ul className="space-y-2">
            {averageByService.slice(0, 5).map((svc) => {
              const scorePercent = (svc.averageScore / 4) * 100;
              return (
                <li key={svc.serviceId} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate" title={svc.serviceName}>
                    {svc.serviceName}
                  </span>
                  <div className="flex-1 h-3 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-orange-400 rounded transition-all"
                      style={{ width: `${scorePercent}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-600 w-8 text-right">
                    {svc.averageScore.toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
