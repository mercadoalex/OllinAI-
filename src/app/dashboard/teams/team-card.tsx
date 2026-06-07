import { Users } from "lucide-react"
import { type Team, avatarColor, initials, healthStyles } from "./data"

function cfrColor(rate: number): string {
  if (rate < 5) return "text-emerald-600"
  if (rate < 12) return "text-amber-600"
  return "text-rose-600"
}

export function TeamCard({ team }: { team: Team }) {
  const health = healthStyles[team.health]
  const shownMembers = team.members.slice(0, 4)
  const extraMembers = team.members.length - shownMembers.length
  const shownServices = team.ownedServices.slice(0, 4)
  const extraServices = team.ownedServices.length - shownServices.length

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{team.name}</h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            <Users className="h-3 w-3" />
            {team.members.length}
          </span>
        </div>
        <span
          className={`mt-1 h-2.5 w-2.5 rounded-full ${health.dot}`}
          title={health.label}
          aria-label={`Health: ${health.label}`}
        />
      </div>

      {/* Member initials */}
      <div className="mt-4 flex items-center">
        {shownMembers.map((m, i) => (
          <span
            key={m.email}
            title={m.name}
            className={`-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-semibold first:ml-0 ${avatarColor(i)}`}
          >
            {initials(m.name)}
          </span>
        ))}
        {extraMembers > 0 && (
          <span className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-xs font-semibold text-gray-500">
            +{extraMembers}
          </span>
        )}
      </div>

      {/* Owned services */}
      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">Owned services</p>
        {team.ownedServices.length === 0 ? (
          <p className="text-sm text-gray-400">None assigned</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shownServices.map((s) => (
              <span key={s} className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                {s}
              </span>
            ))}
            {extraServices > 0 && (
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                +{extraServices} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Mini DORA */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-4">
        <div>
          <p className="text-xs text-gray-400">Deploy freq</p>
          <p className="text-sm font-semibold text-gray-900">{team.deployFrequencyPerWeek.toFixed(1)}/wk</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Change fail</p>
          <p className={`text-sm font-semibold ${cfrColor(team.changeFailureRate)}`}>
            {team.changeFailureRate.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">MTTR</p>
          <p className="text-sm font-semibold text-gray-900">{team.mttrHours.toFixed(1)}h</p>
        </div>
      </div>
    </div>
  )
}
