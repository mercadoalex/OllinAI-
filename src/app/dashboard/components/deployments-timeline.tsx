"use client"

/**
 * Recent Deployments Timeline
 */

import { useState, useEffect } from "react"
import { formatDistanceToNow } from "@/lib/date-utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface Deployment {
  id: string
  timestamp: string
  serviceName: string
  serviceColor: string
  author: string
  environment: "production" | "staging" | "development"
  riskScore: "low" | "medium" | "high" | "critical"
  correlatedIncidents: number
}

export interface DeploymentsTimelineProps {
  deployments: Deployment[]
  isLoading?: boolean
}

const ENV_CONFIG = {
  production: { label: "Production", className: "bg-blue-100 text-blue-700" },
  staging: { label: "Staging", className: "bg-purple-100 text-purple-700" },
  development: { label: "Development", className: "bg-gray-100 text-gray-700" },
}

export function DeploymentsTimeline({ deployments, isLoading }: DeploymentsTimelineProps) {
  // Only render time-dependent content after hydration
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])

  if (deployments.length === 0 && !isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Recent Deployments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-sm text-gray-500">
            No deployments in this period.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Recent Deployments</CardTitle>
          <span className="text-xs text-gray-500">Last 20 events</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                  Timestamp
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                  Service
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                  Author
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                  Environment
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                  Risk
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                  Incidents
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-200 last:border-0">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 bg-gray-100 animate-pulse rounded" />
                    </td>
                  </tr>
                ))
              ) : (
                deployments.map((deployment) => (
                  <tr 
                    key={deployment.id} 
                    className="border-b border-gray-200 last:border-0 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {mounted ? formatDistanceToNow(new Date(deployment.timestamp)) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div 
                          className="h-2.5 w-2.5 rounded-full" 
                          style={{ backgroundColor: deployment.serviceColor }}
                        />
                        <span className="text-sm font-medium">{deployment.serviceName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {deployment.author}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        ENV_CONFIG[deployment.environment].className
                      )}>
                        {ENV_CONFIG[deployment.environment].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={deployment.riskScore}>
                        {deployment.riskScore.charAt(0).toUpperCase() + deployment.riskScore.slice(1)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {deployment.correlatedIncidents > 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          {deployment.correlatedIncidents}
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

// Generate mock deployment data for demo
export function generateMockDeployments(count: number = 20): Deployment[] {
  const services = [
    { name: "api-gateway", color: "#3b82f6" },
    { name: "auth-service", color: "#8b5cf6" },
    { name: "payment-service", color: "#10b981" },
    { name: "user-service", color: "#f59e0b" },
    { name: "notification-service", color: "#ef4444" },
    { name: "analytics-service", color: "#06b6d4" },
  ]
  
  const authors = ["alice", "bob", "charlie", "david", "emma", "frank"]
  const environments: ("production" | "staging" | "development")[] = ["production", "staging", "development"]
  const riskScores: ("low" | "medium" | "high" | "critical")[] = ["low", "medium", "high", "critical"]
  
  const deployments: Deployment[] = []
  const now = Date.now()
  
  for (let i = 0; i < count; i++) {
    const service = services[Math.floor(Math.random() * services.length)]
    const hoursAgo = Math.floor(Math.random() * 168) // Up to 7 days
    
    deployments.push({
      id: `deploy-${i}`,
      timestamp: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
      serviceName: service.name,
      serviceColor: service.color,
      author: authors[Math.floor(Math.random() * authors.length)],
      environment: environments[Math.floor(Math.random() * environments.length)],
      riskScore: riskScores[Math.floor(Math.random() * 4)],
      correlatedIncidents: Math.random() > 0.8 ? Math.floor(Math.random() * 3) + 1 : 0,
    })
  }
  
  // Sort by timestamp descending
  return deployments.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
}
