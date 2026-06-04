"use client"

/**
 * Predictive Intelligence Page
 * ML-powered incident predictions and anomaly detection
 */

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Activity,
  Brain,
  Shield,
  Zap,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Target,
  Gauge,
  BarChart3,
  LineChart,
  Cpu,
  Database,
  Server,
  GitCommit,
  Play,
  Pause,
  RotateCcw,
  Bell,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Sparkline, generateSparklineData } from "@/components/sparkline"

// ============================================================================
// Types
// ============================================================================

type PredictionSource = "ml_model" | "rule_engine" | "all"
type GateDecision = "proceed" | "warn" | "block"
type AnomalyType = "metric_deviation" | "behavioral" | "resource"
type RemediationStatus = "executed" | "recommended" | "overridden"
type RemediationAction = "rollback" | "halt_canary" | "scale_up" | "notify_oncall"

interface ModelStatus {
  active: boolean
  version: string
  lastTrained: string
  fallbackReason?: string
}

interface EarlyWarning {
  id: string
  service: string
  predictionScore: number
  reason: string
  detectedAt: string
  recommendedAction: string
}

interface GateEvaluation {
  id: string
  deploymentId: string
  service: string
  predictionScore: number
  riskScore: number
  combinedScore: number
  decision: GateDecision
  contributingFactors: string[]
  mitigations?: string[]
  timestamp: string
}

interface Anomaly {
  id: string
  type: AnomalyType
  description: string
  deviation: number // standard deviations
  service: string
  linkedDeploymentId?: string
  detectedAt: string
  sparklineData: number[]
}

interface RootCauseCandidate {
  deploymentId: string
  service: string
  confidence: number
  causalPattern: string
}

interface RemediationLog {
  id: string
  timestamp: string
  action: RemediationAction
  triggerScore: number
  triggerConfidence: number
  status: RemediationStatus
  outcome?: string
  deploymentId?: string
}

// ============================================================================
// Mock Data Generation (Seeded for hydration safety)
// ============================================================================

function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = state + 0x6D2B79F5 | 0
    let t = Math.imul(state ^ state >>> 15, 1 | state)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

const SERVICES = ["payment-service", "user-service", "analytics-service", "notification-service", "auth-service"]
const FACTORS = ["high_failure_rate", "large_change", "risky_timing", "new_author", "no_tests", "sensitive_files"]
const PATTERNS = [
  "Memory leak pattern detected similar to INC-4521",
  "High correlation with previous database timeout incidents",
  "Similar code changes caused issues in staging",
  "Author's recent deployments had elevated failure rate",
  "Change touches critical payment processing logic",
]

function generateMockEarlyWarnings(seed: number): EarlyWarning[] {
  const rand = seededRandom(seed)
  const count = Math.floor(rand() * 4)
  
  return Array.from({ length: count }, (_, i) => ({
    id: `warn-${i + 1}`,
    service: SERVICES[Math.floor(rand() * SERVICES.length)],
    predictionScore: 0.5 + rand() * 0.5,
    reason: PATTERNS[Math.floor(rand() * PATTERNS.length)],
    detectedAt: new Date(Date.now() - Math.floor(rand() * 3600000)).toISOString(),
    recommendedAction: rand() > 0.5 ? "Delay deployment until review" : "Add additional monitoring",
  }))
}

function generateMockGateEvaluations(seed: number): GateEvaluation[] {
  const rand = seededRandom(seed)
  
  return Array.from({ length: 15 }, (_, i) => {
    const predictionScore = rand()
    const riskScore = rand()
    const combinedScore = (predictionScore * 0.6 + riskScore * 0.4)
    const decision: GateDecision = combinedScore > 0.7 ? "block" : combinedScore > 0.4 ? "warn" : "proceed"
    
    const numFactors = Math.floor(rand() * 3) + 1
    const factors: string[] = []
    for (let j = 0; j < numFactors; j++) {
      const factor = FACTORS[Math.floor(rand() * FACTORS.length)]
      if (!factors.includes(factor)) factors.push(factor)
    }
    
    return {
      id: `eval-${i + 1}`,
      deploymentId: `deploy-${String(i + 1).padStart(4, "0")}`,
      service: SERVICES[Math.floor(rand() * SERVICES.length)],
      predictionScore,
      riskScore,
      combinedScore,
      decision,
      contributingFactors: factors,
      mitigations: decision === "block" ? [
        "Require manual approval from team lead",
        "Add rollback automation",
        "Enable enhanced monitoring for 24h",
      ] : undefined,
      timestamp: new Date(Date.now() - i * 3600000 - Math.floor(rand() * 1800000)).toISOString(),
    }
  })
}

function generateMockAnomalies(seed: number): Anomaly[] {
  const rand = seededRandom(seed)
  const types: AnomalyType[] = ["metric_deviation", "behavioral", "resource"]
  const descriptions = {
    metric_deviation: [
      "Response latency spike detected",
      "Error rate exceeded baseline",
      "Request throughput dropped significantly",
    ],
    behavioral: [
      "Unusual traffic pattern detected",
      "API call sequence anomaly",
      "User session duration outlier",
    ],
    resource: [
      "Memory utilization surge",
      "CPU usage anomaly",
      "Database connection pool exhaustion",
    ],
  }
  
  return Array.from({ length: 8 }, (_, i) => {
    const type = types[Math.floor(rand() * types.length)]
    const descs = descriptions[type]
    
    return {
      id: `anomaly-${i + 1}`,
      type,
      description: descs[Math.floor(rand() * descs.length)],
      deviation: 2.5 + rand() * 3,
      service: SERVICES[Math.floor(rand() * SERVICES.length)],
      linkedDeploymentId: rand() > 0.6 ? `deploy-${String(Math.floor(rand() * 50) + 1).padStart(4, "0")}` : undefined,
      detectedAt: new Date(Date.now() - i * 86400000 / 2 - Math.floor(rand() * 43200000)).toISOString(),
      sparklineData: generateSparklineData(20, "stable", seed + i * 100),
    }
  })
}

function generateMockRootCauses(seed: number): RootCauseCandidate[] {
  const rand = seededRandom(seed)
  
  return Array.from({ length: 3 }, (_, i) => ({
    deploymentId: `deploy-${String(Math.floor(rand() * 100) + 1).padStart(4, "0")}`,
    service: SERVICES[Math.floor(rand() * SERVICES.length)],
    confidence: 0.95 - i * 0.15 - rand() * 0.1,
    causalPattern: PATTERNS[Math.floor(rand() * PATTERNS.length)],
  }))
}

function generateMockRemediationLogs(seed: number): RemediationLog[] {
  const rand = seededRandom(seed)
  const actions: RemediationAction[] = ["rollback", "halt_canary", "scale_up", "notify_oncall"]
  const statuses: RemediationStatus[] = ["executed", "recommended", "overridden"]
  const outcomes = [
    "Service recovered within 2 minutes",
    "Canary stopped, no user impact",
    "Scaled to handle 150% traffic",
    "On-call acknowledged within 5 minutes",
    "Awaiting manual review",
    "User chose to proceed despite warning",
  ]
  
  return Array.from({ length: 10 }, (_, i) => ({
    id: `rem-${i + 1}`,
    timestamp: new Date(Date.now() - i * 86400000 - Math.floor(rand() * 43200000)).toISOString(),
    action: actions[Math.floor(rand() * actions.length)],
    triggerScore: 0.6 + rand() * 0.4,
    triggerConfidence: 0.7 + rand() * 0.3,
    status: statuses[Math.floor(rand() * statuses.length)],
    outcome: outcomes[Math.floor(rand() * outcomes.length)],
    deploymentId: `deploy-${String(Math.floor(rand() * 100) + 1).padStart(4, "0")}`,
  }))
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ============================================================================
// Components
// ============================================================================

function ModelStatusIndicator({ status }: { status: ModelStatus }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 border border-gray-200">
      <div className={cn(
        "h-2 w-2 rounded-full",
        status.active ? "bg-green-500" : "bg-amber-500"
      )} />
      <span className="text-sm font-medium text-gray-700">
        {status.active ? `Model Active — ${status.version}` : "Fallback: Rule Engine"}
      </span>
      <span className="text-xs text-gray-500">
        Last trained: {formatTimeAgo(status.lastTrained)}
      </span>
    </div>
  )
}

function StatCard({ 
  label, 
  value, 
  trend,
  trendValue,
  accent,
  icon: Icon,
}: { 
  label: string
  value: string | number
  trend?: "up" | "down" | "stable"
  trendValue?: string
  accent?: "orange" | "red" | "blue" | "green"
  icon: React.ElementType
}) {
  const accentColors = {
    orange: "border-l-amber-500 bg-amber-50",
    red: "border-l-red-500 bg-red-50",
    blue: "border-l-blue-500 bg-blue-50",
    green: "border-l-green-500 bg-green-50",
  }
  
  return (
    <div className={cn(
      "rounded-lg border border-gray-200 bg-white p-4 border-l-4",
      accent ? accentColors[accent] : "border-l-gray-300"
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          {trend && trendValue && (
            <div className={cn(
              "mt-1 flex items-center gap-1 text-xs font-medium",
              trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-gray-500"
            )}>
              {trend === "up" ? <TrendingUp className="h-3 w-3" /> : 
               trend === "down" ? <TrendingDown className="h-3 w-3" /> : 
               <Minus className="h-3 w-3" />}
              {trendValue}
            </div>
          )}
        </div>
        <div className={cn(
          "rounded-lg p-2",
          accent === "orange" ? "bg-amber-100" :
          accent === "red" ? "bg-red-100" :
          accent === "blue" ? "bg-blue-100" :
          accent === "green" ? "bg-green-100" : "bg-gray-100"
        )}>
          <Icon className={cn(
            "h-5 w-5",
            accent === "orange" ? "text-amber-600" :
            accent === "red" ? "text-red-600" :
            accent === "blue" ? "text-blue-600" :
            accent === "green" ? "text-green-600" : "text-gray-600"
          )} />
        </div>
      </div>
    </div>
  )
}

function ScoreGauge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const color = score > 0.7 ? "bg-red-500" : score > 0.4 ? "bg-amber-500" : "bg-green-500"
  const width = size === "sm" ? "w-16" : "w-24"
  const height = size === "sm" ? "h-1.5" : "h-2"
  
  return (
    <div className="flex items-center gap-2">
      <div className={cn("rounded-full bg-gray-200 overflow-hidden", width, height)}>
        <div 
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <span className={cn(
        "font-mono text-xs font-medium",
        score > 0.7 ? "text-red-600" : score > 0.4 ? "text-amber-600" : "text-green-600"
      )}>
        {score.toFixed(2)}
      </span>
    </div>
  )
}

function GateBadge({ decision }: { decision: GateDecision }) {
  const config = {
    proceed: { label: "Proceed", bg: "bg-green-100", text: "text-green-700", border: "border-green-200" },
    warn: { label: "Warn", bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200" },
    block: { label: "Block", bg: "bg-red-100", text: "text-red-700", border: "border-red-200" },
  }
  const c = config[decision]
  
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", c.bg, c.text, c.border)}>
      {c.label}
    </span>
  )
}

function FactorPill({ factor }: { factor: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
      {factor.replace(/_/g, " ")}
    </span>
  )
}

function AnomalyIcon({ type }: { type: AnomalyType }) {
  const icons = {
    metric_deviation: LineChart,
    behavioral: Activity,
    resource: Server,
  }
  const Icon = icons[type]
  return <Icon className="h-4 w-4" />
}

function EarlyWarningsPanel({ warnings }: { warnings: EarlyWarning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-green-100 p-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-semibold text-green-800">All Clear</h3>
            <p className="text-sm text-green-600">No active early warnings. All services operating normally.</p>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="space-y-3">
      {warnings.map((warning) => {
        const isHigh = warning.predictionScore > 0.8
        const borderColor = isHigh ? "border-l-red-500" : "border-l-amber-500"
        const bgColor = isHigh ? "bg-red-50" : "bg-amber-50"
        
        return (
          <div 
            key={warning.id}
            className={cn(
              "rounded-lg border border-gray-200 p-4 border-l-4",
              borderColor,
              bgColor
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-gray-900">{warning.service}</span>
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                    isHigh ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  )}>
                    {isHigh ? "Block Recommended" : "Warn"}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-2">{warning.reason}</p>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimeAgo(warning.detectedAt)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <ScoreGauge score={warning.predictionScore} />
                <button className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
                  {warning.recommendedAction}
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GateDecisionsTable({ evaluations }: { evaluations: GateEvaluation[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Deployment</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Service</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Prediction</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Risk</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Combined</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Decision</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Factors</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {evaluations.map((evaluation) => (
            <>
              <tr 
                key={evaluation.id}
                className="hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => setExpandedId(expandedId === evaluation.id ? null : evaluation.id)}
              >
                <td className="px-4 py-3">
                  <code className="text-xs font-mono text-gray-900">{evaluation.deploymentId}</code>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{evaluation.service}</td>
                <td className="px-4 py-3"><ScoreGauge score={evaluation.predictionScore} size="sm" /></td>
                <td className="px-4 py-3"><ScoreGauge score={evaluation.riskScore} size="sm" /></td>
                <td className="px-4 py-3"><ScoreGauge score={evaluation.combinedScore} size="sm" /></td>
                <td className="px-4 py-3"><GateBadge decision={evaluation.decision} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {evaluation.contributingFactors.slice(0, 2).map((factor) => (
                      <FactorPill key={factor} factor={factor} />
                    ))}
                    {evaluation.contributingFactors.length > 2 && (
                      <span className="text-xs text-gray-500">+{evaluation.contributingFactors.length - 2}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {evaluation.mitigations && (
                    <ChevronDown className={cn(
                      "h-4 w-4 text-gray-400 transition-transform",
                      expandedId === evaluation.id && "rotate-180"
                    )} />
                  )}
                </td>
              </tr>
              {expandedId === evaluation.id && evaluation.mitigations && (
                <tr key={`${evaluation.id}-expanded`}>
                  <td colSpan={8} className="px-4 py-3 bg-gray-50">
                    <div className="pl-4 border-l-2 border-red-300">
                      <p className="text-xs font-medium text-gray-700 mb-2">Required Mitigations:</p>
                      <ul className="space-y-1">
                        {evaluation.mitigations.map((mitigation, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                            <Shield className="h-3 w-3 text-red-500" />
                            {mitigation}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AnomalyFeed({ anomalies }: { anomalies: Anomaly[] }) {
  return (
    <div className="space-y-3">
      {anomalies.map((anomaly) => (
        <div 
          key={anomaly.id}
          className="flex items-start gap-4 p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
        >
          <div className={cn(
            "rounded-lg p-2",
            anomaly.type === "metric_deviation" ? "bg-purple-100" :
            anomaly.type === "behavioral" ? "bg-blue-100" : "bg-orange-100"
          )}>
            <AnomalyIcon type={anomaly.type} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-900">{anomaly.description}</span>
              <span className={cn(
                "text-xs font-mono font-medium px-1.5 py-0.5 rounded",
                anomaly.deviation > 4 ? "bg-red-100 text-red-700" :
                anomaly.deviation > 3 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"
              )}>
                {anomaly.deviation.toFixed(1)}σ
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{anomaly.service}</span>
              <span>{formatTimeAgo(anomaly.detectedAt)}</span>
              {anomaly.linkedDeploymentId && (
                <span className="flex items-center gap-1 text-blue-600">
                  <GitCommit className="h-3 w-3" />
                  {anomaly.linkedDeploymentId}
                </span>
              )}
            </div>
          </div>
          <div className="w-20 h-8 relative">
            <Sparkline 
              data={anomaly.sparklineData} 
              color={anomaly.deviation > 4 ? "#dc2626" : anomaly.deviation > 3 ? "#d97706" : "#6b7280"}
              width={80}
              height={32}
            />
            {/* 3σ threshold line */}
            <div className="absolute top-1/3 left-0 right-0 border-t border-dashed border-red-300" />
          </div>
        </div>
      ))}
    </div>
  )
}

function RootCausePanel({ candidates, expanded, onToggle }: { 
  candidates: RootCauseCandidate[]
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-gray-500" />
          <span className="font-medium text-gray-900">Root Cause Analysis</span>
          <span className="text-xs text-gray-500">Top 3 ranked deployments</span>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform", expanded && "rotate-180")} />
      </button>
      
      {expanded && (
        <div className="p-4 space-y-3">
          {candidates.map((candidate, idx) => (
            <div 
              key={candidate.deploymentId}
              className="flex items-start gap-4 p-3 rounded-lg border border-gray-200 bg-gray-50"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
                {idx + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-sm font-mono font-medium text-gray-900">{candidate.deploymentId}</code>
                  <span className="text-sm text-gray-500">{candidate.service}</span>
                </div>
                <p className="text-sm text-gray-600 mb-2">{candidate.causalPattern}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div 
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${candidate.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-600">{Math.round(candidate.confidence * 100)}%</span>
                </div>
              </div>
              <button className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
                Investigate
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RemediationTable({ logs, autoEnabled, onToggleAuto }: { 
  logs: RemediationLog[]
  autoEnabled: boolean
  onToggleAuto: () => void
}) {
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  
  const actionIcons: Record<RemediationAction, React.ElementType> = {
    rollback: RotateCcw,
    halt_canary: Pause,
    scale_up: ArrowUpRight,
    notify_oncall: Bell,
  }
  
  const statusColors: Record<RemediationStatus, string> = {
    executed: "bg-green-100 text-green-700",
    recommended: "bg-blue-100 text-blue-700",
    overridden: "bg-gray-100 text-gray-700",
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Auto-remediation</span>
          <button
            onClick={() => setShowConfirmModal(true)}
            className={cn(
              "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              autoEnabled ? "bg-blue-600" : "bg-gray-200"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
              autoEnabled ? "translate-x-5" : "translate-x-0"
            )} />
          </button>
          <span className={cn("text-xs", autoEnabled ? "text-green-600" : "text-gray-500")}>
            {autoEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      </div>
      
      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {autoEnabled ? "Disable" : "Enable"} Auto-Remediation?
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {autoEnabled 
                ? "Disabling auto-remediation will require manual intervention for all predicted incidents."
                : "Enabling auto-remediation will automatically execute rollbacks and other actions when high-confidence predictions are made."}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onToggleAuto()
                  setShowConfirmModal(false)
                }}
                className={cn(
                  "px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors",
                  autoEnabled ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {autoEnabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Timestamp</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Action</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Trigger</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map((log) => {
              const ActionIcon = actionIcons[log.action]
              return (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDateTime(log.timestamp)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ActionIcon className="h-4 w-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-900">{log.action.replace(/_/g, " ")}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-600">
                      <span className="font-mono">{log.triggerScore.toFixed(2)}</span>
                      <span className="text-gray-400 mx-1">@</span>
                      <span>{Math.round(log.triggerConfidence * 100)}% conf</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                      statusColors[log.status]
                    )}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{log.outcome}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function PredictionsPage() {
  const [mounted, setMounted] = useState(false)
  const [selectedService, setSelectedService] = useState<string>("all")
  const [timeRange, setTimeRange] = useState<string>("7d")
  const [predictionSource, setPredictionSource] = useState<PredictionSource>("all")
  const [rootCauseExpanded, setRootCauseExpanded] = useState(false)
  const [autoRemediationEnabled, setAutoRemediationEnabled] = useState(true)
  
  useEffect(() => {
    setMounted(true)
  }, [])
  
  // Use seeded data generation for hydration safety
  const modelStatus: ModelStatus = {
    active: true,
    version: "v1.3.2",
    lastTrained: "2026-06-02T14:30:00.000Z",
  }
  
  const earlyWarnings = useMemo(() => generateMockEarlyWarnings(42), [])
  const gateEvaluations = useMemo(() => generateMockGateEvaluations(123), [])
  const anomalies = useMemo(() => generateMockAnomalies(456), [])
  const rootCauses = useMemo(() => generateMockRootCauses(789), [])
  const remediationLogs = useMemo(() => generateMockRemediationLogs(1011), [])
  
  // Summary stats
  const predictionAccuracy = 87.3
  const activeWarnings = earlyWarnings.length
  const anomaliesCount = anomalies.filter(a => {
    const detectedDate = new Date(a.detectedAt)
    const dayAgo = new Date(Date.now() - 86400000)
    return detectedDate > dayAgo
  }).length
  const modelDrift = 0.42
  
  if (!mounted) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-200 rounded-lg" />)}
        </div>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Predictive Intelligence
          </h1>
          <p className="text-sm text-gray-500">
            ML-powered incident predictions and anomaly detection
          </p>
        </div>
        <ModelStatusIndicator status={modelStatus} />
      </div>
      
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Service</label>
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Services</option>
            {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Time Range</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Source</label>
          <div className="flex rounded-md border border-gray-200 overflow-hidden">
            {(["all", "ml_model", "rule_engine"] as PredictionSource[]).map((source) => (
              <button
                key={source}
                onClick={() => setPredictionSource(source)}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors",
                  predictionSource === source 
                    ? "bg-gray-900 text-white" 
                    : "bg-white text-gray-700 hover:bg-gray-50"
                )}
              >
                {source === "all" ? "All" : source === "ml_model" ? "ML Model" : "Rule Engine"}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Prediction Accuracy"
          value={`${predictionAccuracy}%`}
          trend="up"
          trendValue="+2.1% from last week"
          accent="green"
          icon={Target}
        />
        <StatCard
          label="Active Early Warnings"
          value={activeWarnings}
          accent={activeWarnings > 0 ? "orange" : undefined}
          icon={AlertTriangle}
        />
        <StatCard
          label="Anomalies (24h)"
          value={anomaliesCount}
          icon={Activity}
        />
        <StatCard
          label="Model Drift Score"
          value={modelDrift.toFixed(2)}
          accent={modelDrift > 0.7 ? "red" : undefined}
          icon={Gauge}
        />
      </div>
      
      {/* Section 1: Early Warnings */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Early Warnings
        </h2>
        <EarlyWarningsPanel warnings={earlyWarnings} />
      </section>
      
      {/* Section 2: Gate Decisions */}
      <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            Deployment Gate Decisions
          </h2>
        </div>
        <GateDecisionsTable evaluations={gateEvaluations} />
      </section>
      
      {/* Section 3: Anomaly Detection */}
      <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-500" />
            Anomaly Detection Feed
            <span className="text-xs font-normal text-gray-500">Last 7 days</span>
          </h2>
        </div>
        <div className="p-4">
          <AnomalyFeed anomalies={anomalies} />
        </div>
      </section>
      
      {/* Section 4: Root Cause Analysis */}
      <section>
        <RootCausePanel 
          candidates={rootCauses} 
          expanded={rootCauseExpanded}
          onToggle={() => setRootCauseExpanded(!rootCauseExpanded)}
        />
      </section>
      
      {/* Section 5: Automated Remediation */}
      <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Automated Remediation Log
          </h2>
        </div>
        <div className="p-4">
          <RemediationTable 
            logs={remediationLogs}
            autoEnabled={autoRemediationEnabled}
            onToggleAuto={() => setAutoRemediationEnabled(!autoRemediationEnabled)}
          />
        </div>
      </section>
      
      {/* Footer Note */}
      <div className="text-xs text-gray-500 text-center py-4 border-t border-gray-200">
        Predictions require minimum 100 deployment events and 10 incidents for ML model training. 
        Below threshold: rule-based scoring is used.
      </div>
    </div>
  )
}
