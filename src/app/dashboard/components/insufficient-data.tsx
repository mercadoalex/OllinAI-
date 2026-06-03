"use client"

/**
 * Insufficient Data Indicator — Redesigned
 */

import { AlertCircle, Rocket } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export interface InsufficientDataProps {
  eventCount: number
  minimumRequired?: number
}

export function InsufficientData({
  eventCount,
  minimumRequired = 3,
}: InsufficientDataProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
          <AlertCircle className="h-8 w-8 text-amber-500" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-foreground">
          Insufficient Data
        </h3>
        <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
          At least {minimumRequired} deployment events are required to display
          metrics and visualizations. Currently{" "}
          <strong className="text-foreground">
            {eventCount} event{eventCount !== 1 ? "s" : ""}
          </strong>{" "}
          recorded for the selected time range.
        </p>
        
        <div className="rounded-lg border bg-muted/50 p-4 max-w-sm w-full">
          <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Quick Setup
          </h4>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Configure your CI/CD pipeline to send deployment events</li>
            <li>Connect your incident management system</li>
            <li>Wait for data to populate (usually within minutes)</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
