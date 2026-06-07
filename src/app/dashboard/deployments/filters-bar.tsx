"use client";

import { LayoutList, GanttChartSquare } from "lucide-react";
import {
  type Environment,
  type RiskLevel,
  RISK_STYLES,
  SERVICES,
  TEAMS,
} from "./data";

export interface Filters {
  service: string;
  team: string;
  environment: Environment | "all";
  riskLevels: RiskLevel[];
  startDate: string;
  endDate: string;
}

interface FiltersBarProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  view: "timeline" | "table";
  onViewChange: (view: "timeline" | "table") => void;
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

export function FiltersBar({
  filters,
  onChange,
  view,
  onViewChange,
}: FiltersBarProps) {
  function toggleRisk(level: RiskLevel) {
    const has = filters.riskLevels.includes(level);
    onChange({
      ...filters,
      riskLevels: has
        ? filters.riskLevels.filter((l) => l !== level)
        : [...filters.riskLevels, level],
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Service">
          <select
            value={filters.service}
            onChange={(e) => onChange({ ...filters, service: e.target.value })}
            className="h-9 rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
          >
            <option value="all">All services</option>
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Team">
          <select
            value={filters.team}
            onChange={(e) => onChange({ ...filters, team: e.target.value })}
            className="h-9 rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
          >
            <option value="all">All teams</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Environment">
          <div className="flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5">
            {(["all", "production", "staging"] as const).map((env) => (
              <button
                key={env}
                type="button"
                onClick={() => onChange({ ...filters, environment: env })}
                className={`h-8 rounded px-2.5 text-xs font-medium capitalize transition-colors ${
                  filters.environment === env
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {env}
              </button>
            ))}
          </div>
        </Field>

        <Field label="From">
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => onChange({ ...filters, startDate: e.target.value })}
            className="h-9 rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </Field>

        <Field label="To">
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => onChange({ ...filters, endDate: e.target.value })}
            className="h-9 rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </Field>

        {/* View toggle pushed to the right */}
        <div className="ml-auto flex h-9 items-center self-end rounded-md border border-gray-200 bg-gray-50 p-0.5">
          <button
            type="button"
            onClick={() => onViewChange("timeline")}
            className={`flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ${
              view === "timeline"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <GanttChartSquare className="h-4 w-4" />
            Timeline
          </button>
          <button
            type="button"
            onClick={() => onViewChange("table")}
            className={`flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ${
              view === "table"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <LayoutList className="h-4 w-4" />
            Table
          </button>
        </div>
      </div>

      {/* Risk level checkboxes */}
      <div className="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Risk level
        </span>
        {RISK_ORDER.map((level) => {
          const checked = filters.riskLevels.includes(level);
          return (
            <label
              key={level}
              className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleRisk(level)}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
              />
              <span className={`h-2.5 w-2.5 rounded-full ${RISK_STYLES[level].dot}`} />
              {RISK_STYLES[level].label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </div>
  );
}
