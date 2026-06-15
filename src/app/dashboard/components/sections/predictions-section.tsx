"use client";

/**
 * Predictions & Prevention Section Display Component
 *
 * Renders 4 metric cards: prediction accuracy, blocked, warned, FPR.
 * Shows ML inactive state when predictions are unavailable.
 *
 * Requirements: 5.1
 */

import type { PredictionsMetricsResponse } from "@/lib/metrics/computers/types";
import type { TrendIndicator } from "@/lib/metrics/utils";

export interface PredictionsSectionProps {
  data: PredictionsMetricsResponse;
}

function TrendArrow({ trend }: { trend?: TrendIndicator }) {
  if (!trend) return null;
  if (trend.direction === "improving") {
    return <span className="text-green-600 text-sm ml-1">↑</span>;
  }
  if (trend.direction === "degrading") {
    return <span className="text-red-600 text-sm ml-1">↓</span>;
  }
  return <span className="text-gray-400 text-sm ml-1">—</span>;
}

export function PredictionsSection({ data }: PredictionsSectionProps) {
  const {
    predictionAccuracy,
    blockedCount,
    warnedCount,
    falsePositiveRate,
    predictionAccuracyTrend,
    falsePositiveRateTrend,
    note,
  } = data;

  const isMLInactive = predictionAccuracy === "ml_inactive";

  if (isMLInactive) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-500 mb-1">ML Model Inactive</p>
        <p className="text-xs text-gray-400">
          {note || "The prediction model requires training data before metrics are available."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Prediction Accuracy */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Prediction Accuracy
        </p>
        <p className="text-2xl font-bold text-gray-900">
          {typeof predictionAccuracy === "number" ? `${predictionAccuracy.toFixed(1)}%` : "—"}
          <TrendArrow trend={predictionAccuracyTrend} />
        </p>
      </div>

      {/* Blocked */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Deployments Blocked
        </p>
        <p className="text-2xl font-bold text-gray-900">
          {blockedCount}
        </p>
      </div>

      {/* Warned */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Deployments Warned
        </p>
        <p className="text-2xl font-bold text-gray-900">
          {warnedCount}
        </p>
      </div>

      {/* False Positive Rate */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          False Positive Rate
        </p>
        <p className="text-2xl font-bold text-gray-900">
          {typeof falsePositiveRate === "number" ? `${falsePositiveRate.toFixed(1)}%` : "—"}
          <TrendArrow trend={falsePositiveRateTrend} />
        </p>
      </div>
    </div>
  );
}
