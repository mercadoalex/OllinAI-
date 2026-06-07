"use client"

import { useState } from "react"
import { IntegrationsTab } from "./integrations-tab"
import { RiskWeightsTab } from "./risk-weights-tab"
import { BillingTab } from "./billing-tab"

type Tab = "integrations" | "risk" | "billing"

const tabs: { id: Tab; label: string }[] = [
  { id: "integrations", label: "Integrations" },
  { id: "risk", label: "Risk Weights" },
  { id: "billing", label: "Billing" },
]

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("integrations")

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage integrations, risk model configuration, and your billing plan.
          </p>
        </header>

        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-6" role="tablist" aria-label="Settings sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div>
          {tab === "integrations" && <IntegrationsTab />}
          {tab === "risk" && <RiskWeightsTab />}
          {tab === "billing" && <BillingTab />}
        </div>
      </div>
    </div>
  )
}
