"use client";

/**
 * DORA Metrics Card — Client Component
 *
 * Displays the four DORA metrics with trend indicators.
 * Trend is computed by comparing the current period to the preceding
 * period of equal length:
 *   - "improving" if metric improved by >10%
 *   - "degrading" if metric worsened by >10%
 *   - "stable" otherwise
 *
 * Requirements: 9.1
 */

export type TrendDirection = "improving" | "degrading" | "stable";

export interface DORAMetricValue {
  /** Display label for the metric */
  label: string;
  /** Current value (number or "insufficient_data") */
  value: number | "insufficient_data";
  /** Unit suffix (e.g., "/day", "hrs", "%") */
  unit: string;
  /** Trend direction */
  trend: TrendDirection;
  /** Previous period value for context */
  previousValue?: number | "insufficient_data";
  /**
   * Whether lower is better for this metric.
   * true for: leadTime, changeFailureRate, mttr
   * false for: deploymentFrequency
   */
  lowerIsBetter: boolean;
}

export interface DORAMetricsCardProps {
  metrics: DORAMetricValue[];
}

const TREND_CONFIG: Record<
  TrendDirection,
  { icon: string; color: string; label: string }
> = {
  improving: { icon: "↑", color: "#059669", label: "Improving" },
  degrading: { icon: "↓", color: "#dc2626", label: "Degrading" },
  stable: { icon: "→", color: "#6b7280", label: "Stable" },
};

/**
 * Computes trend direction based on the 10% threshold rule.
 * For metrics where lower is better: decrease = improving
 * For metrics where higher is better: increase = improving
 */
export function computeTrend(
  current: number | "insufficient_data",
  previous: number | "insufficient_data",
  lowerIsBetter: boolean
): TrendDirection {
  if (current === "insufficient_data" || previous === "insufficient_data") {
    return "stable";
  }
  if (previous === 0) {
    // Can't compute percentage change from zero
    if (current === 0) return "stable";
    return lowerIsBetter ? "degrading" : "improving";
  }

  const percentChange = ((current - previous) / Math.abs(previous)) * 100;

  if (lowerIsBetter) {
    // For metrics where lower is better (CFR, MTTR, lead time):
    // negative change = improving, positive change = degrading
    if (percentChange < -10) return "improving";
    if (percentChange > 10) return "degrading";
    return "stable";
  } else {
    // For metrics where higher is better (deployment frequency):
    // positive change = improving, negative change = degrading
    if (percentChange > 10) return "improving";
    if (percentChange < -10) return "degrading";
    return "stable";
  }
}

function formatMetricValue(value: number | "insufficient_data", unit: string): string {
  if (value === "insufficient_data") return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "/day") return value.toFixed(2);
  if (unit === "hrs") return value.toFixed(1);
  return String(value);
}

export function DORAMetricsCard({ metrics }: DORAMetricsCardProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "16px",
      }}
    >
      {metrics.map((metric) => {
        const trendConfig = TREND_CONFIG[metric.trend];
        const isInsufficient = metric.value === "insufficient_data";

        return (
          <div
            key={metric.label}
            style={{
              padding: "20px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              backgroundColor: "#ffffff",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: "#6b7280",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {metric.label}
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: isInsufficient ? "#9ca3af" : "#111827",
                marginBottom: "8px",
              }}
            >
              {formatMetricValue(metric.value, metric.unit)}
              {!isInsufficient && (
                <span style={{ fontSize: "14px", fontWeight: 400, color: "#6b7280", marginLeft: "4px" }}>
                  {metric.unit}
                </span>
              )}
            </div>
            {!isInsufficient && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "13px",
                  color: trendConfig.color,
                  fontWeight: 500,
                }}
                aria-label={`Trend: ${trendConfig.label}`}
              >
                <span aria-hidden="true">{trendConfig.icon}</span>
                <span>{trendConfig.label}</span>
              </div>
            )}
            {isInsufficient && (
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                Insufficient data
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
