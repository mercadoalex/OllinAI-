"use client"

/**
 * Risk Score Distribution Histogram — Redesigned
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type RiskSeverity = "low" | "medium" | "high" | "critical"

export interface RiskDistribution {
  low: number
  medium: number
  high: number
  critical: number
}

export interface RiskHistogramProps {
  distribution: RiskDistribution
  totalDeployments?: number
}

const RISK_CONFIG: Record<RiskSeverity, { bg: string; fill: string; label: string }> = {
  low: { bg: "bg-emerald-100", fill: "bg-emerald-500", label: "Low" },
  medium: { bg: "bg-amber-100", fill: "bg-amber-500", label: "Medium" },
  high: { bg: "bg-orange-100", fill: "bg-orange-500", label: "High" },
  critical: { bg: "bg-red-100", fill: "bg-red-500", label: "Critical" },
}

const SEVERITY_ORDER: RiskSeverity[] = ["low", "medium", "high", "critical"]

export function RiskHistogram({ distribution, totalDeployments }: RiskHistogramProps) {
  const total = distribution.low + distribution.medium + distribution.high + distribution.critical
  const displayTotal = totalDeployments ?? total

  if (total === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Risk Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No deployments with risk scores in this period.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Risk Distribution</CardTitle>
          <span className="text-sm text-muted-foreground">
            {displayTotal} deployment{displayTotal !== 1 ? "s" : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Horizontal bar chart */}
        <div className="space-y-3">
          {SEVERITY_ORDER.map((severity) => {
            const count = distribution[severity]
            const percentage = total > 0 ? (count / total) * 100 : 0
            const config = RISK_CONFIG[severity]

            return (
              <div key={severity} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-3 w-3 rounded-sm", config.fill)} />
                    <span className="font-medium">{config.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>{count}</span>
                    <span className="w-12 text-right">({percentage.toFixed(0)}%)</span>
                  </div>
                </div>
                <div className={cn("h-2 w-full rounded-full", config.bg)}>
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", config.fill)}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
