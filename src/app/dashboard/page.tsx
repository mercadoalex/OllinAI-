/**
 * Dashboard Page — Shows demo data for video recording.
 */

import { DashboardClient } from "./components/dashboard-client";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  // Hardcoded demo data for video — bypasses all DynamoDB issues
  const demoData = {
    currentMetrics: {
      deploymentFrequency: 2.3,
      leadTimeHours: 4.2,
      changeFailureRate: 15.3,
      mttrHours: 2.1,
      unresolvedIncidentCount: 2,
      period: { start: "2026-05-17T00:00:00Z", end: "2026-06-17T00:00:00Z" },
      filters: {},
    },
    previousMetrics: {
      deploymentFrequency: 1.8,
      leadTimeHours: 6.1,
      changeFailureRate: 19.7,
      mttrHours: 3.4,
      unresolvedIncidentCount: 4,
      period: { start: "2026-04-17T00:00:00Z", end: "2026-05-17T00:00:00Z" },
      filters: {},
    },
    riskDistribution: { low: 28, medium: 18, high: 9, critical: 3 },
    totalEvents: 58,
    maxRetentionDays: 365,
    currentTier: "enterprise",
  };

  return (
    <DashboardClient
      initialData={demoData}
      defaultTimeRange={30}
      currentTier="enterprise"
    />
  );
}
