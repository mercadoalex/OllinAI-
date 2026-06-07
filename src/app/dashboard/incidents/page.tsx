"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { INCIDENTS, type Incident } from "./data";
import { FiltersBar, type IncidentFilters } from "./filters-bar";
import { StatsRow } from "./stats-row";
import { IncidentsTable } from "./incidents-table";

const PAGE_SIZE = 25;

// Fixed "now" so mock relative timestamps stay deterministic.
const NOW = new Date("2026-06-07T16:00:00Z").getTime();

const INITIAL_FILTERS: IncidentFilters = {
  severities: [],
  service: "all",
  correlation: "all",
  from: "",
  to: "",
};

export default function IncidentsPage() {
  const [filters, setFilters] = useState<IncidentFilters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return INCIDENTS.filter((inc: Incident) => {
      if (filters.severities.length > 0 && !filters.severities.includes(inc.severity)) {
        return false;
      }
      if (filters.service !== "all" && inc.service !== filters.service) return false;
      if (filters.correlation !== "all" && inc.correlation !== filters.correlation) {
        return false;
      }
      const detected = new Date(inc.detectedAt).getTime();
      if (filters.from && detected < new Date(filters.from).getTime()) return false;
      if (filters.to && detected > new Date(filters.to).getTime() + 86_400_000) return false;
      return true;
    });
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  function updateFilters(next: IncidentFilters) {
    setFilters(next);
    setPage(1);
    setExpandedId(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Incidents</h1>
          <p className="mt-1 text-sm text-gray-500">
            Production incidents and deployment correlations
          </p>
        </header>

        <div className="mb-6">
          <FiltersBar filters={filters} onChange={updateFilters} />
        </div>

        <div className="mb-6">
          <StatsRow incidents={filtered} now={NOW} />
        </div>

        <IncidentsTable
          incidents={pageItems}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          now={NOW}
        />

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {filtered.length === 0
              ? "0 incidents"
              : `${start + 1}\u2013${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} incidents`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </button>
            <span className="text-sm tabular-nums text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
