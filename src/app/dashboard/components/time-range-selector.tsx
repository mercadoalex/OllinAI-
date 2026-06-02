"use client";

/**
 * Time Range Selector — Client Component
 *
 * Provides selectable time range options: 7, 14, 30, 60, 90 days.
 * Constrained by the tenant's retention period — options exceeding
 * the retention period are disabled.
 *
 * Requirements: 9.7
 */

import { useCallback } from "react";

export type TimeRangeDays = 7 | 14 | 30 | 60 | 90;

export const TIME_RANGE_OPTIONS: TimeRangeDays[] = [7, 14, 30, 60, 90];

export interface TimeRangeSelectorProps {
  /** Currently selected time range in days */
  selected: TimeRangeDays;
  /** Callback when user selects a new time range */
  onChange: (days: TimeRangeDays) => void;
  /** Maximum allowed days based on tenant retention period */
  maxRetentionDays: number;
}

export function TimeRangeSelector({
  selected,
  onChange,
  maxRetentionDays,
}: TimeRangeSelectorProps) {
  const handleClick = useCallback(
    (days: TimeRangeDays) => {
      if (days <= maxRetentionDays) {
        onChange(days);
      }
    },
    [onChange, maxRetentionDays]
  );

  return (
    <nav aria-label="Time range selector" style={{ display: "flex", gap: "4px" }}>
      {TIME_RANGE_OPTIONS.map((days) => {
        const isDisabled = days > maxRetentionDays;
        const isSelected = days === selected;

        return (
          <button
            key={days}
            onClick={() => handleClick(days)}
            disabled={isDisabled}
            aria-pressed={isSelected}
            aria-label={`${days} days${isDisabled ? " (exceeds retention period)" : ""}`}
            title={isDisabled ? `Exceeds ${maxRetentionDays}-day retention period` : `Last ${days} days`}
            style={{
              padding: "6px 12px",
              fontSize: "13px",
              fontWeight: isSelected ? 600 : 400,
              borderRadius: "6px",
              border: "1px solid",
              borderColor: isSelected ? "#3b82f6" : "#d1d5db",
              backgroundColor: isSelected ? "#eff6ff" : isDisabled ? "#f3f4f6" : "#ffffff",
              color: isSelected ? "#1d4ed8" : isDisabled ? "#9ca3af" : "#374151",
              cursor: isDisabled ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {days}d
          </button>
        );
      })}
    </nav>
  );
}
