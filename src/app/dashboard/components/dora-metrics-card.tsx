"use client"

/**
 * DORA Metrics Card — Redesigned with sparklines
 */

import { ArrowUp, ArrowDown, Minus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Sparkline, generateSparklineData } from "@/components/sparkline"
import { cn } from "@/lib/utils"

export type TrendDirection = "improving" | "degrading" | "stable"

export interface DORAMetricValue {
  label: string
  value: number | "insufficient_data"
  unit: string
  trend: TrendDirection
  previousValue?: number | "insufficient_data"
  lowerIsBetter: boolean
  percentChange?: number
}

export interface DORAMetricsCardProps {
  metrics: DORAMetricValue[]
}

export function computeTrend(
  current: number | "insufficient_data",
  previous: number | "insufficient_data",
  lowerIsBetter: boolean
): TrendDirection {
  if (current === "insufficient_data" || previous === "insufficient_data") {
    return "stable"
  }
  if (previous === 0) {
    if (current === 0) return "stable"
    return lowerIsBetter ? "degrading" : "improving"
  }

  const percentChange = ((current - previous) / Math.abs(previous)) * 100

  if (lowerIsBetter) {
    if (percentChange < -10) return "improving"
    if (percentChange > 10) return "degrading"
    return "stable"
  } else {
    if (percentChange > 10) return "improving"
    if (percentChange < -10) return "degrading"
    return "stable"
  }
}

function computePercentChange(
  current: number | "insufficient_data",
  previous: number | "insufficient_data"
): number | null {
  if (current === "insufficient_data" || previous === "insufficient_data") {
    return null
  }
  if (previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function formatMetricValue(value: number | "insufficient_data", unit: string): string {
  if (value === "insufficient_data") return "—"
  if (unit === "%") return `${value.toFixed(1)}`
  if (unit === "/day") return value.toFixed(2)
  if (unit === "hrs") return value.toFixed(1)
  return String(value)
}

const TREND_CONFIG = {
  improving: { 
    Icon: ArrowUp, 
    color: "text-emerald-600", 
    bgColor: "bg-emerald-50",
    sparklineColor: "#059669"
  },
  degrading: { 
    Icon: ArrowDown, 
    color: "text-red-600", 
    bgColor: "bg-red-50",
    sparklineColor: "#dc2626"
  },
  stable: { 
    Icon: Minus, 
    color: "text-gray-500", 
    bgColor: "bg-gray-50",
    sparklineColor: "#6b7280"
  },
}

export function DORAMetricsCard({ metrics }: DORAMetricsCardProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric, index) => {
        const trendConfig = TREND_CONFIG[metric.trend]
        const TrendIcon = trendConfig.Icon
        const isInsufficient = metric.value === "insufficient_data"
        const percentChange = computePercentChange(metric.value, metric.previousValue ?? "insufficient_data")
        
        // Generate sparkline data based on trend with unique seed per metric
        const sparklineData = generateSparklineData(30, 
          metric.trend === "improving" 
            ? (metric.lowerIsBetter ? "down" : "up")
            : metric.trend === "degrading"
              ? (metric.lowerIsBetter ? "up" : "down")
              : "stable",
          index * 1000 + 42 // Unique seed per metric for consistent rendering
        )

        return (
          <Card key={metric.label} className="overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-500">
                    {metric.label}
                  </p>
                  <div className="flex items-baseline gap-1">
                    <span className={cn(
                      "text-2xl font-bold tracking-tight",
                      isInsufficient ? "text-gray-400" : "text-gray-900"
                    )}>
                      {formatMetricValue(metric.value, metric.unit)}
                    </span>
                    {!isInsufficient && (
                      <span className="text-sm text-gray-500">{metric.unit}</span>
                    )}
                  </div>
                </div>
                {!isInsufficient && (
                  <div className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-1",
                    trendConfig.bgColor
                  )}>
                    <TrendIcon className={cn("h-3.5 w-3.5", trendConfig.color)} />
                    {percentChange !== null && (
                      <span className={cn("text-xs font-medium", trendConfig.color)}>
                        {Math.abs(percentChange).toFixed(0)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
              
              {/* Sparkline */}
              <div className="mt-4">
                {isInsufficient ? (
                  <div className="h-8 flex items-center">
                    <span className="text-xs text-gray-400">Insufficient data</span>
                  </div>
                ) : (
                  <Sparkline 
                    data={sparklineData} 
                    color={trendConfig.sparklineColor}
                    width={160}
                    height={32}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
