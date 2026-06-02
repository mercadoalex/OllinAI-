/**
 * Settings: Integrations Management Page
 *
 * Client-side UI for managing webhook integrations,
 * including secret key rotation and test connectivity.
 *
 * Requirements: 10.7
 */

"use client";

import { useState, useEffect, useCallback } from "react";

interface Integration {
  integrationId: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

const INTEGRATION_TYPES = [
  "github_actions",
  "gitlab_ci",
  "jenkins",
  "circleci",
  "pagerduty",
  "opsgenie",
  "custom",
] as const;

export default function IntegrationsSettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("github_actions");
  const [error, setError] = useState<string | null>(null);
  const [secretDisplay, setSecretDisplay] = useState<{ id: string; key: string } | null>(null);

  const fetchIntegrations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/integrations");
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.data || []);
      }
    } catch {
      setError("Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const createIntegration = async () => {
    if (!newName.trim()) return;
    setError(null);
    setSecretDisplay(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), type: newType }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create integration");
        return;
      }
      const data = await res.json();
      setSecretDisplay({ id: data.integrationId, key: data.secretKey });
      setNewName("");
      fetchIntegrations();
    } catch {
      setError("Failed to create integration");
    }
  };

  const rotateKey = async (integrationId: string) => {
    setError(null);
    setSecretDisplay(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotateKey: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to rotate key");
        return;
      }
      const data = await res.json();
      if (data.secretKey) {
        setSecretDisplay({ id: integrationId, key: data.secretKey });
      }
    } catch {
      setError("Failed to rotate key");
    }
  };

  const deleteIntegration = async (integrationId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete integration");
        return;
      }
      fetchIntegrations();
    } catch {
      setError("Failed to delete integration");
    }
  };

  const testConnectivity = async (integrationId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("Connectivity test passed!");
      } else {
        setError(data.error || "Connectivity test failed");
      }
    } catch {
      setError("Connectivity test failed");
    }
  };

  if (loading) {
    return (
      <main style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "24px" }}>
        Integrations
      </h1>

      {error && (
        <div
          style={{
            padding: "12px",
            marginBottom: "16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            color: "#dc2626",
          }}
        >
          {error}
        </div>
      )}

      {secretDisplay && (
        <div
          style={{
            padding: "12px",
            marginBottom: "16px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            color: "#166534",
          }}
        >
          <strong>Secret Key (shown once):</strong>
          <code style={{ display: "block", marginTop: "4px", wordBreak: "break-all" }}>
            {secretDisplay.key}
          </code>
        </div>
      )}

      {/* Create Integration */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Integration name"
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px" }}
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px" }}
        >
          {INTEGRATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
        <button
          onClick={createIntegration}
          style={{
            padding: "8px 16px",
            backgroundColor: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </div>

      {/* Integrations List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {integrations.map((intg) => (
          <div
            key={intg.integrationId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
            }}
          >
            <div>
              <span style={{ fontWeight: 500 }}>{intg.name}</span>
              <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6b7280" }}>
                ({intg.type})
              </span>
              {intg.lastUsedAt && (
                <span style={{ marginLeft: "8px", fontSize: "11px", color: "#6b7280" }}>
                  Last used: {new Date(intg.lastUsedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => testConnectivity(intg.integrationId)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  cursor: "pointer",
                  backgroundColor: "white",
                }}
              >
                Test
              </button>
              <button
                onClick={() => rotateKey(intg.integrationId)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  cursor: "pointer",
                  backgroundColor: "white",
                }}
              >
                Rotate Key
              </button>
              <button
                onClick={() => deleteIntegration(intg.integrationId)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  border: "1px solid #fecaca",
                  borderRadius: "4px",
                  cursor: "pointer",
                  backgroundColor: "#fef2f2",
                  color: "#dc2626",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
