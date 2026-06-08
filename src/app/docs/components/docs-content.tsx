import {
  GitBranch,
  Clock,
  AlertTriangle,
  Activity,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Brain,
  Network,
  Layers,
} from "lucide-react";
import { CodeBlock, InlineCode } from "./code-block";
import {
  DocSection,
  Subheading,
  Paragraph,
  BulletList,
} from "./doc-primitives";

const doraMetrics = [
  {
    icon: Activity,
    name: "Deployment Frequency",
    desc: "How often your team deploys to production. Higher is better.",
  },
  {
    icon: Clock,
    name: "Lead Time for Changes",
    desc: "Time from commit to production. Lower is better.",
  },
  {
    icon: AlertTriangle,
    name: "Change Failure Rate",
    desc: "Percentage of deployments causing incidents. Lower is better.",
  },
  {
    icon: TrendingDown,
    name: "Mean Time to Recovery (MTTR)",
    desc: "How quickly you recover from failures. Lower is better.",
  },
];

const riskFactors = [
  {
    name: "Change Failure Rate",
    weight: 35,
    desc: "Historical failure rate for this service.",
  },
  {
    name: "Change Size",
    weight: 25,
    desc: "Lines changed, files modified.",
  },
  {
    name: "Deployment Timing",
    weight: 20,
    desc: "Time of day, day of week risk.",
  },
  {
    name: "Author Failure Rate",
    weight: 20,
    desc: "Historical track record of the deployer.",
  },
];

const riskLevels = [
  { label: "Low", range: "0.0 – 0.3", dot: "bg-emerald-500", text: "text-emerald-600" },
  { label: "Medium", range: "0.3 – 0.55", dot: "bg-amber-500", text: "text-amber-600" },
  { label: "High", range: "0.55 – 0.8", dot: "bg-orange-500", text: "text-orange-600" },
  { label: "Critical", range: "0.8 – 1.0", dot: "bg-red-500", text: "text-red-600" },
];

const quickStartSteps = [
  {
    title: "Sign up",
    body: (
      <>
        Create your free account at <InlineCode>/sign-up</InlineCode>. No credit
        card required for the trial.
      </>
    ),
  },
  {
    title: "Create an integration",
    body: <>Select your CI/CD tool (GitHub Actions, GitLab CI, Jenkins, and more).</>,
  },
  {
    title: "Add the webhook to your pipeline",
    body: (
      <>
        Copy the generated webhook URL and signing secret into your pipeline
        configuration. See <InlineCode>Webhook Payload Format</InlineCode> for the
        exact request shape.
      </>
    ),
  },
  {
    title: "Push a deployment",
    body: <>Ship a change and watch it appear in the dashboard within seconds.</>,
  },
];

export function DocsContent() {
  return (
    <article className="flex flex-col">
      {/* What is OllinAI? */}
      <DocSection id="what-is-ollinai" eyebrow="Getting Started" title="What is OllinAI?">
        <Paragraph>
          OllinAI helps engineering teams understand the risk profile of every
          deployment. It correlates your deployments with production incidents,
          scores the risk of each change with machine learning, and surfaces
          actionable DORA metrics across every service you run.
        </Paragraph>

        <Subheading>Platform Overview</Subheading>
        <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border bg-muted text-sm font-medium text-muted-foreground">
          Platform Architecture Diagram
        </div>

        <Subheading>Key capabilities</Subheading>
        <BulletList
          items={[
            <><strong className="text-foreground">Risk Scoring</strong> — ML-driven risk for every deployment before it ships.</>,
            <><strong className="text-foreground">DORA Metrics</strong> — Deployment frequency, lead time, change failure rate, and MTTR.</>,
            <><strong className="text-foreground">Incident Correlation</strong> — Automatically link incidents back to the deployments that caused them.</>,
            <><strong className="text-foreground">ML Predictions</strong> — Forecast failure likelihood from historical signals.</>,
            <><strong className="text-foreground">Supply Chain Security</strong> — Track provenance and surface risky dependencies.</>,
          ]}
        />
      </DocSection>

      {/* Quick Start */}
      <DocSection id="quick-start" eyebrow="Getting Started" title="Quick Start Guide">
        <Paragraph>
          Get your first deployment event flowing into OllinAI in four steps.
        </Paragraph>
        <ol className="mt-6 flex flex-col gap-6">
          {quickStartSteps.map((step, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-foreground">{step.title}</p>
                <p className="mt-1 leading-7">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </DocSection>

      {/* First Integration */}
      <DocSection
        id="first-integration"
        eyebrow="Getting Started"
        title="Creating Your First Integration"
      >
        <Paragraph>
          An integration tells OllinAI how to receive events from your CI/CD
          tooling. From the dashboard, open <InlineCode>Integrations</InlineCode>,
          choose your provider, and OllinAI generates a unique webhook URL and a
          signing secret.
        </Paragraph>
        <BulletList
          items={[
            "Name your integration after the pipeline or environment it represents.",
            "Store the signing secret securely — it is used to verify every request.",
            "You can create multiple integrations for different services or regions.",
          ]}
        />
      </DocSection>

      {/* First Event */}
      <DocSection
        id="first-event"
        eyebrow="Getting Started"
        title="Sending Your First Deployment Event"
      >
        <Paragraph>
          Once your integration exists, send a signed POST request to the webhook
          URL whenever a deployment completes.
        </Paragraph>
        <CodeBlock language="bash">{`curl -X POST https://api.ollinai.com/v1/events \\
  -H "Content-Type: application/json" \\
  -H "X-OllinAI-Signature: $SIGNATURE" \\
  -H "X-OllinAI-Integration: $INTEGRATION_ID" \\
  -d '{
    "commitShas": ["a1b2c3d"],
    "author": "jane@acme.com",
    "services": ["checkout-api"],
    "environment": "production",
    "deploymentTimestamp": "2026-06-07T12:00:00Z"
  }'`}</CodeBlock>
      </DocSection>

      {/* DORA Metrics */}
      <DocSection
        id="dora-metrics"
        eyebrow="Dashboard Guide"
        title="Understanding DORA Metrics"
      >
        <Paragraph>
          The dashboard tracks the four DORA metrics that correlate with
          high-performing engineering teams.
        </Paragraph>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {doraMetrics.map((metric) => (
            <div
              key={metric.name}
              className="rounded-xl border border-border bg-card p-5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <metric.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h4 className="mt-3 font-semibold text-card-foreground">
                {metric.name}
              </h4>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {metric.desc}
              </p>
            </div>
          ))}
        </div>

        <Subheading>How to interpret trends</Subheading>
        <Paragraph>
          Each metric shows a trend arrow comparing the current period to the
          previous one. A change must cross a <strong className="text-foreground">10% threshold</strong>{" "}
          before a trend is shown, filtering out noise.
        </Paragraph>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            <span className="text-muted-foreground">
              Green arrow — the metric improved by more than 10%.
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TrendingDown className="h-4 w-4 text-red-600" aria-hidden="true" />
            <span className="text-muted-foreground">
              Red arrow — the metric regressed by more than 10%.
            </span>
          </div>
        </div>

        <Subheading>Insufficient data</Subheading>
        <Paragraph>
          Metrics require at least <strong className="text-foreground">3 deployment events</strong>{" "}
          before they are computed. Until then, the dashboard shows an{" "}
          <InlineCode>Insufficient Data</InlineCode> state instead of misleading
          numbers.
        </Paragraph>
      </DocSection>

      {/* Reading Risk Scores */}
      <DocSection
        id="reading-risk-scores"
        eyebrow="Dashboard Guide"
        title="Reading Risk Scores"
      >
        <Paragraph>
          Every deployment is assigned a risk score between 0 and 1. The badge
          color tells you at a glance how risky a change is — see{" "}
          <InlineCode>How Risk Scoring Works</InlineCode> for the full breakdown.
        </Paragraph>
      </DocSection>

      {/* Deployment Timeline */}
      <DocSection
        id="deployment-timeline"
        eyebrow="Dashboard Guide"
        title="Deployment Timeline"
      >
        <Paragraph>
          The timeline plots every deployment chronologically, annotated with its
          risk score and any correlated incidents, so you can spot patterns across
          releases.
        </Paragraph>
      </DocSection>

      {/* Incident Correlation View */}
      <DocSection
        id="incident-correlation-view"
        eyebrow="Dashboard Guide"
        title="Incident Correlation View"
      >
        <Paragraph>
          This view groups incidents alongside the deployments most likely to have
          caused them, ranked by temporal proximity and overlapping services.
        </Paragraph>
      </DocSection>

      {/* Filtering and Time Ranges */}
      <DocSection
        id="filtering-time-ranges"
        eyebrow="Dashboard Guide"
        title="Filtering and Time Ranges"
      >
        <Paragraph>
          Narrow the dashboard by service, environment, author, or time range.
          DORA metrics and risk distributions recompute instantly for the current
          filter selection.
        </Paragraph>
      </DocSection>

      {/* Integrations */}
      <DocSection
        id="github-actions"
        eyebrow="Integrations"
        title="GitHub Actions Setup"
      >
        <Paragraph>
          Add a step to your workflow that posts to OllinAI after a successful
          deploy job.
        </Paragraph>
        <CodeBlock language="yaml">{`- name: Notify OllinAI
  run: |
    curl -X POST "$OLLINAI_WEBHOOK_URL" \\
      -H "Content-Type: application/json" \\
      -H "X-OllinAI-Signature: \${{ secrets.OLLINAI_SIGNATURE }}" \\
      -H "X-OllinAI-Integration: \${{ secrets.OLLINAI_INTEGRATION }}" \\
      -d "{\\"commitShas\\":[\\"\${{ github.sha }}\\"],\\"author\\":\\"\${{ github.actor }}\\",\\"services\\":[\\"checkout-api\\"],\\"environment\\":\\"production\\",\\"deploymentTimestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\"}"`}</CodeBlock>
      </DocSection>

      <DocSection id="gitlab-ci" eyebrow="Integrations" title="GitLab CI Setup">
        <Paragraph>
          Add a deploy-notification job to <InlineCode>.gitlab-ci.yml</InlineCode>{" "}
          that runs after your deploy stage and posts the signed payload to your
          webhook URL.
        </Paragraph>
      </DocSection>

      <DocSection id="jenkins" eyebrow="Integrations" title="Jenkins Setup">
        <Paragraph>
          In your <InlineCode>Jenkinsfile</InlineCode>, add a post-deploy stage
          that uses <InlineCode>sh 'curl ...'</InlineCode> to send the event,
          reading the signing secret from Jenkins credentials.
        </Paragraph>
      </DocSection>

      <DocSection id="circleci" eyebrow="Integrations" title="CircleCI Setup">
        <Paragraph>
          Add a job after your deploy workflow that posts the deployment event,
          storing the integration ID and signature as CircleCI project
          environment variables.
        </Paragraph>
      </DocSection>

      <DocSection id="harness" eyebrow="Integrations" title="Harness Setup">
        <Paragraph>
          Use a Harness Shell Script or HTTP step in your deployment pipeline to
          call the OllinAI webhook once the rollout succeeds.
        </Paragraph>
      </DocSection>

      <DocSection
        id="azure-devops"
        eyebrow="Integrations"
        title="Azure DevOps Setup"
      >
        <Paragraph>
          Add a Bash or PowerShell task to your release pipeline that sends the
          deployment event, referencing pipeline variables for the secret and
          integration ID.
        </Paragraph>
      </DocSection>

      <DocSection id="argocd" eyebrow="Integrations" title="ArgoCD Setup">
        <Paragraph>
          Configure an ArgoCD resource hook (PostSync) or notification trigger
          that posts to OllinAI whenever an application reaches a synced and
          healthy state.
        </Paragraph>
      </DocSection>

      <DocSection
        id="custom-webhook"
        eyebrow="Integrations"
        title="Custom Webhook"
      >
        <Paragraph>
          Any system that can make an authenticated HTTP request can integrate
          with OllinAI. Send a signed POST to your webhook URL using the schema
          documented in <InlineCode>Webhook Payload Format</InlineCode>.
        </Paragraph>
      </DocSection>

      {/* Concepts */}
      <DocSection
        id="concept-dora"
        eyebrow="Concepts"
        title="What Are DORA Metrics?"
      >
        <Paragraph>
          DORA (DevOps Research and Assessment) metrics are four research-backed
          measures of software delivery performance: deployment frequency, lead
          time for changes, change failure rate, and mean time to recovery. Taken
          together they balance throughput against stability.
        </Paragraph>
      </DocSection>

      {/* How Risk Scoring Works */}
      <DocSection
        id="risk-scoring"
        eyebrow="Concepts"
        title="How Risk Scoring Works"
      >
        <Paragraph>
          OllinAI combines four weighted risk factors into a single normalized
          score for every deployment.
        </Paragraph>
        <div className="mt-6 flex flex-col gap-3">
          {riskFactors.map((factor) => (
            <div
              key={factor.name}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-semibold text-card-foreground">
                  {factor.name}
                </span>
                <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary">
                  {factor.weight}%
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${factor.weight}%` }}
                />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {factor.desc}
              </p>
            </div>
          ))}
        </div>

        <Subheading>Risk levels</Subheading>
        <div className="overflow-hidden rounded-xl border border-border">
          {riskLevels.map((level, i) => (
            <div
              key={level.label}
              className={`flex items-center justify-between gap-4 px-4 py-3 ${
                i !== 0 ? "border-t border-border" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`h-3 w-3 rounded-full ${level.dot}`}
                  aria-hidden="true"
                />
                <span className={`font-semibold ${level.text}`}>
                  {level.label}
                </span>
              </div>
              <span className="font-mono text-sm text-muted-foreground">
                {level.range}
              </span>
            </div>
          ))}
        </div>

        <Subheading>Color coding guide</Subheading>
        <Paragraph>
          Risk badges follow a consistent traffic-light scale:{" "}
          <span className="font-medium text-emerald-600">green</span> for low,{" "}
          <span className="font-medium text-amber-600">amber</span> for medium,{" "}
          <span className="font-medium text-orange-600">orange</span> for high,
          and <span className="font-medium text-red-600">red</span> for critical.
        </Paragraph>
      </DocSection>

      <DocSection
        id="incident-correlation"
        eyebrow="Concepts"
        title="Incident-Deployment Correlation"
      >
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Network className="h-5 w-5" aria-hidden="true" />
        </div>
        <Paragraph>
          When an incident is reported, OllinAI scans recent deployments touching
          the affected services and ranks the most likely culprits using temporal
          proximity, shared services, and historical failure patterns.
        </Paragraph>
      </DocSection>

      <DocSection
        id="ml-predictions"
        eyebrow="Concepts"
        title="ML Predictions Explained"
      >
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Brain className="h-5 w-5" aria-hidden="true" />
        </div>
        <Paragraph>
          OllinAI trains models on your historical deployments and incidents to
          predict the probability that a new change will cause a failure. As more
          events flow in, predictions become increasingly tailored to your team.
        </Paragraph>
      </DocSection>

      <DocSection
        id="subscription-tiers"
        eyebrow="Concepts"
        title="Subscription Tiers"
      >
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Layers className="h-5 w-5" aria-hidden="true" />
        </div>
        <Paragraph>
          Tiers scale with the number of services, retention window, and access to
          advanced ML predictions and supply chain security features. See the{" "}
          <InlineCode>Pricing</InlineCode> page for current limits.
        </Paragraph>
      </DocSection>

      {/* API Reference */}
      <DocSection id="api" eyebrow="API Reference" title="Authentication">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <Paragraph>
          Every request must be signed. OllinAI verifies the{" "}
          <InlineCode>X-OllinAI-Signature</InlineCode> header (an HMAC of the raw
          request body using your integration&apos;s signing secret) and matches
          the <InlineCode>X-OllinAI-Integration</InlineCode> header to a known
          integration.
        </Paragraph>
        <CodeBlock language="text">{`X-OllinAI-Signature:   HMAC-SHA256(body, signing_secret)
X-OllinAI-Integration: <your-integration-id>`}</CodeBlock>
      </DocSection>

      {/* Webhook Payload Format */}
      <DocSection
        id="webhook-payload"
        eyebrow="API Reference"
        title="Webhook Payload Format"
      >
        <Paragraph>Deployment events use the following JSON schema:</Paragraph>
        <CodeBlock language="typescript">{`{
  commitShas: string[],
  author: string,
  services: string[],
  environment: string,
  deploymentTimestamp: string // ISO 8601
}`}</CodeBlock>

        <Subheading>Required headers</Subheading>
        <BulletList
          items={[
            <><InlineCode>Content-Type</InlineCode> — must be <InlineCode>application/json</InlineCode>.</>,
            <><InlineCode>X-OllinAI-Signature</InlineCode> — HMAC signature of the request body.</>,
            <><InlineCode>X-OllinAI-Integration</InlineCode> — your integration identifier.</>,
          ]}
        />

        <Subheading>Example request</Subheading>
        <CodeBlock language="bash">{`curl -X POST https://api.ollinai.com/v1/events \\
  -H "Content-Type: application/json" \\
  -H "X-OllinAI-Signature: $SIGNATURE" \\
  -H "X-OllinAI-Integration: $INTEGRATION_ID" \\
  -d '{
    "commitShas": ["a1b2c3d", "e4f5g6h"],
    "author": "jane@acme.com",
    "services": ["checkout-api", "payments-worker"],
    "environment": "production",
    "deploymentTimestamp": "2026-06-07T12:00:00Z"
  }'`}</CodeBlock>

        <Subheading>Response codes</Subheading>
        <BulletList
          items={[
            <><InlineCode>201</InlineCode> — event created successfully.</>,
            <><InlineCode>400</InlineCode> — validation error in the payload.</>,
            <><InlineCode>401</InlineCode> — invalid or missing signature.</>,
          ]}
        />
      </DocSection>

      <DocSection
        id="rest-endpoints"
        eyebrow="API Reference"
        title="REST API Endpoints"
      >
        <Paragraph>
          Beyond ingesting events, the REST API exposes read endpoints for
          deployments, incidents, and computed DORA metrics.
        </Paragraph>
        <CodeBlock language="text">{`POST /v1/events                 Ingest a deployment event
GET  /v1/deployments            List deployments
GET  /v1/deployments/:id        Get a single deployment + risk score
GET  /v1/incidents              List incidents
GET  /v1/metrics/dora           Get computed DORA metrics`}</CodeBlock>
      </DocSection>

      <DocSection id="rate-limits" eyebrow="API Reference" title="Rate Limits">
        <Paragraph>
          The ingestion endpoint accepts up to{" "}
          <strong className="text-foreground">100 requests per minute</strong> per
          integration. Read endpoints allow{" "}
          <strong className="text-foreground">600 requests per minute</strong> per
          account. Exceeding a limit returns <InlineCode>429</InlineCode> with a{" "}
          <InlineCode>Retry-After</InlineCode> header.
        </Paragraph>
      </DocSection>

      <DocSection id="error-codes" eyebrow="API Reference" title="Error Codes">
        <BulletList
          items={[
            <><InlineCode>400</InlineCode> — Bad request / validation error.</>,
            <><InlineCode>401</InlineCode> — Invalid signature or unknown integration.</>,
            <><InlineCode>404</InlineCode> — Resource not found.</>,
            <><InlineCode>429</InlineCode> — Rate limit exceeded.</>,
            <><InlineCode>500</InlineCode> — Internal server error, safe to retry with backoff.</>,
          ]}
        />
      </DocSection>

      <div className="flex items-center gap-2 pt-10 text-sm text-muted-foreground">
        <GitBranch className="h-4 w-4" aria-hidden="true" />
        <span>Need help? Reach out to support or revisit the Quick Start Guide.</span>
      </div>
    </article>
  );
}
