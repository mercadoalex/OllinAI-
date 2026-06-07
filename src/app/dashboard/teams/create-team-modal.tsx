"use client"

import { useState } from "react"
import { X, Plus } from "lucide-react"
import type { Team, TeamMember } from "./data"

interface CreateTeamModalProps {
  open: boolean
  onClose: () => void
  onCreate: (team: Team) => void
}

export function CreateTeamModal({ open, onClose, onCreate }: CreateTeamModalProps) {
  const [name, setName] = useState("")
  const [emailInput, setEmailInput] = useState("")
  const [members, setMembers] = useState<TeamMember[]>([])
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  function reset() {
    setName("")
    setEmailInput("")
    setMembers([])
    setError(null)
  }

  function addMember() {
    const email = emailInput.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.")
      return
    }
    if (members.some((m) => m.email === email)) {
      setError("That member is already added.")
      return
    }
    const namePart = email
      .split("@")[0]
      .split(/[.\-_]/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
    setMembers((prev) => [...prev, { name: namePart, email }])
    setEmailInput("")
    setError(null)
  }

  function handleSubmit() {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 100) {
      setError("Team name must be between 1 and 100 characters.")
      return
    }
    onCreate({
      id: `team-${Date.now()}`,
      name: trimmed,
      members,
      ownedServices: [],
      deployFrequencyPerWeek: 0,
      changeFailureRate: 0,
      mttrHours: 0,
      health: "healthy",
    })
    reset()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Create Team</h2>
          <button
            type="button"
            onClick={() => {
              reset()
              onClose()
            }}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <label htmlFor="team-name" className="mb-1.5 block text-sm font-medium text-gray-700">
              Team name
            </label>
            <input
              id="team-name"
              type="text"
              value={name}
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder="e.g. Platform Engineering"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-right text-xs text-gray-400">{name.length}/100</p>
          </div>

          <div>
            <label htmlFor="member-email" className="mb-1.5 block text-sm font-medium text-gray-700">
              Add members
            </label>
            <div className="flex gap-2">
              <input
                id="member-email"
                type="email"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addMember()
                  }
                }}
                placeholder="name@company.com"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={addMember}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>

            {members.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {members.map((m) => (
                  <li
                    key={m.email}
                    className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
                  >
                    <span className="truncate">{m.email}</span>
                    <button
                      type="button"
                      onClick={() => setMembers((prev) => prev.filter((x) => x.email !== m.email))}
                      className="ml-2 text-gray-400 hover:text-rose-600"
                      aria-label={`Remove ${m.email}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={() => {
              reset()
              onClose()
            }}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
