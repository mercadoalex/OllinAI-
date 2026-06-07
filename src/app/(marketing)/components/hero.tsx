import Link from "next/link";
import { ArrowRight, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* subtle background accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, oklch(0.62 0.18 255 / 0.18), transparent 70%)",
        }}
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Change Intelligence &amp; Deployment Risk
          </span>

          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Know if your next deploy will break production — before you ship
          </h1>

          <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            OllinAI correlates deployments with incidents, scores risk with ML,
            and gives your team actionable DORA metrics across every service.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              See How It Works
            </a>
          </div>
        </div>

        <DashboardMockup />
      </div>
    </section>
  );
}

function DashboardMockup() {
  return (
    <div className="relative">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Deployment Risk Overview</p>
            <p className="text-xs text-muted-foreground">payments-service · prod</p>
          </div>
          <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-accent">
            Live
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MetricTile label="Risk Score" value="18" hint="Low" tone="good" />
          <MetricTile label="Deploy Freq" value="12/day" hint="Elite" tone="good" />
          <MetricTile label="CFR" value="4.2%" hint="-1.3%" tone="good" />
        </div>

        <div className="mt-3 rounded-xl border border-border bg-background/60 p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Risk distribution (last 30 deploys)</span>
            <span>MTTR 24m</span>
          </div>
          <div className="flex h-24 items-end gap-1.5">
            {[30, 22, 40, 18, 55, 28, 35, 20, 62, 24, 38, 16, 45, 26, 33].map(
              (h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-primary/70"
                  style={{
                    height: `${h}%`,
                    backgroundColor:
                      h > 50
                        ? "oklch(0.65 0.2 25)"
                        : h > 35
                          ? "oklch(0.75 0.16 75)"
                          : "oklch(0.62 0.18 255)",
                  }}
                />
              ),
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15">
            <ShieldCheck className="h-5 w-5 text-accent" />
          </span>
          <div className="text-xs">
            <p className="font-medium">Next deploy cleared</p>
            <p className="text-muted-foreground">
              Confidence 94% · 0 blocking signals
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "bad";
}) {
  const Icon = tone === "good" ? TrendingDown : TrendingUp;
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-accent">
        <Icon className="h-3 w-3" />
        {hint}
      </p>
    </div>
  );
}
