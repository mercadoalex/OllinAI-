/**
 * Mock data + shared types for the Deployments page.
 *
 * This is sample data used to render the timeline and table views.
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Environment = "production" | "staging";
export type IncidentSeverity = "sev1" | "sev2" | "sev3";

export interface RiskBreakdown {
  /** Change failure rate factor (weight 35%) */
  changeFailureRate: number;
  /** Change size factor (weight 25%) */
  changeSize: number;
  /** Deployment timing factor (weight 20%) */
  deploymentTiming: number;
  /** Author failure rate factor (weight 20%) */
  authorFailureRate: number;
}

export interface CorrelatedIncident {
  id: string;
  severity: IncidentSeverity;
  detectedAt: string;
  title: string;
}

export interface Deployment {
  id: string;
  timestamp: string;
  service: string;
  team: string;
  author: string;
  authorEmail: string;
  environment: Environment;
  riskScore: number;
  riskLevel: RiskLevel;
  commitShas: string[];
  breakdown: RiskBreakdown;
  incidents: CorrelatedIncident[];
}

export const RISK_FACTORS: {
  key: keyof RiskBreakdown;
  label: string;
  weight: number;
}[] = [
  { key: "changeFailureRate", label: "Change failure rate", weight: 35 },
  { key: "changeSize", label: "Change size", weight: 25 },
  { key: "deploymentTiming", label: "Deployment timing", weight: 20 },
  { key: "authorFailureRate", label: "Author failure rate", weight: 20 },
];

export const RISK_STYLES: Record<
  RiskLevel,
  { dot: string; badgeBg: string; badgeText: string; bar: string; label: string }
> = {
  low: {
    dot: "bg-emerald-500",
    badgeBg: "bg-emerald-50",
    badgeText: "text-emerald-700",
    bar: "bg-emerald-500",
    label: "Low",
  },
  medium: {
    dot: "bg-amber-500",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-700",
    bar: "bg-amber-500",
    label: "Medium",
  },
  high: {
    dot: "bg-orange-500",
    badgeBg: "bg-orange-50",
    badgeText: "text-orange-700",
    bar: "bg-orange-500",
    label: "High",
  },
  critical: {
    dot: "bg-red-500",
    badgeBg: "bg-red-50",
    badgeText: "text-red-700",
    bar: "bg-red-500",
    label: "Critical",
  },
};

export const SEVERITY_STYLES: Record<
  IncidentSeverity,
  { bg: string; text: string; label: string }
> = {
  sev1: { bg: "bg-red-50", text: "text-red-700", label: "SEV1" },
  sev2: { bg: "bg-orange-50", text: "text-orange-700", label: "SEV2" },
  sev3: { bg: "bg-amber-50", text: "text-amber-700", label: "SEV3" },
};

export const SERVICES = [
  "checkout-api",
  "payments-worker",
  "auth-service",
  "search-indexer",
  "notifications",
  "billing-gateway",
];

export const TEAMS = ["Platform", "Payments", "Growth", "Identity", "Search"];

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

const AUTHORS = [
  { name: "Dana Reyes", email: "dana.reyes@ollin.ai" },
  { name: "Marcus Lin", email: "marcus.lin@ollin.ai" },
  { name: "Priya Nair", email: "priya.nair@ollin.ai" },
  { name: "Sofia Alvarez", email: "sofia.alvarez@ollin.ai" },
  { name: "Tom Becker", email: "tom.becker@ollin.ai" },
  { name: "Aisha Khan", email: "aisha.khan@ollin.ai" },
];

function sha(): string {
  return Array.from({ length: 40 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

/** Deterministic mock dataset so server and client render identically. */
function generateDeployments(): Deployment[] {
  const rand = seededRandom(42);
  const now = new Date("2026-06-07T16:00:00Z").getTime();
  const list: Deployment[] = [];

  for (let i = 0; i < 60; i++) {
    const author = AUTHORS[Math.floor(rand() * AUTHORS.length)];
    const score = Math.round(rand() * 100);
    const riskLevel = riskLevelFromScore(score);
    const environment: Environment = rand() > 0.35 ? "production" : "staging";
    const timestamp = new Date(
      now - i * (1000 * 60 * 60 * 4) - Math.floor(rand() * 1000 * 60 * 90)
    ).toISOString();

    const hasIncident =
      (riskLevel === "critical" || riskLevel === "high") && rand() > 0.45;

    const incidents: CorrelatedIncident[] = hasIncident
      ? Array.from({ length: rand() > 0.7 ? 2 : 1 }, (_, n) => {
          const sev: IncidentSeverity =
            riskLevel === "critical" ? "sev1" : rand() > 0.5 ? "sev2" : "sev3";
          return {
            id: `INC-${2400 + i * 3 + n}`,
            severity: sev,
            detectedAt: new Date(
              new Date(timestamp).getTime() + (10 + Math.floor(rand() * 40)) * 60000
            ).toISOString(),
            title:
              sev === "sev1"
                ? "Elevated 5xx error rate"
                : sev === "sev2"
                  ? "Latency regression on p99"
                  : "Background job backlog",
          };
        })
      : [];

    list.push({
      id: `dpl_${(1000 + i).toString(36)}`,
      timestamp,
      service: SERVICES[Math.floor(rand() * SERVICES.length)],
      team: TEAMS[Math.floor(rand() * TEAMS.length)],
      author: author.name,
      authorEmail: author.email,
      environment,
      riskScore: score,
      riskLevel,
      commitShas: Array.from({ length: 1 + Math.floor(rand() * 3) }, () => sha()),
      breakdown: {
        changeFailureRate: Math.round(rand() * 100),
        changeSize: Math.round(rand() * 100),
        deploymentTiming: Math.round(rand() * 100),
        authorFailureRate: Math.round(rand() * 100),
      },
      incidents,
    });
  }

  return list;
}

export const DEPLOYMENTS: Deployment[] = generateDeployments();
