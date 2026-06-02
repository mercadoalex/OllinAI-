"use client";

/**
 * Risk Score Distribution Histogram — Client Component
 *
 * Displays a bar chart of risk score distribution grouped by severity level.
 * Color coding: low=green, medium=yellow, high=orange, critical=red.
 *
 * Requirements: 9.4
 */

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface RiskDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface RiskHistogramProps {
  distribution: RiskDistribution;
}

const RISK_COLORS: Record<RiskSeverity, { bg: string; border: string; label: string }> = {
  low: { bg: "#d1fae5", border: "#059669", label: "Low" },
  medium: { bg: "#fef3c7", border: "#d97706", label: "Medium" },
  high: { bg: "#fed7aa", border: "#ea580c", label: "High" },
  critical: { bg: "#fecaca", border: "#dc2626", label: "Critical" },
};

const SEVERITY_ORDER: RiskSeverity[] = ["low", "medium", "high", "critical"];

export function RiskHistogram({ distribution }: RiskHistogramProps) {
  const total = distribution.low + distribution.medium + distribution.high + distribution.critical;
  const maxCount = Math.max(
    distribution.low,
    distribution.medium,
    distribution.high,
    distribution.critical,
    1 // Prevent division by zero
  );

  if (total === 0) {
    return (
      <div
        style={{
          padding: "32px",
          textAlign: "center",
          color: "#6b7280",
          fontSize: "14px",
        }}
      >
        No deployments with risk scores in this period.
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "12px",
          height: "160px",
          paddingBottom: "8px",
        }}
        role="img"
        aria-label={`Risk score distribution: ${SEVERITY_ORDER.map(
          (s) => `${RISK_COLORS[s].label}: ${distribution[s]}`
        ).join(", ")}`}
      >
        {SEVERITY_ORDER.map((severity) => {
          const count = distribution[severity];
          const heightPercent = (count / maxCount) * 100;
          const config = RISK_COLORS[severity];

          return (
            <div
              key={severity}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                height: "100%",
                justifyContent: "flex-end",
              }}
            >
              {/* Count label above bar */}
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: "4px",
                }}
              >
                {count}
              </div>
              {/* Bar */}
              <div
                style={{
                  width: "100%",
                  maxWidth: "64px",
                  height: `${Math.max(heightPercent, 4)}%`,
                  backgroundColor: config.bg,
                  borderLeft: `3px solid ${config.border}`,
                  borderRadius: "4px 4px 0 0",
                  transition: "height 0.3s ease",
                }}
                title={`${config.label}: ${count} deployment${count !== 1 ? "s" : ""} (${total > 0 ? ((count / total) * 100).toFixed(0) : 0}%)`}
              />
            </div>
          );
        })}
      </div>
      {/* X-axis labels */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          borderTop: "1px solid #e5e7eb",
          paddingTop: "8px",
        }}
      >
        {SEVERITY_ORDER.map((severity) => {
          const config = RISK_COLORS[severity];
          return (
            <div
              key={severity}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: "12px",
                fontWeight: 500,
                color: "#6b7280",
              }}
            >
              {config.label}
            </div>
          );
        })}
      </div>
      {/* Total */}
      <div
        style={{
          marginTop: "12px",
          fontSize: "12px",
          color: "#9ca3af",
          textAlign: "right",
        }}
      >
        Total: {total} deployment{total !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
