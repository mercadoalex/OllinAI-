"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { TEAMS } from "./data"

export function RegisterServiceModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, team: string) => void
}) {
  const [name, setName] = useState("")
  const [team, setTeam] = useState<string>(TEAMS[0])
  const [touched, setTouched] = useState(false)

  if (!open) return null

  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 150

  function submit() {
    setTouched(true)
    if (!valid) return
    onCreate(trimmed, team)
    setName("")
    setTeam(TEAMS[0])
    setTouched(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-service-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl ring-1 ring-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 id="register-service-title" className="text-base font-semibold text-gray-900">
            Register service
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="svc-name" className="text-sm font-medium text-gray-700">
              Service name
            </label>
            <input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. payments-worker"
              maxLength={150}
              autoFocus
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
            <div className="flex items-center justify-between">
              {touched && !valid ? (
                <span className="text-xs text-red-600">Name must be 1–150 characters</span>
              ) : (
                <span className="text-xs text-gray-400">1–150 characters</span>
              )}
              <span className="text-xs text-gray-400">{trimmed.length}/150</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="svc-team" className="text-sm font-medium text-gray-700">
              Owning team
            </label>
            <select
              id="svc-team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            >
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
