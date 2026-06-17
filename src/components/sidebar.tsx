"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: "📊" },
  { name: "Deployments", href: "/dashboard/deployments", icon: "🚀" },
  { name: "Incidents", href: "/dashboard/incidents", icon: "⚠️" },
  { name: "Services", href: "/dashboard/services", icon: "📦" },
  { name: "Teams", href: "/dashboard/teams", icon: "👥" },
  { name: "Predictions", href: "/dashboard/predictions", icon: "📈" },
  { name: "Settings", href: "/dashboard/settings", icon: "⚙️" },
  { name: "Docs", href: "/docs", icon: "📖" },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-gray-900">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-2 px-6 border-b border-gray-800">
        <Image
          src="/ollin_logo_black.png"
          alt="OllinAI"
          width={100}
          height={28}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/dashboard" && pathname?.startsWith(item.href))

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-800 p-4 space-y-4">
        <button
          onClick={() => signOut({ callbackUrl: "/sign-in" })}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <span className="text-lg">🚪</span>
          Sign out
        </button>

        {/* Brand watermark */}
        <div className="flex items-center justify-center pt-2 opacity-30">
          <Image
            src="/ollin_logo_black.png"
            alt=""
            width={80}
            height={22}
            className="pointer-events-none select-none"
            aria-hidden="true"
          />
        </div>
      </div>
    </aside>
  )
}
