"use client";

import { X, GitCommit, AlertTriangle, Lightbulb, Copy, Check } from "lucide-react";
import { useState } from "react";
import {
  type Deployment,
  RISK_FACTORS,
  RISK_STYLES,
  SEVERITY_STYLES,
} from "./data";
import { fullTime, relativeTime } from "./utils";

interface DeploymentDetailProps {
  deployment: Deployment;
  onClose: () => void;
}

export function DeploymentDetail({ deployment, onClose }: DeploymentDetailProps) {
  const risk = RISK_STYLES[deployment.riskLevel];
  const showRecommendations =
    deployment.riskLevel === "high" || deployment.riskLevel === "critical";

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-50 px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${risk.dot}`} />
            <h2 className="font-mono text-sm font-semibold text-gray-900">
              {deployment.id}
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${risk.badgeBg} ${risk.badgeText}`}
            >
              {risk.label} · {deployment.riskScore}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">{fullTime(deployment.timestamp)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
        {/* Left column: meta + commits */}
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Meta label="Service" value={deployment.service} mono />
            <Meta label="Environment" value={deployment.environment} />
            <Meta label="Author" value={deployment.author} />
            <Meta label="Email" value={deployment.authorEmail} />
          </dl>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Commit SHAs
            </h3>
            <ul className="flex flex-col gap-1.5">
              {deployment.commitShas.map((s) => (
                <CommitRow key={s} sha={s} />
              ))}
            </ul>
          </div>
        </div>

        {/* Right column: risk breakdown */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Risk score breakdown
          </h3>
          <div className="flex flex-col gap-3">
            {RISK_FACTORS.map((factor) => {
              const value = deployment.breakdown[factor.key];
              return (
                <div key={factor.key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-700">
                      {factor.label}
                      <span className="ml-1 text-xs text-gray-400">
                        {factor.weight}%
                      </span>
                    </span>
                    <span className="font-medium tabular-nums text-gray-900">
                      {value}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${RISK_STYLES[scoreToLevel(value)].bar}`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Correlated incidents */}
      {deployment.incidents.length > 0 && (
        <div className="border-t border-gray-100 px-6 py-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <AlertTriangle className="h-3.5 w-3.5" />
            Correlated incidents ({deployment.incidents.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {deployment.incidents.map((inc) => {
              const sev = SEVERITY_STYLES[inc.severity];
              return (
                <li
                  key={inc.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${sev.bg} ${sev.text}`}
                    >
                      {sev.label}
                    </span>
                    <span className="font-mono text-sm text-gray-900">{inc.id}</span>
                    <span className="text-sm text-gray-500">{inc.title}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    detected {relativeTime(inc.detectedAt, new Date(deployment.timestamp).getTime() + 3600_000)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {showRecommendations && (
        <div className="border-t border-gray-100 px-6 py-4">
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <Lightbulb className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                Recommendations
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-amber-800">
                <li>
                  Consider splitting this change into smaller deployments to reduce
                  change-size risk.
                </li>
                <li>
                  Schedule a rollback checkpoint and notify the on-call engineer for{" "}
                  {deployment.service}.
                </li>
                {deployment.riskLevel === "critical" && (
                  <li>
                    Require a second reviewer and run extended canary analysis before
                    promoting to 100%.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function scoreToLevel(score: number) {
  if (score >= 80) return "critical" as const;
  if (score >= 60) return "high" as const;
  if (score >= 35) return "medium" as const;
  return "low" as const;
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className={`mt-0.5 text-gray-900 ${mono ? "font-mono text-sm" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function CommitRow({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <li className="flex items-center justify-between rounded-md bg-gray-50 px-2.5 py-1.5">
      <span className="flex items-center gap-2 font-mono text-sm text-gray-700">
        <GitCommit className="h-3.5 w-3.5 text-gray-400" />
        {sha.slice(0, 12)}
      </span>
      <button
        type="button"
        aria-label="Copy commit SHA"
        onClick={() => {
          navigator.clipboard?.writeText(sha);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </li>
  );
}
