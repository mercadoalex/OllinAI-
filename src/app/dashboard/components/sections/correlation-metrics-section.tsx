"use client";

/**
 * Correlation Metrics Section Display Component
 *
 * Renders 3 metric cards: correlation rate, time-to-correlation, uncorrelated count.
 * Includes trend arrows for rate and uncorrelated count.
 *
 * Requirements: 2.1
 */

import type { CorrelationMetricsResponse } from "@/lib/metrics/computers/types";
import type { TrendIndicator } from "@/lib/metrics/utils";

export interface CorrelationMetricsSectionProps {
  data: CorrelationMetricsResponse;
}

function TrendArrow({ trend }: { trend: TrendIndicator }) {
  if (trend.direction === "improving") {
    return <span className="text-green-600 text-sm ml-1">↑</span>;
  }
  if (trend.direction === "degrading") {
    return <span className="text-red-600 text-sm ml-1">↓</span>;
  }
  return <span className="text-gray-400 text-sm ml-1">—</span>;
}

export function CorrelationMetricsSection({ data }: CorrelationMetricsSectionProps) {
  const {
    correlationRate,
    averageTimeToCorrelation,
    uncorrelatedCount,
    correlationRateTrend,
    uncorrelatedTrend,
    note,
  } = data;

  return (
    <div className="space-y-3">
      {note && (
        <p className="text-xs text-gray-500 italic">{note}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Correlation Rate */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Correlation Rate
          </p>
          <p className="text-2xl font-bold text-gray-900">
            {correlationRate.toFixed(1)}%
            <TrendArrow trend={correlationRateTrend} />
          </p>
        </div>

        {/* Time to Correlation */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Avg Time to Correlation
          </p>
          <p className="text-2xl font-bold text-gray-900">
            {averageTimeToCorrelation.toFixed(0)}
            <span className="text-sm font-normal text-gray-500 ml-1">sec</span>
          </p>
        </div>

        {/* Uncorrelated Count */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Uncorrelated Incidents
          </p>
          <p className="text-2xl font-bold text-gray-900">
            {uncorrelatedCount}
            <TrendArrow trend={uncorrelatedTrend} />
          </p>
        </div>
      </div>
    </div>
  );
}
