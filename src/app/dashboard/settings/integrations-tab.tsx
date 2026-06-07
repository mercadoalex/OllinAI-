"use client"

import { useState } from "react"
import { MoreVertical, Plus, RotateCw, Trash2, Activity } from "lucide-react"
import { sampleIntegrations, integrationTypeStyles, type Integration } from "./data"
import { relativeTime, fullTime } from "../deployments/utils"

function IntegrationCard({ integration }: { integration: Integration }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { badge, icon: Icon } = integrationTypeStyles[integration.type]

  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-50 ring-1 ring-gray-200">
        <Icon className="h-5 w-5 text-gray-600" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-gray-900">{integration.name}</p>
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge}`}>{integration.type}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
          <span
            className={`inline-block h-2 w-2 rounded-full ${integration.active ? "bg-green-500" : "bg-gray-300"}`}
            aria-hidden="true"
          />
          <span>{integration.active ? "Active" : "Inactive"}</span>
          <span className="text-gray-300">·</span>
          <span title={fullTime(integration.lastEventAt)}>Last event {relativeTime(integration.lastEventAt)}</span>
        </div>
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        Test
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          aria-label="Integration options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                Rotate Key
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Revoke
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function IntegrationsTab() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Configured integrations</h2>
          <p className="text-sm text-gray-500">Source control and CI providers sending deployment events.</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Integration
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {sampleIntegrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>
    </div>
  )
}
