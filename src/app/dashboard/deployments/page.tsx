"use client";

import { useMemo, useState } from "react";
import { DEPLOYMENTS, type RiskLevel } from "./data";
import { FiltersBar, type Filters } from "./filters-bar";
import { TimelineView } from "./timeline-view";
import { TableView } from "./table-view";
import { DeploymentDetail } from "./deployment-detail";

const DEFAULT_FILTERS: Filters = {
  service: "all",
  team: "all",
  environment: "all",
  riskLevels: ["low", "medium", "high", "critical"],
  startDate: "",
  endDate: "",
};

export default function DeploymentsPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<"timeline" | "table">("timeline");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return DEPLOYMENTS.filter((d) => {
      if (filters.service !== "all" && d.service !== filters.service) return false;
      if (filters.team !== "all" && d.team !== filters.team) return false;
      if (filters.environment !== "all" && d.environment !== filters.environment)
        return false;
      if (!filters.riskLevels.includes(d.riskLevel as RiskLevel)) return false;
      const ts = new Date(d.timestamp).getTime();
      if (filters.startDate && ts < new Date(filters.startDate).getTime()) return false;
      if (filters.endDate && ts > new Date(filters.endDate).getTime() + 86_400_000)
        return false;
      return true;
    });
  }, [filters]);

  const selected = useMemo(
    () => DEPLOYMENTS.find((d) => d.id === selectedId) ?? null,
    [selectedId]
  );

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Deployments
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Deployment history and risk timeline
        </p>
      </header>

      <FiltersBar
        filters={filters}
        onChange={setFilters}
        view={view}
        onViewChange={setView}
      />

      {view === "timeline" ? (
        <TimelineView
          deployments={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      ) : (
        <TableView
          deployments={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      )}

      {selected && (
        <DeploymentDetail
          deployment={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
