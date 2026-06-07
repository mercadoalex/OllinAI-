import { describe, it, expect } from "vitest";
import {
  generateSnippet,
  SnippetContext,
  IntegrationType,
} from "./snippets";

describe("generateSnippet", () => {
  const baseContext: SnippetContext = {
    webhookUrl: "https://app.ollinai.com/api/webhooks/deployments",
    integrationKey: "tenant-123:integration-456",
    secretKeyVarName: "OLLINAI_SECRET_KEY",
    integrationType: "github_actions",
  };

  describe("github_actions", () => {
    const context: SnippetContext = {
      ...baseContext,
      integrationType: "github_actions",
    };

    it("returns a YAML snippet with correct language", () => {
      const result = generateSnippet(context);
      expect(result.language).toBe("yaml");
    });

    it("returns the correct filename", () => {
      const result = generateSnippet(context);
      expect(result.filename).toBe(".github/workflows/deploy.yml");
    });

    it("includes the webhookUrl in the content", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("https://app.ollinai.com");
    });

    it("includes the secretKeyVarName in the content", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain(context.secretKeyVarName);
    });

    it("includes instructions mentioning the secret key variable", () => {
      const result = generateSnippet(context);
      expect(result.instructions).toContain(context.secretKeyVarName);
    });

    it("references the OllinAI composite action", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("ollinai-deploy-event");
    });

    it("uses secrets syntax for the key", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain(
        `\${{ secrets.${context.secretKeyVarName} }}`
      );
    });
  });

  describe("gitlab_ci", () => {
    const context: SnippetContext = {
      ...baseContext,
      integrationType: "gitlab_ci",
    };

    it("returns a YAML snippet with correct language", () => {
      const result = generateSnippet(context);
      expect(result.language).toBe("yaml");
    });

    it("returns the correct filename", () => {
      const result = generateSnippet(context);
      expect(result.filename).toBe(".gitlab-ci.yml");
    });

    it("includes the webhookUrl in the content", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain(context.webhookUrl);
    });

    it("includes the secretKeyVarName in the content", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain(context.secretKeyVarName);
    });

    it("includes instructions mentioning the secret key variable", () => {
      const result = generateSnippet(context);
      expect(result.instructions).toContain(context.secretKeyVarName);
    });

    it("includes notify stage configuration", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("notify-ollinai");
    });

    it("uses HMAC signature in the script", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("openssl dgst -sha256 -hmac");
    });
  });

  describe("custom", () => {
    const context: SnippetContext = {
      ...baseContext,
      integrationType: "custom",
    };

    it("returns a bash snippet with correct language", () => {
      const result = generateSnippet(context);
      expect(result.language).toBe("bash");
    });

    it("returns the correct filename", () => {
      const result = generateSnippet(context);
      expect(result.filename).toBe("ollinai-deploy.sh");
    });

    it("includes the webhookUrl in the content", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain(context.webhookUrl);
    });

    it("includes the secretKeyVarName in the content", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain(context.secretKeyVarName);
    });

    it("includes all required DeploymentEvent fields", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("commitShas");
      expect(result.content).toContain("author");
      expect(result.content).toContain("services");
      expect(result.content).toContain("environment");
      expect(result.content).toContain("deploymentTimestamp");
    });

    it("includes HMAC-SHA256 signature computation", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("openssl dgst -sha256 -hmac");
    });

    it("includes X-OllinAI-Signature header", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("X-OllinAI-Signature");
    });

    it("includes Content-Type header", () => {
      const result = generateSnippet(context);
      expect(result.content).toContain("Content-Type: application/json");
    });

    it("includes instructions mentioning the secret key variable", () => {
      const result = generateSnippet(context);
      expect(result.instructions).toContain(context.secretKeyVarName);
    });
  });

  describe("error handling", () => {
    it("falls back to custom snippet for unsupported integration type", () => {
      const context: SnippetContext = {
        ...baseContext,
        integrationType: "unsupported" as IntegrationType,
      };
      const result = generateSnippet(context);
      expect(result.language).toBe("bash");
      expect(result.content).toContain(context.webhookUrl);
    });
  });

  describe("custom webhook URLs", () => {
    it("uses the provided webhook URL verbatim for gitlab_ci", () => {
      const context: SnippetContext = {
        ...baseContext,
        integrationType: "gitlab_ci",
        webhookUrl: "https://custom.endpoint.io/api/webhooks/deployments",
      };
      const result = generateSnippet(context);
      expect(result.content).toContain(
        "https://custom.endpoint.io/api/webhooks/deployments"
      );
    });

    it("uses the provided webhook URL verbatim for custom", () => {
      const context: SnippetContext = {
        ...baseContext,
        integrationType: "custom",
        webhookUrl: "https://custom.endpoint.io/api/webhooks/deployments",
      };
      const result = generateSnippet(context);
      expect(result.content).toContain(
        "https://custom.endpoint.io/api/webhooks/deployments"
      );
    });

    it("uses custom secret key variable name", () => {
      const context: SnippetContext = {
        ...baseContext,
        integrationType: "custom",
        secretKeyVarName: "MY_CUSTOM_SECRET",
      };
      const result = generateSnippet(context);
      expect(result.content).toContain("MY_CUSTOM_SECRET");
      expect(result.instructions).toContain("MY_CUSTOM_SECRET");
    });
  });
});
