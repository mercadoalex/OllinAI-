"use client";

import { AlertTriangle, Activity, Clock, GitMerge } from "lucide-react";
import type { Incident } from "./data";
import { incidentDurationMinutes } from "./data";

interface StatsRowProps {
  incidents: Incident[];
  now: number;
}

export function StatsRow({ incidents, now }: StatsRowProps) {
  const total = incidents.length;
  const open = incidents.filter((i) => i.resolvedAt === null).length;

  const resolved = incidents.filter((i) => i.resolvedAt !== null);
  const avgMttrHours =
    resolved.length > 0
      ? resolved.reduce((sum, i) => sum + incidentDurationMinutes(i, now), 0) /
        resolved.length /
        60
      : 0;

  const correlated = incidents.filter((i) => i.correlation === "correlated").length;
  const correlationRate = total > 0 ? Math.round((correlated / total) * 100) : 0;

  const cards = [
    {
      label: "Total incidents",
      value: total.toString(),
      icon: Activity,
      accent: "text-gray-900",
      iconBg: "bg-gray-100 text-gray-600",
    },
    {
      label: "Open / unresolved",
      value: open.toString(),
      icon: AlertTriangle,
      accent: "text-red-600",
      iconBg: "bg-red-50 text-red-600",
    },
    {
      label: "Avg MTTR",
      value: `${avgMttrHours.toFixed(1)}h`,
      icon: Clock,
      accent: "text-gray-900",
      iconBg: "bg-gray-100 text-gray-600",
    },
    {
      label: "Correlation rate",
      value: `${correlationRate}%`,
      icon: GitMerge,
      accent: "text-blue-600",
      iconBg: "bg-blue-50 text-blue-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-md ${card.iconBg}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-gray-500">{card.label}</p>
              <p className={`text-2xl font-semibold tabular-nums ${card.accent}`}>{card.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
