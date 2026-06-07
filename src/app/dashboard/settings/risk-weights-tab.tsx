"use client"

import { useMemo, useState } from "react"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { riskFactors, defaultRiskWeights, type RiskFactorKey } from "./data"

export function RiskWeightsTab() {
  const [weights, setWeights] = useState<Record<RiskFactorKey, number>>({ ...defaultRiskWeights })
  const [saved, setSaved] = useState(false)

  const total = useMemo(
    () => Object.values(weights).reduce((sum, w) => sum + w, 0),
    [weights],
  )
  const isValid = Math.abs(total - 1) < 0.001

  function update(key: RiskFactorKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function reset() {
    setWeights({ ...defaultRiskWeights })
    setSaved(false)
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-900">Risk factor weights</h2>
        <p className="text-sm text-gray-500">
          Adjust how each factor contributes to the composite risk score. Weights must sum to 1.0.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {riskFactors.map((factor) => (
          <div key={factor.key}>
            <div className="mb-1.5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{factor.label}</p>
                <p className="text-xs text-gray-500">{factor.description}</p>
              </div>
              <span className="ml-4 w-12 shrink-0 text-right font-mono text-sm font-semibold text-gray-900">
                {weights[factor.key].toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights[factor.key]}
              onChange={(e) => update(factor.key, Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900"
              aria-label={`${factor.label} weight`}
            />
          </div>
        ))}
      </div>

      <div
        className={`mt-6 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
          isValid
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-red-200 bg-red-50 text-red-700"
        }`}
      >
        {isValid ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span>
          Total weight: <span className="font-mono font-semibold">{total.toFixed(2)}</span>
          {isValid ? " — valid" : ` — must equal 1.00 (off by ${(total - 1).toFixed(2)})`}
        </span>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          disabled={!isValid}
          onClick={() => setSaved(true)}
          className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save Weights
        </button>
        <button
          type="button"
          onClick={reset}
          className="text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          Reset to Defaults
        </button>
        {saved && <span className="text-sm text-green-600">Weights saved.</span>}
      </div>
    </div>
  )
}
