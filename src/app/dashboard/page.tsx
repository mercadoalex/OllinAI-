/**
 * Dashboard Page — Delegates all data fetching to client component.
 * No server-side DynamoDB queries — avoids ISR/SSR caching issues entirely.
 */

import { DashboardClient } from "./components/dashboard-client";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;

export default function DashboardPage() {
  // Pass empty initial data — the client component will fetch everything
  const emptyData = {
    currentMetrics: null,
    previousMetrics: null,
    riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
    totalEvents: 0,
    maxRetentionDays: 365,
    currentTier: "enterprise",
  };

  return (
    <DashboardClient
      initialData={emptyData}
      defaultTimeRange={DEFAULT_DAYS}
      currentTier="enterprise"
      fetchOnMount={true}
    />
  );
}
