"use client"

import { useMemo, useState } from "react"
import { Plus, Search, Users, UserCircle, Trophy } from "lucide-react"
import { teams as seedTeams, type Team } from "./data"
import { TeamCard } from "./team-card"
import { CreateTeamModal } from "./create-team-modal"

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>(seedTeams)
  const [query, setQuery] = useState("")
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.ownedServices.some((s) => s.toLowerCase().includes(q)) ||
        t.members.some((m) => m.name.toLowerCase().includes(q)),
    )
  }, [teams, query])

  const totalMembers = useMemo(() => teams.reduce((sum, t) => sum + t.members.length, 0), [teams])

  const topTeam = useMemo(() => {
    const ranked = teams.filter((t) => t.deployFrequencyPerWeek > 0)
    if (ranked.length === 0) return null
    return ranked.reduce((best, t) => (t.changeFailureRate < best.changeFailureRate ? t : best))
  }, [teams])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
            <p className="mt-1 text-sm text-gray-500">Team structure, service ownership, and performance</p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create Team
          </button>
        </div>

        {/* Search */}
        <div className="mt-6 max-w-md">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teams, members, or services..."
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Summary row */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            icon={<Users className="h-5 w-5 text-blue-600" />}
            label="Total teams"
            value={teams.length.toString()}
          />
          <SummaryCard
            icon={<UserCircle className="h-5 w-5 text-indigo-600" />}
            label="Total members"
            value={totalMembers.toString()}
          />
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-emerald-600" />
              <p className="text-sm font-medium text-emerald-700">Top performing team</p>
            </div>
            {topTeam ? (
              <>
                <p className="mt-2 text-lg font-bold text-emerald-900">{topTeam.name}</p>
                <p className="text-xs text-emerald-700">{topTeam.changeFailureRate.toFixed(1)}% change failure rate</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-emerald-700">No data yet</p>
            )}
          </div>
        </div>

        {/* Team cards */}
        {filtered.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
            <Users className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm font-medium text-gray-700">No teams found</p>
            <p className="text-sm text-gray-400">Try a different search or create a new team.</p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        )}
      </div>

      <CreateTeamModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={(team) => setTeams((prev) => [team, ...prev])}
      />
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-medium text-gray-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
