/**
 * Mock data + shared types for the Incidents page.
 *
 * Sample data used to render the incidents table, summary stats, and
 * deployment correlation details. Deterministic so renders are stable.
 */

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type CorrelationStatus = "correlated" | "uncorrelated" | "pending";

export interface LinkedDeployment {
  id: string;
  service: string;
  author: string;
  riskScore: number;
  timestamp: string;
}

export interface Incident {
  id: string;
  externalId: string;
  severity: IncidentSeverity;
  service: string;
  detectedAt: string;
  resolvedAt: string | null;
  correlation: CorrelationStatus;
  title: string;
  deployments: LinkedDeployment[];
}

export const SEVERITY_STYLES: Record<
  IncidentSeverity,
  { dot: string; badgeBg: string; badgeText: string; label: string }
> = {
  low: {
    dot: "bg-emerald-500",
    badgeBg: "bg-emerald-50",
    badgeText: "text-emerald-700",
    label: "Low",
  },
  medium: {
    dot: "bg-amber-500",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-700",
    label: "Medium",
  },
  high: {
    dot: "bg-orange-500",
    badgeBg: "bg-orange-50",
    badgeText: "text-orange-700",
    label: "High",
  },
  critical: {
    dot: "bg-red-500",
    badgeBg: "bg-red-50",
    badgeText: "text-red-700",
    label: "Critical",
  },
};

export const CORRELATION_STYLES: Record<
  CorrelationStatus,
  { bg: string; text: string; label: string }
> = {
  correlated: { bg: "bg-blue-50", text: "text-blue-700", label: "Correlated" },
  uncorrelated: { bg: "bg-gray-100", text: "text-gray-600", label: "Uncorrelated" },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
};

export const SERVICES = [
  "checkout-api",
  "payments-worker",
  "auth-service",
  "search-indexer",
  "notifications",
  "billing-gateway",
];

const AUTHORS = [
  "Dana Reyes",
  "Marcus Lin",
  "Priya Nair",
  "Sofia Alvarez",
  "Tom Becker",
  "Aisha Khan",
];

const SEVERITIES: IncidentSeverity[] = ["low", "medium", "high", "critical"];

const TITLES: Record<IncidentSeverity, string> = {
  critical: "Elevated 5xx error rate",
  high: "Latency regression on p99",
  medium: "Increased queue backlog",
  low: "Intermittent health check failures",
};

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

/** Deterministic mock dataset of 47 incidents. */
function generateIncidents(): Incident[] {
  const rand = seededRandom(73);
  const now = new Date("2026-06-07T16:00:00Z").getTime();
  const list: Incident[] = [];

  for (let i = 0; i < 47; i++) {
    const severity = SEVERITIES[Math.floor(rand() * SEVERITIES.length)];
    const service = SERVICES[Math.floor(rand() * SERVICES.length)];
    const detectedAt = new Date(
      now - i * (1000 * 60 * 60 * 5) - Math.floor(rand() * 1000 * 60 * 120)
    ).toISOString();

    // ~70% resolved, the rest still open.
    const isOpen = rand() > 0.7;
    const durationMin = 20 + Math.floor(rand() * 600);
    const resolvedAt = isOpen
      ? null
      : new Date(new Date(detectedAt).getTime() + durationMin * 60000).toISOString();

    // Correlation status distribution.
    const corrRoll = rand();
    const correlation: CorrelationStatus =
      corrRoll > 0.45 ? "correlated" : corrRoll > 0.2 ? "uncorrelated" : "pending";

    const deployments: LinkedDeployment[] =
      correlation === "correlated"
        ? Array.from({ length: rand() > 0.6 ? 2 : 1 }, (_, n) => ({
            id: `dpl_${(2000 + i * 3 + n).toString(36)}`,
            service,
            author: AUTHORS[Math.floor(rand() * AUTHORS.length)],
            riskScore: 45 + Math.floor(rand() * 55),
            timestamp: new Date(
              new Date(detectedAt).getTime() - (15 + Math.floor(rand() * 40)) * 60000
            ).toISOString(),
          }))
        : [];

    list.push({
      id: `inc_${(1000 + i).toString(36)}`,
      externalId: `PD-${45000 + i * 7 + Math.floor(rand() * 5)}`,
      severity,
      service,
      detectedAt,
      resolvedAt,
      correlation,
      title: TITLES[severity],
      deployments,
    });
  }

  return list;
}

export const INCIDENTS: Incident[] = generateIncidents();

/** Returns duration in minutes between detection and resolution. */
export function incidentDurationMinutes(inc: Incident, now: number): number {
  const end = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : now;
  return Math.max(0, Math.round((end - new Date(inc.detectedAt).getTime()) / 60000));
}

/** Formats a minute count into a compact "2h 15m" style string. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
