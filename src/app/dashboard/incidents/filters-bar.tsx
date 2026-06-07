"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  SEVERITY_STYLES,
  SERVICES,
  type IncidentSeverity,
  type CorrelationStatus,
} from "./data";

export interface IncidentFilters {
  severities: IncidentSeverity[];
  service: string;
  correlation: CorrelationStatus | "all";
  from: string;
  to: string;
}

interface FiltersBarProps {
  filters: IncidentFilters;
  onChange: (next: IncidentFilters) => void;
}

const SEVERITY_OPTIONS: IncidentSeverity[] = ["low", "medium", "high", "critical"];

const CORRELATION_OPTIONS: { value: CorrelationStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "correlated", label: "Correlated" },
  { value: "uncorrelated", label: "Uncorrelated" },
];

export function FiltersBar({ filters, onChange }: FiltersBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SeverityMultiSelect
        selected={filters.severities}
        onChange={(severities) => onChange({ ...filters, severities })}
      />

      <select
        aria-label="Filter by service"
        value={filters.service}
        onChange={(e) => onChange({ ...filters, service: e.target.value })}
        className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
      >
        <option value="all">All services</option>
        {SERVICES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white p-0.5 shadow-sm">
        {CORRELATION_OPTIONS.map((opt) => {
          const active = filters.correlation === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, correlation: opt.value })}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                active ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label="From date"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
          className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
        <span className="text-sm text-gray-400">to</span>
        <input
          type="date"
          aria-label="To date"
          value={filters.to}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
          className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
      </div>
    </div>
  );
}

function SeverityMultiSelect({
  selected,
  onChange,
}: {
  selected: IncidentSeverity[];
  onChange: (next: IncidentSeverity[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function toggle(sev: IncidentSeverity) {
    onChange(
      selected.includes(sev) ? selected.filter((s) => s !== sev) : [...selected, sev]
    );
  }

  const label =
    selected.length === 0
      ? "All severities"
      : selected.length === SEVERITY_OPTIONS.length
        ? "All severities"
        : `${selected.length} severit${selected.length === 1 ? "y" : "ies"}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200"
      >
        {label}
        <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-48 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {SEVERITY_OPTIONS.map((sev) => {
            const checked = selected.includes(sev);
            const style = SEVERITY_STYLES[sev];
            return (
              <button
                key={sev}
                type="button"
                onClick={() => toggle(sev)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  {style.label}
                </span>
                {checked && <Check className="h-4 w-4 text-gray-900" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
