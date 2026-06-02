/**
 * Settings: Billing & Subscription Page
 *
 * Client-side UI for subscription tier management.
 * Calls the /api/subscriptions endpoint for tier changes.
 *
 * Requirements: 8.7
 */

"use client";

import { useState, useEffect } from "react";

type SubscriptionTier = "starter" | "pro" | "enterprise";

interface SubscriptionInfo {
  tier: SubscriptionTier;
  activatedAt: string;
  previousTier?: SubscriptionTier;
  tierChangedAt?: string;
}

const TIER_DETAILS: Record<SubscriptionTier, { name: string; features: string[]; price: string }> = {
  starter: {
    name: "Starter",
    features: ["Up to 5 services", "30-day data retention", "DORA metrics"],
    price: "Free",
  },
  pro: {
    name: "Pro",
    features: [
      "Unlimited services",
      "90-day data retention",
      "Risk scoring",
      "Incident correlation",
      "Recommendations",
      "AIOps predictions",
    ],
    price: "$49/month",
  },
  enterprise: {
    name: "Enterprise",
    features: [
      "Everything in Pro",
      "Unlimited retention",
      "SSO integration",
      "Audit logs",
      "Custom integrations",
      "REST API access",
      "Data residency",
      "Build attestation",
    ],
    price: "Contact sales",
  },
};

export default function BillingSettingsPage() {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscription();
  }, []);

  const fetchSubscription = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/subscriptions");
      if (res.ok) {
        const data = await res.json();
        setSubscription(data);
      }
    } catch {
      setError("Failed to load subscription");
    } finally {
      setLoading(false);
    }
  };

  const changeTier = async (newTier: SubscriptionTier) => {
    if (subscription?.tier === newTier) return;
    setError(null);
    setSuccess(null);
    setChanging(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: newTier }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to change tier");
        return;
      }
      setSuccess(`Subscription changed to ${TIER_DETAILS[newTier].name}`);
      fetchSubscription();
    } catch {
      setError("Failed to change tier");
    } finally {
      setChanging(false);
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
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "8px" }}>
        Billing & Subscription
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        Manage your subscription tier and billing.
      </p>

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

      {success && (
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
          {success}
        </div>
      )}

      {/* Current Plan */}
      {subscription && (
        <div
          style={{
            padding: "16px",
            marginBottom: "24px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#f9fafb",
          }}
        >
          <div style={{ fontSize: "14px", color: "#6b7280" }}>Current Plan</div>
          <div style={{ fontSize: "20px", fontWeight: 600 }}>
            {TIER_DETAILS[subscription.tier].name}
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
            Active since {new Date(subscription.activatedAt).toLocaleDateString()}
          </div>
        </div>
      )}

      {/* Tier Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px" }}>
        {(Object.keys(TIER_DETAILS) as SubscriptionTier[]).map((tier) => {
          const isCurrentTier = subscription?.tier === tier;
          const details = TIER_DETAILS[tier];
          return (
            <div
              key={tier}
              style={{
                padding: "20px",
                border: isCurrentTier ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                borderRadius: "8px",
                backgroundColor: isCurrentTier ? "#eff6ff" : "white",
              }}
            >
              <div style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px" }}>
                {details.name}
              </div>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "#3b82f6", marginBottom: "12px" }}>
                {details.price}
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 0" }}>
                {details.features.map((f) => (
                  <li
                    key={f}
                    style={{ fontSize: "13px", color: "#374151", marginBottom: "4px" }}
                  >
                    ✓ {f}
                  </li>
                ))}
              </ul>
              {isCurrentTier ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "8px",
                    fontSize: "13px",
                    color: "#3b82f6",
                    fontWeight: 500,
                  }}
                >
                  Current Plan
                </div>
              ) : (
                <button
                  onClick={() => changeTier(tier)}
                  disabled={changing}
                  style={{
                    width: "100%",
                    padding: "8px",
                    border: "1px solid #3b82f6",
                    borderRadius: "6px",
                    backgroundColor: "white",
                    color: "#3b82f6",
                    cursor: changing ? "not-allowed" : "pointer",
                    fontSize: "13px",
                    fontWeight: 500,
                  }}
                >
                  {changing ? "Changing..." : "Switch to this plan"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
