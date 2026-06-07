# Integration Roadmap

## Currently Supported

| Platform | Type | Template |
|----------|------|----------|
| GitHub Actions | CI/CD | `integrations/github-actions/` |
| GitLab CI | CI/CD | `integrations/gitlab-ci/` |
| Jenkins | CI/CD | `integrations/jenkins/` |
| CircleCI | CI/CD | `integrations/circleci/` |
| Harness | CD | `integrations/harness/` |
| Azure DevOps | CI/CD | `integrations/azure-devops/` |
| ArgoCD | GitOps/CD | `integrations/argocd/` |
| Custom Webhook | Any | cURL template via onboarding |

## Planned — Next Wave

| Platform | Priority | Notes |
|----------|----------|-------|
| AWS CodePipeline | Medium | Large AWS-native customer segment |
| Google Cloud Build | Medium | GCP teams, growing adoption |
| Buildkite | Medium | Fast-growing, agent-based, popular with scale-ups |
| Bitbucket Pipelines | Medium | Atlassian ecosystem (Jira + Bitbucket teams) |
| Tekton | Low | Cloud-native/K8s teams, overlaps with ArgoCD audience |
| TeamCity | Low | JetBrains ecosystem, enterprise Java shops |
| Drone CI | Low | Container-native, open source, smaller market share |
| Spinnaker | Low | Netflix-origin, enterprise multi-cloud CD |
| Flux CD | Low | GitOps alternative to ArgoCD |
| Waypoint (HashiCorp) | Low | HashiCorp ecosystem |

## Incident Source Integrations (Planned)

| Platform | Priority | Notes |
|----------|----------|-------|
| PagerDuty | High | #1 incident management tool |
| Datadog | High | Monitoring + incidents combined |
| OpsGenie | Medium | Atlassian ecosystem incident tool |
| Sentry | Medium | Error tracking → incident correlation |
| New Relic | Medium | APM + alerting |
| Grafana Alerting | Medium | Open source monitoring stack |
| ServiceNow | Low | Enterprise ITSM |
| Rootly | Low | Modern incident management |
| FireHydrant | Low | Incident response automation |

## Criteria for Prioritization

1. **Market share** — How many of our target customers use it?
2. **Ease of integration** — Webhook support vs. polling vs. SDK needed?
3. **Customer requests** — Direct feedback from trials/demos
4. **Competitive gap** — Do competitors support it and we don't?
