"use client"

/**
 * Teams Management Page
 * Team structure, service ownership, and performance
 */

import { useState, useEffect, useMemo } from "react"
import {
  Search,
  Plus,
  Users,
  X,
  MoreHorizontal,
  Rocket,
  Archive,
  Edit3,
  Trash2,
  ArrowRight,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Sparkline, generateSparklineData } from "@/components/sparkline"
import { formatDistanceToNow, formatDate } from "@/lib/date-utils"

// Types
type RiskLevel = "low" | "medium" | "high" | "critical"

interface TeamMember {
  id: string
  name: string
  email: string
  role: "lead" | "member"
  avatarInitials: string
  lastDeploymentTimestamp: string | null
}

interface OwnedService {
  id: string
  name: string
  deployFrequency: number
  riskTrend: number[] // sparkline data
  lastRiskLevel: RiskLevel
}

interface TeamRecommendation {
  id: string
  type: "reduce_change_size" | "adjust_timing" | "improve_testing" | "review_ownership"
  title: string
  description: string
  priority: "low" | "medium" | "high"
  dismissed: boolean
}

interface Team {
  id: string
  name: string
  description: string
  memberCount: number
  members: TeamMember[]
  ownedServices: OwnedService[]
  deployFrequency: number
  changeFailureRate: number
  leadTimeHours: number
  mttrHours: number
  lastActiveTimestamp: string
  healthStatus: "healthy" | "warning" | "critical"
  recommendations: TeamRecommendation[]
  deploymentTimeline: {
    id: string
    timestamp: string
    serviceName: string
    author: string
    riskLevel: RiskLevel
  }[]
}

// Seeded random for consistent SSR/client rendering
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

// Generate deterministic mock data
function generateMockTeams(): Team[] {
  const teamData = [
    { name: "Platform Team", description: "Core platform infrastructure and shared services" },
    { name: "Payments Team", description: "Payment processing and financial services" },
    { name: "Growth Team", description: "User acquisition and engagement features" },
    { name: "Infrastructure", description: "DevOps, CI/CD, and cloud infrastructure" },
    { name: "Mobile Team", description: "iOS and Android application development" },
    { name: "Data Team", description: "Analytics, data pipelines, and ML infrastructure" },
  ]

  const firstNames = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Henry", "Ivy", "Jack", "Kate", "Liam", "Mia", "Noah", "Olivia", "Peter"]
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"]
  
  const serviceNames = [
    "user-service", "payment-service", "auth-service", "notification-service",
    "analytics-service", "inventory-service", "order-service", "shipping-service",
    "catalog-service", "search-service", "recommendation-service", "email-service",
    "cache-service", "gateway-service", "logging-service", "metrics-service"
  ]

  const recommendationTypes: TeamRecommendation["type"][] = ["reduce_change_size", "adjust_timing", "improve_testing", "review_ownership"]
  const recommendationData: Record<TeamRecommendation["type"], { title: string; description: string }> = {
    reduce_change_size: {
      title: "Reduce Change Size",
      description: "Recent deployments have been large. Consider breaking changes into smaller, more frequent releases."
    },
    adjust_timing: {
      title: "Adjust Deployment Timing",
      description: "Deployments during high-traffic periods have higher failure rates. Consider scheduling during off-peak hours."
    },
    improve_testing: {
      title: "Improve Test Coverage",
      description: "Services with lower test coverage have shown higher incident rates. Focus on critical paths."
    },
    review_ownership: {
      title: "Review Service Ownership",
      description: "Some services have unclear ownership. Ensure each service has a designated owner."
    }
  }

  return teamData.map((team, teamIndex) => {
    const rand = seededRandom(teamIndex * 1000 + 42)
    
    // Generate members
    const memberCount = 4 + Math.floor(rand() * 8) // 4-11 members
    const members: TeamMember[] = Array.from({ length: memberCount }, (_, i) => {
      const r = seededRandom(teamIndex * 1000 + i * 100 + 100)
      const firstName = firstNames[Math.floor(r() * firstNames.length)]
      const lastName = lastNames[Math.floor(r() * lastNames.length)]
      const daysAgo = Math.floor(r() * 30)
      return {
        id: `member-${teamIndex}-${i}`,
        name: `${firstName} ${lastName}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@company.com`,
        role: i === 0 ? "lead" : "member",
        avatarInitials: `${firstName[0]}${lastName[0]}`,
        lastDeploymentTimestamp: daysAgo < 25 
          ? new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
          : null
      }
    })

    // Generate owned services
    const serviceCount = 2 + Math.floor(rand() * 4) // 2-5 services
    const startServiceIndex = teamIndex * 3
    const ownedServices: OwnedService[] = Array.from({ length: serviceCount }, (_, i) => {
      const r = seededRandom(teamIndex * 1000 + i * 100 + 200)
      const serviceName = serviceNames[(startServiceIndex + i) % serviceNames.length]
      const riskScore = r()
      const lastRiskLevel: RiskLevel = 
        riskScore < 0.3 ? "low" :
        riskScore < 0.55 ? "medium" :
        riskScore < 0.75 ? "high" : "critical"
      
      return {
        id: `svc-${teamIndex}-${i}`,
        name: serviceName,
        deployFrequency: Math.round((1 + r() * 10) * 10) / 10,
        riskTrend: Array.from({ length: 20 }, (_, j) => {
          const rr = seededRandom(teamIndex * 1000 + i * 100 + j * 10 + 300)
          return Math.max(0, Math.min(1, 0.2 + rr() * 0.6))
        }),
        lastRiskLevel
      }
    })

    // DORA metrics
    const deployFrequency = Math.round((2 + rand() * 12) * 10) / 10
    const changeFailureRate = Math.round((5 + rand() * 30) * 10) / 10
    const leadTimeHours = Math.round((8 + rand() * 72) * 10) / 10
    const mttrHours = Math.round((0.5 + rand() * 8) * 10) / 10

    // Health status based on CFR
    const healthStatus: Team["healthStatus"] = 
      changeFailureRate < 15 ? "healthy" :
      changeFailureRate < 25 ? "warning" : "critical"

    // Last active (most recent deployment)
    const daysAgoActive = Math.floor(rand() * 7)
    const lastActiveTimestamp = new Date(Date.now() - daysAgoActive * 24 * 60 * 60 * 1000).toISOString()

    // Recommendations
    const recCount = Math.floor(rand() * 3) // 0-2 recommendations
    const recommendations: TeamRecommendation[] = Array.from({ length: recCount }, (_, i) => {
      const r = seededRandom(teamIndex * 1000 + i * 100 + 400)
      const type = recommendationTypes[Math.floor(r() * recommendationTypes.length)]
      const priorities: TeamRecommendation["priority"][] = ["low", "medium", "high"]
      return {
        id: `rec-${teamIndex}-${i}`,
        type,
        title: recommendationData[type].title,
        description: recommendationData[type].description,
        priority: priorities[Math.floor(r() * 3)],
        dismissed: false
      }
    })

    // Deployment timeline (last 30 days)
    const deploymentCount = 15 + Math.floor(rand() * 20)
    const deploymentTimeline = Array.from({ length: deploymentCount }, (_, i) => {
      const r = seededRandom(teamIndex * 1000 + i * 50 + 500)
      const daysAgo = Math.floor(r() * 30)
      const serviceIdx = Math.floor(r() * ownedServices.length)
      const riskScore = r()
      const riskLevel: RiskLevel = 
        riskScore < 0.3 ? "low" :
        riskScore < 0.55 ? "medium" :
        riskScore < 0.75 ? "high" : "critical"
      const memberIdx = Math.floor(r() * members.length)
      
      return {
        id: `deploy-${teamIndex}-${i}`,
        timestamp: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
        serviceName: ownedServices[serviceIdx]?.name || "unknown-service",
        author: members[memberIdx]?.name || "Unknown",
        riskLevel
      }
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return {
      id: `team-${teamIndex + 1}`,
      name: team.name,
      description: team.description,
      memberCount,
      members,
      ownedServices,
      deployFrequency,
      changeFailureRate,
      leadTimeHours,
      mttrHours,
      lastActiveTimestamp,
      healthStatus,
      recommendations,
      deploymentTimeline
    }
  })
}

const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showArchiveModal, setShowArchiveModal] = useState<Team | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setTeams(generateMockTeams())
  }, [])

  // Filter teams
  const filteredTeams = useMemo(() => {
    return teams.filter(team =>
      team.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [teams, searchQuery])

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalTeams = teams.length
    const totalMembers = teams.reduce((sum, t) => sum + t.memberCount, 0)
    const topPerforming = teams.reduce((best, team) => 
      team.changeFailureRate < (best?.changeFailureRate ?? 100) ? team : best
    , teams[0])
    
    return { totalTeams, totalMembers, topPerforming }
  }, [teams])

  const handleDismissRecommendation = (teamId: string, recId: string) => {
    setTeams(prev => prev.map(team => 
      team.id === teamId
        ? {
            ...team,
            recommendations: team.recommendations.map(rec =>
              rec.id === recId ? { ...rec, dismissed: true } : rec
            )
          }
        : team
    ))
    if (selectedTeam?.id === teamId) {
      setSelectedTeam(prev => prev ? {
        ...prev,
        recommendations: prev.recommendations.map(rec =>
          rec.id === recId ? { ...rec, dismissed: true } : rec
        )
      } : null)
    }
  }

  // Empty state
  if (mounted && teams.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-gray-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No teams created yet
            </h2>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Teams help you organize services and track DORA metrics by group.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Team
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                Teams
              </h1>
              <p className="text-sm text-gray-500">
                Team structure, service ownership, and performance
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <Plus className="h-4 w-4" />
              Create Team
            </button>
          </div>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search teams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500 mb-1">Total Teams</p>
            <p className="text-2xl font-bold text-gray-900">{summaryStats.totalTeams}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500 mb-1">Total Members</p>
            <p className="text-2xl font-bold text-gray-900">{summaryStats.totalMembers}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500 mb-1">Top Performing Team</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-green-600">
                {summaryStats.topPerforming?.name || "—"}
              </p>
              {summaryStats.topPerforming && (
                <span className="text-xs text-gray-500">
                  ({summaryStats.topPerforming.changeFailureRate}% CFR)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Team Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              mounted={mounted}
              onViewDetails={() => setSelectedTeam(team)}
              onArchive={() => setShowArchiveModal(team)}
            />
          ))}
        </div>

        {filteredTeams.length === 0 && searchQuery && (
          <div className="text-center py-12">
            <p className="text-gray-500">No teams match your search.</p>
          </div>
        )}
      </div>

      {/* Team Detail Panel */}
      {selectedTeam && (
        <TeamDetailPanel
          team={selectedTeam}
          mounted={mounted}
          onClose={() => setSelectedTeam(null)}
          onDismissRecommendation={(recId) => handleDismissRecommendation(selectedTeam.id, recId)}
        />
      )}

      {/* Create Team Modal */}
      {showCreateModal && (
        <CreateTeamModal onClose={() => setShowCreateModal(false)} />
      )}

      {/* Archive Team Modal */}
      {showArchiveModal && (
        <ArchiveTeamModal
          team={showArchiveModal}
          onClose={() => setShowArchiveModal(null)}
          onConfirm={() => {
            setTeams(prev => prev.filter(t => t.id !== showArchiveModal.id))
            setShowArchiveModal(null)
          }}
        />
      )}
    </div>
  )
}

// Team Card Component
function TeamCard({
  team,
  mounted,
  onViewDetails,
  onArchive
}: {
  team: Team
  mounted: boolean
  onViewDetails: () => void
  onArchive: () => void
}) {
  const [showMenu, setShowMenu] = useState(false)

  const healthColors = {
    healthy: "bg-green-500",
    warning: "bg-amber-500",
    critical: "bg-red-500"
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-3 h-3 rounded-full",
            healthColors[team.healthStatus]
          )} />
          <div>
            <h3 className="font-semibold text-gray-900">{team.name}</h3>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {team.memberCount} members
            </span>
          </div>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <MoreHorizontal className="h-4 w-4 text-gray-500" />
          </button>
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                <button
                  onClick={() => { onViewDetails(); setShowMenu(false) }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <Edit3 className="h-4 w-4" />
                  Edit
                </button>
                <button
                  onClick={() => { onArchive(); setShowMenu(false) }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 text-red-600 flex items-center gap-2"
                >
                  <Archive className="h-4 w-4" />
                  Archive
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Member Avatars */}
      <div className="flex items-center gap-1 mb-4">
        {team.members.slice(0, 5).map((member, index) => (
          <div
            key={member.id}
            className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 border-2 border-white -ml-2 first:ml-0"
            title={member.name}
          >
            {member.avatarInitials}
          </div>
        ))}
        {team.memberCount > 5 && (
          <span className="text-xs text-gray-500 ml-2">
            +{team.memberCount - 5} more
          </span>
        )}
      </div>

      {/* Owned Services */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 mb-2">Owned Services</p>
        <div className="flex flex-wrap gap-1.5">
          {team.ownedServices.slice(0, 5).map((service) => (
            <span
              key={service.id}
              className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-md"
            >
              {service.name}
            </span>
          ))}
          {team.ownedServices.length > 5 && (
            <span className="text-xs text-gray-500">
              +{team.ownedServices.length - 5} more
            </span>
          )}
        </div>
      </div>

      {/* Mini DORA Metrics */}
      <div className="grid grid-cols-3 gap-3 mb-4 py-3 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-500">Deploy Freq</p>
          <p className="text-sm font-semibold text-gray-900">{team.deployFrequency}/day</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">CFR</p>
          <p className={cn(
            "text-sm font-semibold",
            team.changeFailureRate < 15 ? "text-green-600" :
            team.changeFailureRate < 25 ? "text-amber-600" : "text-red-600"
          )}>
            {team.changeFailureRate}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">MTTR</p>
          <p className="text-sm font-semibold text-gray-900">{team.mttrHours}h</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-500">
          Last active: {mounted ? formatDistanceToNow(new Date(team.lastActiveTimestamp)) : "—"}
        </span>
        <button
          onClick={onViewDetails}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          View Details
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// Team Detail Panel Component
function TeamDetailPanel({
  team,
  mounted,
  onClose,
  onDismissRecommendation
}: {
  team: Team
  mounted: boolean
  onClose: () => void
  onDismissRecommendation: (recId: string) => void
}) {
  const [showAddMember, setShowAddMember] = useState(false)
  const [showAssignService, setShowAssignService] = useState(false)

  const activeRecommendations = team.recommendations.filter(r => !r.dismissed)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{team.name}</h2>
            <p className="text-sm text-gray-500">{team.description}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Members Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Members</h3>
                <p className="text-sm text-gray-500">{team.memberCount}/200 members</p>
              </div>
              <button
                onClick={() => setShowAddMember(true)}
                disabled={team.memberCount >= 200}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" />
                Add Member
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Last Deploy</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {team.members.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                            {member.avatarInitials}
                          </div>
                          <span className="text-sm font-medium text-gray-900">{member.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{member.email}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "text-xs px-2 py-1 rounded-full font-medium",
                          member.role === "lead"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        )}>
                          {member.role === "lead" ? "Team Lead" : "Member"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {member.lastDeploymentTimestamp && mounted
                          ? formatDistanceToNow(new Date(member.lastDeploymentTimestamp))
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {member.role !== "lead" && (
                          <button className="text-xs text-red-600 hover:text-red-700">
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Owned Services Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Owned Services</h3>
              <button
                onClick={() => setShowAssignService(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Assign Service
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {team.ownedServices.map((service) => (
                <div
                  key={service.id}
                  className="bg-gray-50 rounded-lg p-4 border border-gray-100"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-medium text-gray-900">{service.name}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      service.lastRiskLevel === "low" ? "bg-green-100 text-green-700" :
                      service.lastRiskLevel === "medium" ? "bg-amber-100 text-amber-700" :
                      service.lastRiskLevel === "high" ? "bg-orange-100 text-orange-700" :
                      "bg-red-100 text-red-700"
                    )}>
                      {service.lastRiskLevel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {service.deployFrequency} deploys/day
                    </span>
                    <Sparkline
                      data={service.riskTrend}
                      color={RISK_COLORS[service.lastRiskLevel]}
                      width={60}
                      height={20}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Full DORA Metrics */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">DORA Metrics (Last 30d)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label="Deploy Frequency"
                value={`${team.deployFrequency}`}
                unit="/day"
                trend="up"
              />
              <MetricCard
                label="Lead Time"
                value={`${team.leadTimeHours}`}
                unit="hours"
                trend="down"
              />
              <MetricCard
                label="Change Failure Rate"
                value={`${team.changeFailureRate}`}
                unit="%"
                trend={team.changeFailureRate < 15 ? "good" : team.changeFailureRate < 25 ? "warning" : "bad"}
                highlight
              />
              <MetricCard
                label="MTTR"
                value={`${team.mttrHours}`}
                unit="hours"
                trend="down"
              />
            </div>
          </section>

          {/* Team Deployment Timeline */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Deployment Timeline (Last 30d)</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              {/* Timeline dots */}
              <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-2">
                {team.deploymentTimeline.slice(0, 30).map((deploy, index) => (
                  <div
                    key={deploy.id}
                    className="flex-shrink-0"
                    title={`${deploy.serviceName} by ${deploy.author} - ${deploy.riskLevel}`}
                  >
                    <div
                      className="w-3 h-3 rounded-full cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-gray-300"
                      style={{ backgroundColor: RISK_COLORS[deploy.riskLevel] }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500" /> Low
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-amber-500" /> Medium
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-orange-500" /> High
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500" /> Critical
                </span>
              </div>
            </div>
          </section>

          {/* Team Recommendations */}
          {activeRecommendations.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Recommendations</h3>
              <div className="space-y-3">
                {activeRecommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className={cn(
                      "rounded-lg p-4 border",
                      rec.priority === "high" ? "bg-red-50 border-red-200" :
                      rec.priority === "medium" ? "bg-amber-50 border-amber-200" :
                      "bg-blue-50 border-blue-200"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900">{rec.title}</span>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            rec.priority === "high" ? "bg-red-100 text-red-700" :
                            rec.priority === "medium" ? "bg-amber-100 text-amber-700" :
                            "bg-blue-100 text-blue-700"
                          )}>
                            {rec.priority}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{rec.description}</p>
                      </div>
                      <button
                        onClick={() => onDismissRecommendation(rec.id)}
                        className="p-1.5 rounded-lg hover:bg-white/50 transition-colors"
                        title="Dismiss"
                      >
                        <X className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}

// Metric Card Component
function MetricCard({
  label,
  value,
  unit,
  trend,
  highlight
}: {
  label: string
  value: string
  unit: string
  trend: "up" | "down" | "good" | "warning" | "bad"
  highlight?: boolean
}) {
  const trendColors = {
    up: "text-green-600",
    down: "text-green-600",
    good: "text-green-600",
    warning: "text-amber-600",
    bad: "text-red-600"
  }

  return (
    <div className={cn(
      "bg-white rounded-lg p-4 border",
      highlight && trend === "bad" ? "border-red-200" :
      highlight && trend === "warning" ? "border-amber-200" :
      "border-gray-200"
    )}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={cn(
          "text-xl font-bold",
          highlight ? trendColors[trend] : "text-gray-900"
        )}>
          {value}
        </span>
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
    </div>
  )
}

// Create Team Modal
function CreateTeamModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("")
  const [emails, setEmails] = useState("")

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-xl shadow-xl z-50">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Create Team</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 100))}
              placeholder="e.g., Platform Team"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">{name.length}/100 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Initial Members (optional)
            </label>
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="Enter email addresses, separated by commas"
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Members will receive an invitation email
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </>
  )
}

// Archive Team Modal
function ArchiveTeamModal({
  team,
  onClose,
  onConfirm
}: {
  team: Team
  onClose: () => void
  onConfirm: () => void
}) {
  const hasServices = team.ownedServices.length > 0

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-xl shadow-xl z-50">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Archive Team</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {hasServices ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-lg border border-amber-200">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    This team owns {team.ownedServices.length} service{team.ownedServices.length !== 1 ? "s" : ""}
                  </p>
                  <p className="text-sm text-amber-700 mt-1">
                    Transfer ownership before archiving.
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Owned Services:</p>
                <div className="flex flex-wrap gap-2">
                  {team.ownedServices.map((service) => (
                    <span
                      key={service.id}
                      className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-md"
                    >
                      {service.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-600 mb-2">
                Are you sure you want to archive <strong>{team.name}</strong>?
              </p>
              <p className="text-sm text-gray-500">
                This action cannot be undone.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={hasServices}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Archive Team
          </button>
        </div>
      </div>
    </>
  )
}
