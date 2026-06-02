//! Agent operating modes.
//!
//! Determines behavior for anomaly detection, rule enforcement,
//! and telemetry reporting.

use serde::{Deserialize, Serialize};

/// Agent operating mode — controls detection and enforcement behavior.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    /// Full runtime profiling with anomaly detection active.
    /// Used during CI/CD pipeline execution.
    Profiling,

    /// Post-deploy canary observation mode.
    /// Monitors syscall profile, network, and errors for configurable window.
    CanaryObservation,

    /// Building baseline data — no anomaly flags generated.
    /// Active when fewer than min_baseline_executions are recorded.
    BaselineBuilding,

    /// Rule matches are logged but pipeline is not terminated.
    /// Detection alerts emitted without enforcement action.
    MonitorOnly,

    /// Critical rule matches terminate the pipeline immediately.
    /// Info/warning severity matches are logged and continue.
    Enforcement,
}

impl AgentMode {
    /// Parse mode from a string (case-insensitive).
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "profiling" => AgentMode::Profiling,
            "canary" | "canary_observation" | "canaryobservation" => AgentMode::CanaryObservation,
            "baseline" | "baseline_building" | "baselinebuilding" => AgentMode::BaselineBuilding,
            "monitor" | "monitor_only" | "monitoronly" => AgentMode::MonitorOnly,
            "enforcement" | "enforce" => AgentMode::Enforcement,
            _ => AgentMode::Profiling, // Default fallback
        }
    }

    /// Whether anomaly detection should be active in this mode.
    pub fn anomaly_detection_active(&self) -> bool {
        matches!(
            self,
            AgentMode::Profiling | AgentMode::CanaryObservation | AgentMode::Enforcement
        )
    }

    /// Whether rule enforcement (pipeline termination) is active.
    pub fn enforcement_active(&self) -> bool {
        matches!(self, AgentMode::Enforcement)
    }

    /// Whether the agent should be building baseline data.
    pub fn is_baseline_building(&self) -> bool {
        matches!(self, AgentMode::BaselineBuilding)
    }
}
