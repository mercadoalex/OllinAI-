"use client"

import { earlyWarnings, scoreColor } from "./data"

export function EarlyWarnings() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Early Warnings</h2>
        <p className="text-sm text-gray-500">Services flagged by the model ahead of deploy</p>
      </div>
      <div className="flex flex-col gap-3 p-5">
        {earlyWarnings.map((w) => (
          <div
            key={w.id}
            className={`rounded-lg border-l-4 bg-gray-50 p-4 ${
              w.level === "block" ? "border-red-500" : "border-orange-400"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-mono text-sm font-medium text-gray-900">{w.service}</span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  w.level === "block" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"
                }`}
              >
                {w.level === "block" ? "Block Recommended" : "Warn"}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-600">{w.reason}</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full ${scoreColor(w.predictionScore)}`}
                  style={{ width: `${w.predictionScore * 100}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono text-xs text-gray-500">
                {w.predictionScore.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
