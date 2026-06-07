"use client"

import { gateRows, decisionStyles, scoreColor } from "./data"

function MiniBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${scoreColor(value)}`}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="font-mono text-xs text-gray-500">{value.toFixed(2)}</span>
    </div>
  )
}

export function GateDecisions() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Deployment Gate Decisions</h2>
        <p className="text-sm text-gray-500">Combined model prediction and rule-based risk scoring</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Deployment</th>
              <th className="px-5 py-3 font-semibold">Service</th>
              <th className="px-5 py-3 font-semibold">Prediction</th>
              <th className="px-5 py-3 font-semibold">Risk</th>
              <th className="px-5 py-3 font-semibold">Combined</th>
              <th className="px-5 py-3 font-semibold">Decision</th>
              <th className="px-5 py-3 font-semibold">Contributing Factors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gateRows.map((r) => {
              const d = decisionStyles[r.decision]
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs text-gray-700">{r.deploymentId.slice(0, 12)}…</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-700">{r.service}</td>
                  <td className="px-5 py-3">
                    <MiniBar value={r.predictionScore} />
                  </td>
                  <td className="px-5 py-3">
                    <MiniBar value={r.riskScore} />
                  </td>
                  <td className="px-5 py-3 font-mono text-sm font-medium text-gray-900">
                    {r.combinedScore.toFixed(2)}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${d.badge}`}>{d.label}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.factors.map((f) => (
                        <span
                          key={f}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
