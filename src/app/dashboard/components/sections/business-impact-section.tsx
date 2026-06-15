"use client";

/**
 * Business Impact Section Display Component
 *
 * Renders 3 metric cards: downtime avoided (hours), SLA compliance %, incident trend.
 *
 * Requirements: 6.1
 */

import type { BusinessImpactResponse } from "@/lib/metrics/computers/types";
import type { TrendIndicator } from "@/lib/metrics/utils";

export interface BusinessImpactSectionProps {
  data: BusinessImpactResponse;
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

export function BusinessImpactSection({ data }: BusinessImpactSectionProps) {
  const {
    estimatedDowntimeAvoided,
    slaCompliancePercentage,
    incidentTrend,
    notes,
  } = data;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Downtime Avoided */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Downtime Avoided
          </p>
          <p className="text-2xl font-bold text-gray-900">
            {estimatedDowntimeAvoided.toFixed(1)}
            <span className="text-sm font-normal text-gray-500 ml-1">hrs</span>
          </p>
          {notes?.downtimeAvoided && (
            <p className="text-xs text-gray-400 mt-1">{notes.downtimeAvoided}</p>
          )}
        </div>

        {/* SLA Compliance */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            SLA Compliance
          </p>
          <p className="text-2xl font-bold text-gray-900">
            {slaCompliancePercentage.toFixed(1)}%
          </p>
          {notes?.slaCompliance && (
            <p className="text-xs text-gray-400 mt-1">{notes.slaCompliance}</p>
          )}
        </div>

        {/* Incident Trend */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Incident Trend
          </p>
          <p className="text-2xl font-bold text-gray-900">
            {incidentTrend.direction === "improving" && "Improving"}
            {incidentTrend.direction === "degrading" && "Degrading"}
            {incidentTrend.direction === "stable" && "Stable"}
            <TrendArrow trend={incidentTrend} />
          </p>
        </div>
      </div>
    </div>
  );
}
