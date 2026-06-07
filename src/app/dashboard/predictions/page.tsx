"use client"

import { modelStatus } from "./data"
import { SummaryRow } from "./summary-row"
import { EarlyWarnings } from "./early-warnings"
import { GateDecisions } from "./gate-decisions"
import { AnomalyFeed } from "./anomaly-feed"

function ModelStatusBadge() {
  const active = modelStatus.active
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
        active ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? "bg-green-500" : "bg-amber-500"}`} aria-hidden="true" />
      {active ? `Model Active — ${modelStatus.version}` : "Fallback: Rule Engine"}
    </span>
  )
}

export default function PredictionsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Predictive Intelligence</h1>
            <p className="mt-1 text-sm text-gray-500">ML-powered incident predictions and anomaly detection</p>
          </div>
          <ModelStatusBadge />
        </header>

        <div className="mt-8">
          <SummaryRow />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EarlyWarnings />
          </div>
          <div className="lg:col-span-1">
            <AnomalyFeed />
          </div>
        </div>

        <div className="mt-6">
          <GateDecisions />
        </div>
      </div>
    </div>
  )
}
