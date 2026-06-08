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
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState("")
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState("")

  async function handleCreate() {
    if (!newName || !newType) return
    setCreating(true)
    setError("")

    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newName, type: newType }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to create integration")
      }

      const data = await res.json()
      setCreatedKey(data.secretKey)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  function handleCloseModal() {
    setShowModal(false)
    setNewName("")
    setNewType("")
    setCreatedKey(null)
    setError("")
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Configured integrations</h2>
          <p className="text-sm text-gray-500">Source control and CI providers sending deployment events.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
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

      {/* Add Integration Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            {createdKey ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900">Integration Created!</h3>
                <p className="mt-2 text-sm text-gray-500">Save your secret key — it won&apos;t be shown again.</p>
                <div className="mt-4 rounded-md bg-gray-900 p-3">
                  <code className="text-sm text-green-400 break-all">{createdKey}</code>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(createdKey); }}
                  className="mt-2 text-sm text-blue-600 hover:underline"
                >
                  Copy to clipboard
                </button>
                <button
                  onClick={handleCloseModal}
                  className="mt-4 w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900">Add Integration</h3>
                <p className="mt-1 text-sm text-gray-500">Connect a CI/CD pipeline to OllinAI.</p>

                {error && (
                  <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
                )}

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="my-production-pipeline"
                      className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Type</label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    >
                      <option value="">Select a platform...</option>
                      <option value="github_actions">GitHub Actions</option>
                      <option value="gitlab_ci">GitLab CI</option>
                      <option value="jenkins">Jenkins</option>
                      <option value="circleci">CircleCI</option>
                      <option value="harness">Harness</option>
                      <option value="azure_devops">Azure DevOps</option>
                      <option value="argocd">ArgoCD</option>
                      <option value="custom">Custom Webhook</option>
                    </select>
                  </div>
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={handleCloseModal}
                    className="flex-1 rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newName || !newType || creating}
                    className="flex-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
