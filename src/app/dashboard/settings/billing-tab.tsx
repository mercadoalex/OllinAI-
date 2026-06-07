"use client"

import { Check } from "lucide-react"
import {
  currentPlan,
  planTiers,
  planFeatures,
  usage,
  type PlanTier,
} from "./data"

function UsageMeter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit?: string }) {
  const pct = Math.min(100, Math.round((used / limit) * 100))
  const high = pct >= 80
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="font-mono text-gray-900">
          {used.toLocaleString()}
          {unit ? ` ${unit}` : ""} / {limit.toLocaleString()}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${high ? "bg-red-500" : "bg-gray-900"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function BillingTab() {
  return (
    <div className="flex flex-col gap-8">
      {/* Current plan + usage */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-gray-900 bg-white p-5 ring-1 ring-gray-900">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Current plan</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{currentPlan}</p>
          <p className="mt-1 text-sm text-gray-500">
            Your workspace is on the {currentPlan} tier. Upgrade for more services and API capacity.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="mb-4 text-sm font-semibold text-gray-900">Usage this month</p>
          <div className="flex flex-col gap-4">
            <UsageMeter label="Services used" used={usage.servicesUsed} limit={usage.servicesLimit} />
            <UsageMeter label="API calls" used={usage.apiCalls} limit={usage.apiCallsLimit} />
          </div>
        </div>
      </div>

      {/* Feature comparison */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="px-5 py-3 font-semibold text-gray-900">Features</th>
              {planTiers.map((tier) => (
                <th
                  key={tier.name}
                  className={`px-5 py-3 ${tier.name === currentPlan ? "bg-gray-50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{tier.name}</span>
                    {tier.name === currentPlan && (
                      <span className="rounded bg-gray-900 px-1.5 py-0.5 text-xs font-medium text-white">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-normal text-gray-500">
                    <span className="text-base font-bold text-gray-900">{tier.price}</span>
                    {tier.cadence}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {planFeatures.map((row) => (
              <tr key={row.feature}>
                <td className="px-5 py-3 text-gray-700">{row.feature}</td>
                {planTiers.map((tier) => (
                  <td
                    key={tier.name}
                    className={`px-5 py-3 text-gray-900 ${tier.name === currentPlan ? "bg-gray-50" : ""}`}
                  >
                    {row.values[tier.name as PlanTier] === "Included" ? (
                      <Check className="h-4 w-4 text-green-600" aria-label="Included" />
                    ) : (
                      row.values[tier.name as PlanTier]
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="px-5 py-4" />
              {planTiers.map((tier) => (
                <td key={tier.name} className={`px-5 py-4 ${tier.name === currentPlan ? "bg-gray-50" : ""}`}>
                  {tier.name === currentPlan ? (
                    <span className="text-sm text-gray-400">Your plan</span>
                  ) : tier.name === "Enterprise" ? (
                    <button
                      type="button"
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Contact Sales
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      Upgrade
                    </button>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
