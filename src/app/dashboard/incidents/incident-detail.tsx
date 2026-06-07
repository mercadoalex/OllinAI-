"use client";

import { GitCommit, CircleDot, CheckCircle2 } from "lucide-react";
import { relativeTime, fullTime } from "../deployments/utils";
import { type Incident, incidentDurationMinutes, formatDuration } from "./data";

interface IncidentDetailProps {
  incident: Incident;
  now: number;
}

function riskBadge(score: number): { bg: string; text: string } {
  if (score >= 80) return { bg: "bg-red-50", text: "text-red-700" };
  if (score >= 60) return { bg: "bg-orange-50", text: "text-orange-700" };
  if (score >= 35) return { bg: "bg-amber-50", text: "text-amber-700" };
  return { bg: "bg-emerald-50", text: "text-emerald-700" };
}

export function IncidentDetail({ incident, now }: IncidentDetailProps) {
  const hasDeployments = incident.deployments.length > 0;

  return (
    <div className="grid gap-6 px-6 py-5 lg:grid-cols-2">
      {/* Correlated deployments */}
      <section>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Correlated deployments
        </h4>
        {hasDeployments ? (
          <ul className="space-y-2">
            {incident.deployments.map((dep) => {
              const badge = riskBadge(dep.riskScore);
              return (
                <li
                  key={dep.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <GitCommit className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-gray-700">{dep.id}</p>
                      <p className="truncate text-xs text-gray-500">
                        {dep.service} · {dep.author}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${badge.bg} ${badge.text}`}
                    >
                      {dep.riskScore}
                    </span>
                    <time
                      dateTime={dep.timestamp}
                      title={fullTime(dep.timestamp)}
                      className="text-xs text-gray-400"
                    >
                      {relativeTime(dep.timestamp, now)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
            No deployments correlated to this incident.
          </p>
        )}
      </section>

      {/* Timeline */}
      <section>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Timeline
        </h4>
        <Timeline incident={incident} now={now} />
      </section>
    </div>
  );
}

function Timeline({ incident, now }: { incident: Incident; now: number }) {
  const firstDeploy = incident.deployments[0];
  const duration = incidentDurationMinutes(incident, now);

  const steps = [
    firstDeploy && {
      icon: GitCommit,
      iconClass: "text-blue-600 bg-blue-50",
      label: "Deployment",
      sub: `${firstDeploy.service} · ${firstDeploy.author}`,
      time: firstDeploy.timestamp,
    },
    {
      icon: CircleDot,
      iconClass: "text-red-600 bg-red-50",
      label: "Incident detected",
      sub: incident.title,
      time: incident.detectedAt,
    },
    {
      icon: CheckCircle2,
      iconClass: incident.resolvedAt
        ? "text-emerald-600 bg-emerald-50"
        : "text-amber-600 bg-amber-50",
      label: incident.resolvedAt ? "Resolved" : "Ongoing",
      sub: incident.resolvedAt ? `Duration ${formatDuration(duration)}` : "Not yet resolved",
      time: incident.resolvedAt,
    },
  ].filter(Boolean) as {
    icon: typeof GitCommit;
    iconClass: string;
    label: string;
    sub: string;
    time: string | null;
  }[];

  return (
    <ol className="relative space-y-4">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isLast = i === steps.length - 1;
        return (
          <li key={step.label} className="relative flex gap-3">
            {!isLast && (
              <span
                className="absolute left-[15px] top-8 h-[calc(100%-8px)] w-px bg-gray-200"
                aria-hidden="true"
              />
            )}
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${step.iconClass}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-medium text-gray-900">{step.label}</p>
              <p className="truncate text-xs text-gray-500">{step.sub}</p>
              {step.time && (
                <time
                  dateTime={step.time}
                  title={fullTime(step.time)}
                  className="text-xs text-gray-400"
                >
                  {fullTime(step.time)}
                </time>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
