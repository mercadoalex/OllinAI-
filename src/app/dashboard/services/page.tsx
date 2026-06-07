"use client"

import { useMemo, useState } from "react"
import { Plus, Search, Server } from "lucide-react"
import { SERVICES, type Service, type Health } from "./data"
import { ServiceCard } from "./service-card"
import { RegisterServiceModal } from "./register-service-modal"

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>(SERVICES)
  const [query, setQuery] = useState("")
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return services
    return services.filter(
      (s) => s.name.toLowerCase().includes(q) || s.team.toLowerCase().includes(q),
    )
  }, [services, query])

  const totalCount = services.length
  const atRiskCount = services.filter((s) => s.health === "at-risk").length
  const unassignedCount = services.filter((s) => !s.team || s.team === "Unassigned").length

  function createService(name: string, team: string) {
    const health: Health = team === "Unassigned" ? "degraded" : "healthy"
    setServices((prev) => [
      {
        id: `svc_${Date.now()}`,
        name,
        team,
        health,
        deployFrequency30d: 0,
        changeFailureRate30d: 0,
        lastDeploymentAt: new Date().toISOString(),
        lastRiskScore: 0,
        incidents30d: 0,
      },
      ...prev,
    ])
    setModalOpen(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Services</h1>
            <p className="mt-1 text-sm text-gray-500">
              Service registry, ownership, and deployment health
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            Register Service
          </button>
        </div>

        {/* Search */}
        <div className="mt-6 relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or team"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          />
        </div>

        {/* Summary row */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard label="Total services" value={totalCount} />
          <SummaryCard label="Services at risk" value={atRiskCount} accent="red" />
          <SummaryCard label="Unassigned services" value={unassignedCount} accent="yellow" />
        </div>

        {/* Grid / empty state */}
        {filtered.length === 0 ? (
          <div className="mt-12 flex flex-col items-center justify-center rounded-xl bg-white py-16 text-center ring-1 ring-gray-200">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <Server className="h-6 w-6 text-gray-400" />
            </div>
            <p className="mt-4 text-sm font-medium text-gray-900">
              {services.length === 0 ? "No services registered yet" : "No services match your search"}
            </p>
            {services.length === 0 && (
              <button
                onClick={() => setModalOpen(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <Plus className="h-4 w-4" />
                Register Service
              </button>
            )}
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        )}
      </div>

      <RegisterServiceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={createService}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: "red" | "yellow"
}) {
  const accentColor =
    accent === "red" ? "text-red-600" : accent === "yellow" ? "text-amber-600" : "text-gray-900"
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${accentColor}`}>{value}</div>
    </div>
  )
}
