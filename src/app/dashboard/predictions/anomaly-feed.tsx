"use client"

import { Activity, AlertTriangle, TrendingUp, Cpu, GitCommit } from "lucide-react"
import { anomalies, relativeTime, fullTime, type AnomalyType } from "./data"

const typeMeta: Record<AnomalyType, { icon: typeof Activity; tint: string }> = {
  latency: { icon: Activity, tint: "bg-blue-100 text-blue-600" },
  error_rate: { icon: AlertTriangle, tint: "bg-red-100 text-red-600" },
  traffic: { icon: TrendingUp, tint: "bg-amber-100 text-amber-600" },
  resource: { icon: Cpu, tint: "bg-purple-100 text-purple-600" },
  deploy_frequency: { icon: GitCommit, tint: "bg-teal-100 text-teal-600" },
}

export function AnomalyFeed() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Anomaly Detection</h2>
        <p className="text-sm text-gray-500">Last 5 statistical anomalies across services</p>
      </div>
      <ol className="flex flex-col p-5">
        {anomalies.map((a, i) => {
          const meta = typeMeta[a.type]
          const Icon = meta.icon
          const last = i === anomalies.length - 1
          return (
            <li key={a.id} className="relative flex gap-4 pb-6 last:pb-0">
              {!last && <span className="absolute left-[15px] top-9 bottom-0 w-px bg-gray-200" aria-hidden="true" />}
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tint}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-gray-900">{a.description}</p>
                  <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-medium text-gray-700">
                    {a.deviation}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-mono">{a.service}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={a.timestamp} title={fullTime(a.timestamp)}>
                    {relativeTime(a.timestamp)}
                  </time>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
