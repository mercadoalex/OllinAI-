"use client";

import Link from "next/link";
import Image from "next/image";
import { Search } from "lucide-react";

export function DocsTopNav({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950">
      <div className="flex items-center gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="flex shrink-0 items-center">
          <Image
            src="/ollin_logo_white.png"
            alt="OllinAI"
            width={120}
            height={32}
            priority
            className="h-7 w-auto"
          />
        </Link>

        <div className="hidden items-center md:flex">
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
            Docs
          </span>
        </div>

        <div className="relative ml-auto w-full max-w-xs md:ml-4 md:mr-auto">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search documentation..."
            aria-label="Search documentation"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <nav className="hidden items-center gap-6 lg:flex">
          <Link
            href="/dashboard"
            className="text-sm text-slate-300 transition-colors hover:text-white"
          >
            Back to Dashboard
          </Link>
          <a
            href="#api"
            className="text-sm text-slate-300 transition-colors hover:text-white"
          >
            API Reference
          </a>
          <Link
            href="/sign-in"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Sign In
          </Link>
        </nav>
      </div>
    </header>
  );
}
