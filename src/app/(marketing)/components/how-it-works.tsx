import { Webhook, Rocket, ShieldCheck } from "lucide-react";

const steps = [
  {
    icon: Webhook,
    title: "Connect your pipeline",
    description:
      "Add one webhook to GitHub Actions, GitLab CI, or any CI/CD system.",
  },
  {
    icon: Rocket,
    title: "Deploy as usual",
    description:
      "OllinAI scores every deployment and correlates incidents automatically.",
  },
  {
    icon: ShieldCheck,
    title: "Reduce failures",
    description:
      "Get proactive recommendations and gate risky deployments.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="border-b border-border bg-background py-20 lg:py-28"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Up and running in minutes
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
            No agents to babysit, no pipelines to rewrite. Connect once and let
            OllinAI do the rest.
          </p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="relative flex flex-col items-start">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card text-primary">
                  <step.icon className="h-6 w-6" />
                </span>
                <span className="font-mono text-sm text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
