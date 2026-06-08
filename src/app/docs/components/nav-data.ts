export type DocLink = {
  id: string;
  title: string;
};

export type DocSection = {
  group: string;
  links: DocLink[];
};

export const docSections: DocSection[] = [
  {
    group: "Getting Started",
    links: [
      { id: "what-is-ollinai", title: "What is OllinAI?" },
      { id: "quick-start", title: "Quick Start Guide" },
      { id: "first-integration", title: "Creating Your First Integration" },
      { id: "first-event", title: "Sending Your First Deployment Event" },
    ],
  },
  {
    group: "Dashboard Guide",
    links: [
      { id: "dora-metrics", title: "Understanding DORA Metrics" },
      { id: "reading-risk-scores", title: "Reading Risk Scores" },
      { id: "deployment-timeline", title: "Deployment Timeline" },
      { id: "incident-correlation-view", title: "Incident Correlation View" },
      { id: "filtering-time-ranges", title: "Filtering and Time Ranges" },
    ],
  },
  {
    group: "Integrations",
    links: [
      { id: "github-actions", title: "GitHub Actions Setup" },
      { id: "gitlab-ci", title: "GitLab CI Setup" },
      { id: "jenkins", title: "Jenkins Setup" },
      { id: "circleci", title: "CircleCI Setup" },
      { id: "harness", title: "Harness Setup" },
      { id: "azure-devops", title: "Azure DevOps Setup" },
      { id: "argocd", title: "ArgoCD Setup" },
      { id: "custom-webhook", title: "Custom Webhook" },
    ],
  },
  {
    group: "Concepts",
    links: [
      { id: "concept-dora", title: "What Are DORA Metrics?" },
      { id: "risk-scoring", title: "How Risk Scoring Works" },
      { id: "incident-correlation", title: "Incident-Deployment Correlation" },
      { id: "ml-predictions", title: "ML Predictions Explained" },
      { id: "subscription-tiers", title: "Subscription Tiers" },
    ],
  },
  {
    group: "API Reference",
    links: [
      { id: "api", title: "Authentication" },
      { id: "webhook-payload", title: "Webhook Payload Format" },
      { id: "rest-endpoints", title: "REST API Endpoints" },
      { id: "rate-limits", title: "Rate Limits" },
      { id: "error-codes", title: "Error Codes" },
    ],
  },
];

export const allLinks: DocLink[] = docSections.flatMap((s) => s.links);
