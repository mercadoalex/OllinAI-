//! Telemetry event types captured by the eBPF agent.
//!
//! These events are collected from eBPF probes (or userspace fallback)
//! and batched for transmission to the Collector API.

use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::PathBuf;

/// Core telemetry event enum — represents all observable events from the agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TelemetryEvent {
    /// Process execution observed via execve/fork/clone
    ProcessTree {
        pid: u32,
        ppid: u32,
        comm: String,
        argv: Vec<String>,
        cwd: PathBuf,
        timestamp_ns: u64,
    },

    /// Outbound network connection initiated
    NetworkConnect {
        pid: u32,
        dest_addr: IpAddr,
        dest_port: u16,
        domain: Option<String>,
        timestamp_ns: u64,
    },

    /// File write operation observed
    FileWrite {
        pid: u32,
        path: PathBuf,
        bytes_written: u64,
        timestamp_ns: u64,
    },

    /// File read operation (credential access tracking)
    FileRead {
        pid: u32,
        path: PathBuf,
        timestamp_ns: u64,
    },

    /// Resource utilization snapshot
    ResourceUsage {
        cpu_percent: f32,
        memory_bytes: u64,
        timestamp_ns: u64,
    },

    /// Syscall profile for canary observation
    SyscallProfile {
        syscall_id: u32,
        count: u64,
        latency_ns: u64,
        timestamp_ns: u64,
    },
}

/// A batch of telemetry events ready for transmission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryBatch {
    /// Unique batch identifier
    pub batch_id: String,

    /// Tenant identifier
    pub tenant_id: String,

    /// Service being monitored
    pub service_id: String,

    /// Pipeline identifier (if in CI/CD context)
    pub pipeline_id: Option<String>,

    /// Events in this batch (max 500)
    pub events: Vec<TelemetryEvent>,

    /// Number of events dropped due to buffer overflow since last batch
    pub dropped_event_count: u64,

    /// Agent version
    pub agent_version: String,

    /// Kernel version string
    pub kernel_version: String,

    /// Architecture (e.g., "x86_64", "aarch64")
    pub arch: String,

    /// Whether agent is running in degraded (userspace) mode
    pub degraded_mode: bool,

    /// Batch creation timestamp (Unix epoch nanoseconds)
    pub created_at_ns: u64,
}

/// Anomaly flag generated when baseline deviation is detected.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "anomaly_type", rename_all = "snake_case")]
pub enum AnomalyFlag {
    /// Network connection to domain not in baseline
    UnknownNetworkDestination {
        pid: u32,
        domain: String,
        dest_addr: IpAddr,
        dest_port: u16,
        initiating_process: String,
    },

    /// Resource consumption exceeds 2x rolling average
    ResourceAnomaly {
        metric: ResourceMetricType,
        current_value: f64,
        baseline_average: f64,
        ratio: f64,
    },

    /// Credential file access from package installer descendant
    CredentialExfiltration {
        pid: u32,
        credential_path: PathBuf,
        ancestor_command: String,
        process_chain: Vec<String>,
    },

    /// Syscall profile deviation exceeds threshold (canary observation)
    SyscallDeviation {
        syscall_id: u32,
        current_count: u64,
        baseline_count: u64,
        deviation_percent: f64,
    },

    /// Kernel-level error signal (OOM, segfault, connection failures)
    KernelError {
        error_type: KernelErrorType,
        count: u32,
        window_secs: u32,
    },
}

/// Resource metric types for anomaly detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceMetricType {
    CpuPercent,
    MemoryBytes,
}

/// Kernel error types detected during canary observation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KernelErrorType {
    OomKill,
    Segfault,
    FailedConnections,
}
