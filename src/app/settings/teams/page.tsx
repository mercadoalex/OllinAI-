/**
 * Settings: Teams & Services Management Page
 *
 * Client-side CRUD UI for managing teams and services.
 * Calls the /api/teams and /api/services endpoints.
 *
 * Requirements: 6.1
 */

"use client";

import { useState, useEffect, useCallback } from "react";

interface Team {
  teamId: string;
  name: string;
  members: string[];
  archived: boolean;
  createdAt: string;
}

interface Service {
  serviceId: string;
  name: string;
  owningTeamId: string;
  createdAt: string;
}

export default function TeamsSettingsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState("");
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceTeam, setNewServiceTeam] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [teamsRes, servicesRes] = await Promise.all([
        fetch("/api/teams"),
        fetch("/api/services"),
      ]);

      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        setTeams(teamsData.data || []);
      }
      if (servicesRes.ok) {
        const servicesData = await servicesRes.json();
        setServices(servicesData.data || []);
      }
    } catch (err) {
      setError("Failed to load teams and services.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName.trim(), members: [] }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create team");
        return;
      }
      setNewTeamName("");
      fetchData();
    } catch {
      setError("Failed to create team");
    }
  };

  const archiveTeam = async (teamId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to archive team");
        return;
      }
      fetchData();
    } catch {
      setError("Failed to archive team");
    }
  };

  const createService = async () => {
    if (!newServiceName.trim() || !newServiceTeam.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newServiceName.trim(),
          owningTeamId: newServiceTeam.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create service");
        return;
      }
      setNewServiceName("");
      setNewServiceTeam("");
      fetchData();
    } catch {
      setError("Failed to create service");
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
        Teams & Services
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

      {/* Teams Section */}
      <section style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "12px" }}>Teams</h2>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Team name"
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px" }}
          />
          <button
            onClick={createTeam}
            style={{
              padding: "8px 16px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Add Team
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {teams.map((team) => (
            <div
              key={team.teamId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                opacity: team.archived ? 0.5 : 1,
              }}
            >
              <div>
                <span style={{ fontWeight: 500 }}>{team.name}</span>
                <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6b7280" }}>
                  {team.members.length} members
                </span>
                {team.archived && (
                  <span style={{ marginLeft: "8px", fontSize: "11px", color: "#dc2626" }}>
                    (archived)
                  </span>
                )}
              </div>
              {!team.archived && (
                <button
                  onClick={() => archiveTeam(team.teamId)}
                  style={{
                    padding: "4px 12px",
                    fontSize: "12px",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    cursor: "pointer",
                    backgroundColor: "white",
                  }}
                >
                  Archive
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Services Section */}
      <section>
        <h2 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "12px" }}>Services</h2>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <input
            type="text"
            value={newServiceName}
            onChange={(e) => setNewServiceName(e.target.value)}
            placeholder="Service name"
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px" }}
          />
          <select
            value={newServiceTeam}
            onChange={(e) => setNewServiceTeam(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px" }}
          >
            <option value="">Select team</option>
            {teams
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.teamId} value={t.teamId}>
                  {t.name}
                </option>
              ))}
          </select>
          <button
            onClick={createService}
            style={{
              padding: "8px 16px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Add Service
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {services.map((svc) => (
            <div
              key={svc.serviceId}
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
                <span style={{ fontWeight: 500 }}>{svc.name}</span>
                <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6b7280" }}>
                  Team: {svc.owningTeamId}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
