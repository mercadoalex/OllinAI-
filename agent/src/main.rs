//! OllinAI eBPF Runtime Telemetry Agent
//!
//! Captures process tree activity, network connections, file system writes,
//! and resource consumption during CI/CD pipeline execution and post-deploy
//! canary observation. Generates signed Build_Attestation documents.

mod ancestry;
mod attestation;
mod baseline;
mod buffer;
mod canary;
mod config;
mod detection;
mod fallback;
mod mode;
mod probe;
mod residency;
mod rules;
mod signing;
mod telemetry;

use clap::Parser;
use config::AgentConfig;
use probe::kernel_check::{KernelCheckResult, perform_kernel_check};
use tracing::{error, info, warn};

/// OllinAI Agent — eBPF runtime telemetry for CI/CD pipelines
#[derive(Parser, Debug)]
#[command(name = "ollinai-agent", version, about)]
struct Cli {
    /// Path to agent configuration file (YAML)
    #[arg(short, long, default_value = "/etc/ollinai/agent.yaml")]
    config: String,

    /// Collector API endpoint URL
    #[arg(long, env = "OLLINAI_COLLECTOR_URL")]
    collector_url: Option<String>,

    /// Agent operating mode
    #[arg(long, default_value = "profiling")]
    mode: String,

    /// Path to Ed25519 signing key
    #[arg(long, env = "OLLINAI_SIGNING_KEY_PATH")]
    signing_key_path: Option<String>,

    /// Rule bundle OCI registry URI
    #[arg(long, env = "OLLINAI_RULE_BUNDLE_URI")]
    rule_bundle_uri: Option<String>,

    /// Telemetry buffer capacity (number of events)
    #[arg(long, default_value = "10000")]
    buffer_capacity: usize,

    /// Canary observation window in seconds (1-3600)
    #[arg(long, default_value = "300")]
    canary_window_secs: u64,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    // Initialize tracing/logging
    let log_filter = if cli.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(log_filter)
        .json()
        .init();

    info!(
        version = env!("CARGO_PKG_VERSION"),
        "OllinAI Agent starting"
    );

    // Load configuration
    let agent_config = AgentConfig::load(&cli.config, &cli)?;
    info!(
        collector_url = %agent_config.collector_url,
        mode = ?agent_config.mode,
        buffer_capacity = agent_config.buffer_capacity,
        "Configuration loaded"
    );

    // Pre-flight kernel compatibility check
    let kernel_result = perform_kernel_check();
    match &kernel_result {
        KernelCheckResult::Pass { kernel_version, arch } => {
            info!(
                kernel_version = %kernel_version,
                arch = %arch,
                "Kernel compatibility check passed — eBPF probes available"
            );
        }
        KernelCheckResult::Degraded { kernel_version, arch, missing_caps } => {
            warn!(
                kernel_version = %kernel_version,
                arch = %arch,
                missing_caps = ?missing_caps,
                "Kernel compatible but capabilities insufficient — falling back to userspace mode"
            );
        }
        KernelCheckResult::Unsupported { kernel_version, arch, reason } => {
            error!(
                kernel_version = %kernel_version,
                arch = %arch,
                reason = %reason,
                "Kernel unsupported for eBPF — operating in userspace fallback mode"
            );
        }
    }

    // Determine effective mode based on kernel check
    let use_ebpf = matches!(kernel_result, KernelCheckResult::Pass { .. });

    if use_ebpf {
        info!("Attaching eBPF probes for syscall monitoring");
        if let Err(e) = probe::attach_probes(&agent_config).await {
            warn!(error = %e, "Failed to attach eBPF probes — falling back to userspace");
        }
    } else {
        info!("Running in userspace fallback mode (no eBPF probe attachment)");
    }

    // TODO: Start telemetry collection loop, batching, and transmission
    // TODO: Start canary observation if in CanaryObservation mode
    // TODO: Load rule bundle if URI configured

    info!("OllinAI Agent running — awaiting pipeline events");

    // Keep agent alive until signaled
    tokio::signal::ctrl_c().await?;
    info!("Shutdown signal received — flushing telemetry buffer");

    Ok(())
}
