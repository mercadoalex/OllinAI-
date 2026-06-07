import type { LucideIcon } from "lucide-react"
import { GitBranch, GitMerge, Webhook } from "lucide-react"

export type IntegrationType = "GitHub" | "GitLab" | "Custom"

export type Integration = {
  id: string
  name: string
  type: IntegrationType
  active: boolean
  lastEventAt: string
}

export const integrationTypeStyles: Record<
  IntegrationType,
  { badge: string; icon: LucideIcon }
> = {
  GitHub: { badge: "bg-gray-100 text-gray-700 ring-1 ring-gray-200", icon: GitMerge },
  GitLab: { badge: "bg-orange-100 text-orange-700 ring-1 ring-orange-200", icon: GitBranch },
  Custom: { badge: "bg-blue-100 text-blue-700 ring-1 ring-blue-200", icon: Webhook },
}

export const sampleIntegrations: Integration[] = [
  {
    id: "int_gh_main",
    name: "ollin-platform / monorepo",
    type: "GitHub",
    active: true,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
  {
    id: "int_gh_infra",
    name: "ollin-platform / infrastructure",
    type: "GitHub",
    active: true,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
  },
  {
    id: "int_gl_legacy",
    name: "legacy-systems / billing-core",
    type: "GitLab",
    active: true,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: "int_custom_ci",
    name: "Jenkins CI Webhook",
    type: "Custom",
    active: false,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
  },
]

export type RiskFactorKey =
  | "changeFailureRate"
  | "changeSize"
  | "deploymentTiming"
  | "authorFailureRate"

export type RiskFactor = {
  key: RiskFactorKey
  label: string
  description: string
}

export const riskFactors: RiskFactor[] = [
  {
    key: "changeFailureRate",
    label: "Change Failure Rate",
    description: "Historical rate of failures for similar changes",
  },
  {
    key: "changeSize",
    label: "Change Size",
    description: "Lines changed, files touched, and blast radius",
  },
  {
    key: "deploymentTiming",
    label: "Deployment Timing",
    description: "Time of day, day of week, and freeze windows",
  },
  {
    key: "authorFailureRate",
    label: "Author Failure Rate",
    description: "The author's historical deployment success",
  },
]

export const defaultRiskWeights: Record<RiskFactorKey, number> = {
  changeFailureRate: 0.35,
  changeSize: 0.25,
  deploymentTiming: 0.2,
  authorFailureRate: 0.2,
}

export type PlanTier = "Starter" | "Pro" | "Enterprise"

export const currentPlan: PlanTier = "Starter"

export type PlanFeatureRow = {
  feature: string
  values: Record<PlanTier, string>
}

export const planTiers: { name: PlanTier; price: string; cadence: string }[] = [
  { name: "Starter", price: "$0", cadence: "/mo" },
  { name: "Pro", price: "$299", cadence: "/mo" },
  { name: "Enterprise", price: "Custom", cadence: "" },
]

export const planFeatures: PlanFeatureRow[] = [
  { feature: "Connected services", values: { Starter: "5", Pro: "50", Enterprise: "Unlimited" } },
  { feature: "API calls / month", values: { Starter: "10K", Pro: "500K", Enterprise: "Unlimited" } },
  { feature: "Risk predictions", values: { Starter: "Basic", Pro: "Advanced", Enterprise: "Advanced" } },
  { feature: "History retention", values: { Starter: "30 days", Pro: "1 year", Enterprise: "Unlimited" } },
  { feature: "Team members", values: { Starter: "3", Pro: "25", Enterprise: "Unlimited" } },
  { feature: "SSO / SAML", values: { Starter: "—", Pro: "—", Enterprise: "Included" } },
  { feature: "Priority support", values: { Starter: "—", Pro: "Email", Enterprise: "Dedicated" } },
]

export const usage = {
  servicesUsed: 3,
  servicesLimit: 5,
  apiCalls: 6840,
  apiCallsLimit: 10000,
}
