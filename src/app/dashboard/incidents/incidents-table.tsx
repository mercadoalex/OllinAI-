"use client";

import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { relativeTime, fullTime } from "../deployments/utils";
import {
  SEVERITY_STYLES,
  CORRELATION_STYLES,
  incidentDurationMinutes,
  formatDuration,
  type Incident,
} from "./data";
import { IncidentDetail } from "./incident-detail";

interface IncidentsTableProps {
  incidents: Incident[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  now: number;
}

export function IncidentsTable({
  incidents,
  expandedId,
  onToggle,
  now,
}: IncidentsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <th className="w-8 px-3 py-3" />
            <th className="px-3 py-3 font-semibold">Severity</th>
            <th className="px-4 py-3 font-semibold">External ID</th>
            <th className="px-4 py-3 font-semibold">Service</th>
            <th className="px-4 py-3 font-semibold">Detected</th>
            <th className="px-4 py-3 font-semibold">Resolved</th>
            <th className="px-4 py-3 font-semibold">Duration</th>
            <th className="px-4 py-3 font-semibold">Correlation</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {incidents.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                No incidents match the current filters.
              </td>
            </tr>
          )}
          {incidents.map((inc) => {
            const sev = SEVERITY_STYLES[inc.severity];
            const corr = CORRELATION_STYLES[inc.correlation];
            const expanded = expandedId === inc.id;
            const duration = incidentDurationMinutes(inc, now);

            return (
              <Fragment key={inc.id}>
                <tr
                  onClick={() => onToggle(inc.id)}
                  className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                    expanded ? "bg-gray-50" : ""
                  }`}
                >
                  <td className="px-3 py-3 text-gray-400">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${sev.dot}`} aria-hidden="true" />
                      <span className="font-medium text-gray-700">{sev.label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{inc.externalId}</td>
                  <td className="px-4 py-3 text-gray-700">{inc.service}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <time dateTime={inc.detectedAt} title={fullTime(inc.detectedAt)}>
                      {relativeTime(inc.detectedAt, now)}
                    </time>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {inc.resolvedAt ? (
                      <time dateTime={inc.resolvedAt} title={fullTime(inc.resolvedAt)}>
                        {relativeTime(inc.resolvedAt, now)}
                      </time>
                    ) : (
                      <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Open
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {inc.resolvedAt ? (
                      <span className="tabular-nums text-gray-700">
                        {formatDuration(duration)}
                      </span>
                    ) : (
                      <span className="font-medium text-amber-600">Ongoing</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${corr.bg} ${corr.text}`}
                    >
                      {corr.label}
                      {inc.correlation === "correlated" && (
                        <span className="rounded-full bg-blue-100 px-1.5 text-[10px] font-semibold text-blue-800">
                          {inc.deployments.length}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={8} className="border-t border-gray-100 p-0">
                      <IncidentDetail incident={inc} now={now} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
