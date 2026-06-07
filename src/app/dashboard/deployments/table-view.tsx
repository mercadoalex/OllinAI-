"use client";

import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { type Deployment, RISK_STYLES } from "./data";
import { fullTime, relativeTime } from "./utils";

interface TableViewProps {
  deployments: Deployment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type SortKey =
  | "timestamp"
  | "service"
  | "author"
  | "environment"
  | "riskScore"
  | "incidents";

const PAGE_SIZE = 25;
const NOW = new Date("2026-06-07T16:00:00Z").getTime();

export function TableView({ deployments, selectedId, onSelect }: TableViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const copy = [...deployments];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "timestamp":
          cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case "service":
          cmp = a.service.localeCompare(b.service);
          break;
        case "author":
          cmp = a.author.localeCompare(b.author);
          break;
        case "environment":
          cmp = a.environment.localeCompare(b.environment);
          break;
        case "riskScore":
          cmp = a.riskScore - b.riskScore;
          break;
        case "incidents":
          cmp = a.incidents.length - b.incidents.length;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [deployments, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" || key === "riskScore" ? "desc" : "asc");
    }
    setPage(0);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <Th label="Timestamp" sortKey="timestamp" active={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Service" sortKey="service" active={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Author" sortKey="author" active={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Environment" sortKey="environment" active={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Risk Score" sortKey="riskScore" active={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="px-4 py-3 font-semibold">Commit</th>
              <Th label="Incidents" sortKey="incidents" active={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const risk = RISK_STYLES[d.riskLevel];
              return (
                <tr
                  key={d.id}
                  onClick={() => onSelect(d.id)}
                  className={`cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50 ${
                    d.id === selectedId ? "bg-blue-50/60" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-gray-700" title={fullTime(d.timestamp)}>
                    {relativeTime(d.timestamp, NOW)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-mono text-gray-900">
                      <span className={`h-2 w-2 rounded-full ${risk.dot}`} />
                      {d.service}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{d.author}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        d.environment === "production"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {d.environment}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex min-w-[3rem] justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${risk.badgeBg} ${risk.badgeText}`}
                    >
                      {d.riskScore} · {risk.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {d.commitShas[0].slice(0, 7)}
                  </td>
                  <td className="px-4 py-3">
                    {d.incidents.length > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-50 px-1.5 text-xs font-semibold text-red-700">
                        {d.incidents.length}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-gray-500">
                  No deployments match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
        <span>
          {sorted.length === 0
            ? "0 deployments"
            : `${safePage * PAGE_SIZE + 1}–${Math.min(
                (safePage + 1) * PAGE_SIZE,
                sorted.length
              )} of ${sorted.length}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="tabular-nums">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({
  label,
  sortKey,
  active,
  sortDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <th className="px-4 py-3 font-semibold">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-gray-900"
      >
        {label}
        {isActive ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 text-gray-300" />
        )}
      </button>
    </th>
  );
}
