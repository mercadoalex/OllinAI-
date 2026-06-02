//! Agent configuration — loaded from YAML file and CLI overrides.

use crate::mode::AgentMode;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Primary agent configuration struct.
///
/// Loaded from a YAML config file at startup, with CLI flags taking precedence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// OllinAI Collector API endpoint URL
    pub collector_url: String,

    /// Agent operating mode
    pub mode: AgentMode,

    /// Path to Ed25519 private key for Build_Attestation signing
    pub signing_key_path: Option<PathBuf>,

    /// OCI registry URI for Rule_Bundle pull
    pub rule_bundle_uri: Option<String>,

    /// Rule bundle poll interval in hours (default 6, range 1-24)
    pub rule_bundle_poll_hours: u64,

    /// Local telemetry ring buffer capacity (number of events)
    pub buffer_capacity: usize,

    /// Maximum batch size for telemetry transmission (max 500)
    pub max_batch_size: usize,

    /// Maximum latency from event capture to batch transmission in seconds
    pub max_transmission_latency_secs: u64,

    /// Retry interval when Collector API is unreachable (seconds)
    pub retry_interval_secs: u64,

    /// Maximum local buffer time before dropping oldest events (seconds)
    pub max_buffer_time_secs: u64,

    /// Canary observation window duration in seconds (1-3600)
    pub canary_window_secs: u64,

    /// Anomaly deviation threshold percentage (default 30, range 5-95)
    pub anomaly_threshold_percent: u8,

    /// Number of previous executions for rolling baseline (default 10)
    pub baseline_window_size: usize,

    /// Minimum executions before anomaly detection is active (default 5)
    pub min_baseline_executions: usize,

    /// Tenant ID (provided by orchestrator or config)
    pub tenant_id: Option<String>,

    /// Service ID being monitored
    pub service_id: Option<String>,

    /// Pipeline ID (CI/CD pipeline identifier)
    pub pipeline_id: Option<String>,

    /// Enable data residency mode (write to tenant S3 instead of Collector API)
    pub data_residency_enabled: bool,

    /// S3 bucket ARN for data residency mode
    pub data_residency_bucket_arn: Option<String>,

    /// AWS region for data residency S3 bucket
    pub data_residency_region: Option<String>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            collector_url: "https://collector.ollinai.dev/api/collector/telemetry".to_string(),
            mode: AgentMode::Profiling,
            signing_key_path: None,
            rule_bundle_uri: None,
            rule_bundle_poll_hours: 6,
            buffer_capacity: 10_000,
            max_batch_size: 500,
            max_transmission_latency_secs: 10,
            retry_interval_secs: 30,
            max_buffer_time_secs: 300, // 5 minutes
            canary_window_secs: 300,   // 5 minutes
            anomaly_threshold_percent: 30,
            baseline_window_size: 10,
            min_baseline_executions: 5,
            tenant_id: None,
            service_id: None,
            pipeline_id: None,
            data_residency_enabled: false,
            data_residency_bucket_arn: None,
            data_residency_region: None,
        }
    }
}

impl AgentConfig {
    /// Load configuration from YAML file, with CLI overrides applied.
    pub fn load(config_path: &str, cli: &crate::Cli) -> Result<Self, Box<dyn std::error::Error>> {
        // Attempt to load from file; fall back to defaults if file not found
        let mut config = match std::fs::read_to_string(config_path) {
            Ok(contents) => serde_yaml::from_str::<AgentConfig>(&contents)?,
            Err(_) => {
                tracing::warn!(
                    path = config_path,
                    "Config file not found — using defaults with CLI overrides"
                );
                AgentConfig::default()
            }
        };

        // Apply CLI overrides
        if let Some(url) = &cli.collector_url {
            config.collector_url = url.clone();
        }

        if let Some(key_path) = &cli.signing_key_path {
            config.signing_key_path = Some(PathBuf::from(key_path));
        }

        if let Some(uri) = &cli.rule_bundle_uri {
            config.rule_bundle_uri = Some(uri.clone());
        }

        config.buffer_capacity = cli.buffer_capacity;
        config.canary_window_secs = cli.canary_window_secs.clamp(1, 3600);

        // Parse mode from CLI string
        config.mode = AgentMode::from_str(&cli.mode);

        Ok(config)
    }
}
