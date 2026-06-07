"use client"

import { summary } from "./data"

function TrendArrow({ value }: { value: number }) {
  const up = value >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-green-600" : "text-red-600"}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d={up ? "M6 2.5L10 7H8v3H4V7H2L6 2.5z" : "M6 9.5L2 5h2V2h4v3h2L6 9.5z"}
          fill="currentColor"
        />
      </svg>
      {Math.abs(value).toFixed(1)}%
    </span>
  )
}

export function SummaryRow() {
  const cards = [
    {
      label: "Prediction Accuracy",
      value: `${(summary.accuracy * 100).toFixed(1)}%`,
      extra: <TrendArrow value={summary.accuracyTrend} />,
      accent: "text-gray-900",
    },
    {
      label: "Active Early Warnings",
      value: String(summary.activeWarnings),
      extra: <span className="text-xs text-gray-400">last 1h</span>,
      accent: summary.activeWarnings > 0 ? "text-orange-600" : "text-gray-900",
    },
    {
      label: "Anomalies (24h)",
      value: String(summary.anomalies24h),
      extra: <span className="text-xs text-gray-400">detected</span>,
      accent: "text-gray-900",
    },
    {
      label: "Model Drift Score",
      value: summary.driftScore.toFixed(2),
      extra: <span className="text-xs text-gray-400">0–1.0</span>,
      accent: summary.driftScore > 0.7 ? "text-red-600" : "text-gray-900",
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">{c.label}</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className={`text-3xl font-semibold tracking-tight ${c.accent}`}>{c.value}</span>
            {c.extra}
          </div>
        </div>
      ))}
    </div>
  )
}
