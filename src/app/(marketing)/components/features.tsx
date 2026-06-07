import {
  Gauge,
  GitMerge,
  BarChart3,
  BrainCircuit,
  ShieldAlert,
  Wrench,
} from "lucide-react";

const features = [
  {
    icon: Gauge,
    title: "Predictive Risk Scoring",
    description:
      "Score every deployment before it ships. Block high-risk changes automatically.",
  },
  {
    icon: GitMerge,
    title: "Incident Correlation",
    description:
      "Automatically link production incidents to the deployment that caused them. Cross-platform (GitHub, GitLab, PagerDuty, Datadog).",
  },
  {
    icon: BarChart3,
    title: "DORA Metrics by Team",
    description:
      "Track Deployment Frequency, Lead Time, Change Failure Rate, and MTTR per team and service.",
  },
  {
    icon: BrainCircuit,
    title: "ML-Powered Predictions",
    description:
      "Trained on your deployment history to predict failures before they happen.",
  },
  {
    icon: ShieldAlert,
    title: "Supply Chain Security",
    description:
      "eBPF agent detects credential exfiltration and anomalous behavior during CI/CD builds.",
  },
  {
    icon: Wrench,
    title: "Automated Remediation",
    description:
      "Auto-rollback, halt canary, or scale up when prediction confidence is high.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-b border-border py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything you need to ship with confidence
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
            From risk prediction to automated remediation — OllinAI gives your
            platform team a complete picture of change risk.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
