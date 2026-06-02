"use client";

/**
 * Insufficient Data Indicator
 *
 * Displayed when fewer than 3 deployment events exist for the selected
 * scope and time range, instead of rendering potentially misleading visualizations.
 *
 * Requirements: 9.8
 */

export interface InsufficientDataProps {
  /** Total number of events found */
  eventCount: number;
  /** Minimum events required */
  minimumRequired?: number;
}

export function InsufficientData({
  eventCount,
  minimumRequired = 3,
}: InsufficientDataProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        borderRadius: "8px",
        border: "1px dashed #d1d5db",
        backgroundColor: "#f9fafb",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          backgroundColor: "#fef3c7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
          fontSize: "24px",
        }}
        aria-hidden="true"
      >
        ⚠️
      </div>
      <h3
        style={{
          margin: "0 0 8px 0",
          fontSize: "18px",
          fontWeight: 600,
          color: "#374151",
        }}
      >
        Insufficient Data
      </h3>
      <p
        style={{
          margin: "0",
          fontSize: "14px",
          color: "#6b7280",
          maxWidth: "400px",
        }}
      >
        At least {minimumRequired} deployment events are required to display
        metrics and visualizations. Currently{" "}
        <strong>
          {eventCount} event{eventCount !== 1 ? "s" : ""}
        </strong>{" "}
        recorded for the selected time range.
      </p>
    </div>
  );
}
