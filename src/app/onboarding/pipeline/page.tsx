"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PipelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [snippet, setSnippet] = useState<{
    language: string;
    content: string;
    filename: string;
    instructions: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [continuing, setContinuing] = useState(false);

  function getIntegrationId(): string | null {
    // Check URL params first, then localStorage
    const fromParams = searchParams.get("integrationId");
    if (fromParams) return fromParams;
    if (typeof window !== "undefined") {
      return localStorage.getItem("onboarding_integrationId");
    }
    return null;
  }

  async function fetchIntegrationIdFromAPI(): Promise<string | null> {
    try {
      const res = await fetch("/api/integrations", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const integrations = data.data || data.integrations || [];
        if (integrations.length > 0) {
          const id = integrations[0].integrationId;
          if (typeof window !== "undefined") {
            localStorage.setItem("onboarding_integrationId", id);
          }
          return id;
        }
      }
    } catch {}
    return null;
  }

  async function fetchSnippet() {
    setLoading(true);
    setError("");

    let integrationId = getIntegrationId();
    
    // Fallback: fetch from API if not in localStorage
    if (!integrationId) {
      integrationId = await fetchIntegrationIdFromAPI();
    }
    
    if (!integrationId) {
      setError("Integration ID not found. Please go back and create an integration.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/onboarding/snippet?integrationId=${encodeURIComponent(integrationId)}`,
        { credentials: "include" }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load code snippet");
      }

      const data = await res.json();
      setSnippet(data);
    } catch (err: any) {
      setError(err.message || "An error occurred loading the snippet.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSnippet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopy() {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleContinue() {
    setContinuing(true);

    try {
      await fetch("/api/onboarding/steps/pipeline_configured", {
        method: "PUT",
        credentials: "include",
      });
      router.push("/onboarding/event");
    } catch {
      // Navigate anyway — middleware will handle state
      router.push("/onboarding/event");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-gray-500">Loading snippet...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
        <button
          onClick={fetchSnippet}
          className="w-full py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-gray-900">
          Configure Your Pipeline
        </h2>
        <p className="text-sm text-gray-500">
          Add this snippet to your CI/CD configuration. It will send deployment
          events to OllinAI automatically.
        </p>
      </div>

      {snippet && (
        <>
          {/* Instructions */}
          {snippet.instructions && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-sm text-blue-800">{snippet.instructions}</p>
            </div>
          )}

          {/* Filename hint */}
          {snippet.filename && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                {snippet.filename}
              </span>
              <span className="text-xs text-gray-400">
                ({snippet.language})
              </span>
            </div>
          )}

          {/* Code snippet */}
          <div className="relative">
            <pre className="p-4 bg-gray-900 rounded-lg overflow-x-auto">
              <code className="text-sm font-mono text-gray-100 whitespace-pre">
                {snippet.content}
              </code>
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 px-3 py-1.5 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600 transition-colors"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
        </>
      )}

      {/* Continue button */}
      <button
        onClick={handleContinue}
        disabled={continuing}
        className="w-full py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {continuing ? "Saving..." : "Continue"}
      </button>
    </div>
  );
}
