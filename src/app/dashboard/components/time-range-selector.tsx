"use client"

/**
 * Time Range Selector — Redesigned as dropdown
 */

import { Calendar } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type TimeRangeDays = 7 | 14 | 30 | 60 | 90

export const TIME_RANGE_OPTIONS: { value: TimeRangeDays; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
]

export interface TimeRangeSelectorProps {
  selected: TimeRangeDays
  onChange: (days: TimeRangeDays) => void
  maxRetentionDays: number
}

export function TimeRangeSelector({
  selected,
  onChange,
  maxRetentionDays,
}: TimeRangeSelectorProps) {
  const selectedOption = TIME_RANGE_OPTIONS.find(opt => opt.value === selected)
  
  return (
    <Select
      value={String(selected)}
      onValueChange={(value) => onChange(Number(value) as TimeRangeDays)}
    >
      <SelectTrigger className="w-[160px] gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <SelectValue placeholder="Select range">
          {selectedOption?.label || `${selected}d`}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {TIME_RANGE_OPTIONS.map((option) => {
          const isDisabled = option.value > maxRetentionDays
          return (
            <SelectItem
              key={option.value}
              value={String(option.value)}
            >
              {option.label}
              {isDisabled && " (Upgrade)"}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
