/**
 * Code Snippet Generator
 *
 * Generates pre-populated CI/CD configuration snippets for the onboarding
 * pipeline configuration step. Snippets are self-contained (embedded content,
 * no runtime file reads) and include the tenant's webhook URL and secret key
 * variable name.
 *
 * Supported integration types:
 * - github_actions: GitHub Actions workflow step using the OllinAI composite action
 * - gitlab_ci: GitLab CI stage/script that sends the deployment event
 * - custom: cURL example with HMAC signature generation and full payload
 *
 * Requirements: 3.1, 3.2, 3.3
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Supported CI/CD integration types */
export type IntegrationType = "github_actions" | "gitlab_ci" | "custom";

/** Context needed to generate a code snippet */
export interface SnippetContext {
  /** The tenant's webhook endpoint URL (e.g., https://app.ollinai.com/api/webhooks/deployments) */
  webhookUrl: string;
  /** Integration key in format {tenantId}:{integrationId} */
  integrationKey: string;
  /** Variable name for the secret key (e.g., OLLINAI_SECRET_KEY) */
  secretKeyVarName: string;
  /** The type of CI/CD integration */
  integrationType: IntegrationType;
}

/** The generated snippet output */
export interface GeneratedSnippet {
  /** The language/format of the snippet (e.g., 'yaml', 'bash') */
  language: string;
  /** The full snippet content */
  content: string;
  /** Suggested filename for the snippet */
  filename: string;
  /** Brief setup instructions for the user */
  instructions: string;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates a CI/CD configuration snippet based on the integration type.
 *
 * @param context - The snippet context containing webhook URL, integration key, and type
 * @returns A GeneratedSnippet with language, content, filename, and instructions
 *
 * Requirements: 3.1, 3.2, 3.3
 */
export function generateSnippet(context: SnippetContext): GeneratedSnippet {
  switch (context.integrationType) {
    case "github_actions":
      return generateGitHubActionsSnippet(context);
    case "gitlab_ci":
      return generateGitLabCISnippet(context);
    case "custom":
      return generateCustomSnippet(context);
    default:
      throw new Error(
        `Unsupported integration type: ${context.integrationType}`
      );
  }
}

// ─── Snippet Generators ────────────────────────────────────────────────────────

/**
 * Generates a GitHub Actions workflow snippet showing how to add the
 * OllinAI deploy event action as a step in a deployment workflow.
 *
 * Requirements: 3.1
 */
function generateGitHubActionsSnippet(context: SnippetContext): GeneratedSnippet {
  const content = `# Add this step to your deployment workflow
# File: .github/workflows/deploy.yml

name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # ... your deployment steps here ...

      - name: Notify OllinAI
        uses: ollinai/integrations/github-actions/ollinai-deploy-event@v1
        with:
          api-url: "${context.webhookUrl.replace("/api/webhooks/deployments", "")}"
          secret-key: \${{ secrets.${context.secretKeyVarName} }}
          services: "your-service-name"
          environment: "production"
`;

  return {
    language: "yaml",
    content,
    filename: ".github/workflows/deploy.yml",
    instructions: `Add your secret key as a repository secret named "${context.secretKeyVarName}" in your GitHub repository settings (Settings → Secrets and variables → Actions), then add the OllinAI step to your deployment workflow.`,
  };
}

/**
 * Generates a GitLab CI snippet showing the stage/script that sends
 * the deployment event to OllinAI.
 *
 * Requirements: 3.2
 */
function generateGitLabCISnippet(context: SnippetContext): GeneratedSnippet {
  const content = `# Add this to your .gitlab-ci.yml
# This stage sends a deployment event to OllinAI after your deploy job

stages:
  - deploy
  - notify

deploy:
  stage: deploy
  script:
    - echo "Your deployment commands here"

notify-ollinai:
  stage: notify
  variables:
    OLLINAI_SERVICES: "your-service-name"
    OLLINAI_ENVIRONMENT: "production"
  script:
    - |
      PAYLOAD=$(cat <<EOFPAYLOAD
      {
        "commitShas": ["$CI_COMMIT_SHA"],
        "services": ["$OLLINAI_SERVICES"],
        "author": "$GITLAB_USER_LOGIN",
        "environment": "$OLLINAI_ENVIRONMENT",
        "deploymentTimestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      }
      EOFPAYLOAD
      )
      SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$${context.secretKeyVarName}" -binary | xxd -p -c 256)
      curl -s -X POST "${context.webhookUrl}" \\
        -H "Content-Type: application/json" \\
        -H "X-OllinAI-Signature: sha256=$SIGNATURE" \\
        -d "$PAYLOAD"
  needs: [deploy]
`;

  return {
    language: "yaml",
    content,
    filename: ".gitlab-ci.yml",
    instructions: `Add your secret key as a CI/CD variable named "${context.secretKeyVarName}" in your GitLab project settings (Settings → CI/CD → Variables), then add the notify-ollinai stage to your pipeline.`,
  };
}

/**
 * Generates a cURL example with HMAC signature generation showing how to
 * send a deployment event manually or from a custom CI/CD system.
 *
 * Requirements: 3.3
 */
function generateCustomSnippet(context: SnippetContext): GeneratedSnippet {
  const content = `#!/bin/bash
# Send a deployment event to OllinAI
# Replace placeholder values with your actual deployment data

WEBHOOK_URL="${context.webhookUrl}"
SECRET_KEY="$${context.secretKeyVarName}"

# Build the deployment event payload with all required fields
PAYLOAD=$(cat <<'EOF'
{
  "commitShas": ["abc123def456", "789ghi012jkl"],
  "author": "deploy-user",
  "services": ["api-service", "web-app"],
  "environment": "production",
  "deploymentTimestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

# Replace the timestamp placeholder with actual value
PAYLOAD=$(echo "$PAYLOAD" | sed "s/\\$(date -u +%Y-%m-%dT%H:%M:%SZ)/$(date -u +%Y-%m-%dT%H:%M:%SZ)/")

# Compute HMAC-SHA256 signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET_KEY" -binary | xxd -p -c 256)

# Send the request
curl -X POST "$WEBHOOK_URL" \\
  -H "Content-Type: application/json" \\
  -H "X-OllinAI-Signature: sha256=$SIGNATURE" \\
  -d "$PAYLOAD"
`;

  return {
    language: "bash",
    content,
    filename: "ollinai-deploy.sh",
    instructions: `Set the ${context.secretKeyVarName} environment variable to your integration secret key, update the payload fields with your actual deployment data (commitShas, author, services, environment, deploymentTimestamp), then run the script.`,
  };
}
