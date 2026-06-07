import { AlertTriangle, GitCommitHorizontal, Users } from "lucide-react"
import { type Service, healthDot, healthLabel, riskBadge } from "./data"
import { relativeTime, fullTime } from "../deployments/utils"

export function ServiceCard({ service }: { service: Service }) {
  return (
    <div className="flex flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200 transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${healthDot[service.health]}`}
            aria-hidden
          />
          <div>
            <h3 className="font-semibold text-gray-900">{service.name}</h3>
            <div className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
              <Users className="h-3.5 w-3.5" />
              {service.team}
            </div>
          </div>
        </div>
        <span className="text-xs font-medium text-gray-400">{healthLabel[service.health]}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Deploys (30d)" value={String(service.deployFrequency30d)} />
        <Stat label="Change fail rate" value={`${service.changeFailureRate30d}%`} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <GitCommitHorizontal className="h-4 w-4" />
          <span title={fullTime(service.lastDeploymentAt)}>
            {relativeTime(service.lastDeploymentAt)}
          </span>
        </div>
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${riskBadge(
            service.lastRiskScore,
          )}`}
        >
          Risk {service.lastRiskScore}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-sm">
        <AlertTriangle
          className={`h-4 w-4 ${service.incidents30d > 0 ? "text-red-500" : "text-gray-300"}`}
        />
        <span className={service.incidents30d > 0 ? "text-gray-700" : "text-gray-400"}>
          {service.incidents30d} incident{service.incidents30d === 1 ? "" : "s"} (30d)
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  )
}
