"use client";

/**
 * Service Health Section Display Component
 *
 * Renders services at risk count + list, and blast radius avg/max display.
 *
 * Requirements: 4.1
 */

import type { ServiceHealthResponse } from "@/lib/metrics/computers/types";

export interface ServiceHealthSectionProps {
  data: ServiceHealthResponse;
}

export function ServiceHealthSection({ data }: ServiceHealthSectionProps) {
  const { servicesAtRisk, blastRadius } = data;

  return (
    <div className="space-y-4">
      {/* Services at Risk */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-600">Services at Risk</h3>
          <span className="text-lg font-bold text-red-600">{servicesAtRisk.length}</span>
        </div>
        {servicesAtRisk.length === 0 ? (
          <p className="text-xs text-gray-400">No services currently at risk</p>
        ) : (
          <ul className="space-y-2">
            {servicesAtRisk.map((svc) => (
              <li
                key={svc.serviceId}
                className="flex items-center justify-between text-sm border-b border-gray-50 pb-1 last:border-0"
              >
                <span className="text-gray-700">{svc.serviceName}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {svc.highCriticalCount} high/critical
                  </span>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      svc.mostRecentRiskScore === "critical" ? "bg-red-500" : "bg-orange-400"
                    }`}
                    title={`Most recent: ${svc.mostRecentRiskScore}`}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Blast Radius */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-600 mb-3">Blast Radius</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Average</p>
            <p className="text-xl font-bold text-gray-900">
              {blastRadius.average.toFixed(1)}
              <span className="text-sm font-normal text-gray-500 ml-1">services</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Maximum</p>
            <p className="text-xl font-bold text-gray-900">
              {blastRadius.maximum}
              <span className="text-sm font-normal text-gray-500 ml-1">services</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
