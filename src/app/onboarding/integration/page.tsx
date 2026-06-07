"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IntegrationType = "github_actions" | "gitlab_ci" | "custom";

interface IntegrationOption {
  type: IntegrationType;
  label: string;
  description: string;
  icon: string;
}

const INTEGRATION_OPTIONS: IntegrationOption[] = [
  {
    type: "github_actions",
    label: "GitHub Actions",
    description: "Automate deployments with GitHub workflows",
    icon: "🐙",
  },
  {
    type: "gitlab_ci",
    label: "GitLab CI",
    description: "Integrate with GitLab CI/CD pipelines",
    icon: "🦊",
  },
  {
    type: "custom",
    label: "Custom Webhook",
    description: "Send events from any CI/CD system",
    icon: "🔗",
  },
];

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export default function IntegrationPage() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<IntegrationType | null>(
    null
  );
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [integrationId, setIntegrationId] = useState<string | null>(null);

  function validateName(value: string): string {
    if (!value) return "";
    if (value.length > 100)
      return "Integration name must be 100 characters or fewer";
    if (!NAME_PATTERN.test(value))
      return "Only letters, numbers, hyphens, and underscores allowed";
    return "";
  }

  function handleNameChange(value: string) {
    setName(value);
    setNameError(validateName(value));
  }

  function isFormValid(): boolean {
    return (
      selectedType !== null &&
      name.length >= 1 &&
      name.length <= 100 &&
      NAME_PATTERN.test(name)
    );
  }

  async function handleSubmit() {
    if (!isFormValid() || !selectedType) return;

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, type: selectedType }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create integration");
      }

      const data = await res.json();
      setSecretKey(data.secretKey);
      setIntegrationId(data.integrationId || data.id);

      // Store integrationId for subsequent steps
      if (data.integrationId || data.id) {
        localStorage.setItem(
          "onboarding_integrationId",
          data.integrationId || data.id
        );
      }
    } catch (err: any) {
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyAndContinue() {
    if (secretKey) {
      await navigator.clipboard.writeText(secretKey);
      setCopied(true);
    }

    // Mark step as complete
    try {
      await fetch("/api/onboarding/steps/integration_created", {
        method: "PUT",
        credentials: "include",
      });
    } catch {
      // Continue even if marking fails — middleware will handle
    }

    router.push("/onboarding/pipeline");
  }

  // Secret key display view
  if (secretKey) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-900">
            Integration Created!
          </h2>
          <p className="text-sm text-gray-500">
            Save your secret key now — it won&apos;t be shown again.
          </p>
        </div>

        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-2">
            <span className="text-yellow-600 text-lg">⚠️</span>
            <p className="text-sm text-yellow-800">
              This is the only time your secret key will be displayed. Copy it
              and store it securely as a repository secret or CI/CD variable.
            </p>
          </div>
        </div>

        <div className="relative">
          <pre className="p-4 bg-gray-900 text-green-400 rounded-lg text-sm font-mono overflow-x-auto">
            {secretKey}
          </pre>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(secretKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>

        <button
          onClick={handleCopyAndContinue}
          className="w-full py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          I&apos;ve saved my key — Continue
        </button>
      </div>
    );
  }

  // Integration selection form
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-gray-900">
          Create Your First Integration
        </h2>
        <p className="text-sm text-gray-500">
          Select your CI/CD platform and name your integration to get started.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={handleSubmit}
            className="text-red-700 font-medium hover:underline ml-3"
          >
            Retry
          </button>
        </div>
      )}

      {/* Integration type cards */}
      <div className="grid grid-cols-1 gap-3">
        {INTEGRATION_OPTIONS.map((option) => (
          <button
            key={option.type}
            onClick={() => setSelectedType(option.type)}
            className={`p-4 rounded-lg border-2 text-left transition-colors ${
              selectedType === option.type
                ? "border-gray-900 bg-gray-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{option.icon}</span>
              <div>
                <div className="font-medium text-gray-900">{option.label}</div>
                <div className="text-sm text-gray-500">
                  {option.description}
                </div>
              </div>
              {selectedType === option.type && (
                <div className="ml-auto">
                  <div className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center">
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Integration name input */}
      <div className="space-y-2">
        <label
          htmlFor="integration-name"
          className="block text-sm font-medium text-gray-700"
        >
          Integration Name
        </label>
        <input
          id="integration-name"
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="my-production-pipeline"
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          maxLength={100}
        />
        {nameError && (
          <p className="text-xs text-red-600">{nameError}</p>
        )}
        <p className="text-xs text-gray-400">
          Letters, numbers, hyphens, and underscores only (1-100 characters)
        </p>
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!isFormValid() || isSubmitting}
        className="w-full py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Creating..." : "Create Integration"}
      </button>
    </div>
  );
}
