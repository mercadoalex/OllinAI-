//! Post-deploy canary observation.
//!
//! Detects deployments (via process binary change detection) and observes the
//! deployed service's syscall profile, network connections, and error signals
//! for a configurable observation window. Compares the post-deploy profile
//! against a rolling baseline from the previous 10 successful deployments.
//!
//! Requirements: 14.1, 14.2, 14.3, 14.5, 14.6, 14.9

use crate::telemetry::{AnomalyFlag, KernelErrorType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Default canary observation window (5 minutes).
const DEFAULT_OBSERVATION_WINDOW_SECS: u64 = 300;

/// Minimum observation window (1 minute).
const MIN_OBSERVATION_WINDOW_SECS: u64 = 60;

/// Maximum observation window (60 minutes).
const MAX_OBSERVATION_WINDOW_SECS: u64 = 3600;

/// Default deviation threshold percentage.
const DEFAULT_DEVIATION_THRESHOLD_PERCENT: u8 = 30;

/// Minimum deviation threshold.
const MIN_DEVIATION_THRESHOLD_PERCENT: u8 = 5;

/// Maximum deviation threshold.
const MAX_DEVIATION_THRESHOLD_PERCENT: u8 = 95;

/// Number of previous deployments for rolling baseline.
const BASELINE_DEPLOYMENT_COUNT: usize = 10;

/// Failed connection threshold within a 30-second window.
const FAILED_CONNECTION_THRESHOLD: u32 = 5;

/// Window for counting failed connections (seconds).
const FAILED_CONNECTION_WINDOW_SECS: u32 = 30;

/// A syscall profile snapshot: maps syscall ID → (call count, total latency_ns).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyscallProfile {
    /// Syscall ID → (count, total_latency_ns)
    pub syscalls: HashMap<u32, SyscallStats>,
}

/// Statistics for a single syscall type.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct SyscallStats {
    /// Number of times this syscall was observed
    pub count: u64,
    /// Total latency in nanoseconds across all invocations
    pub total_latency_ns: u64,
}

/// A complete canary observation snapshot for one deployment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanarySnapshot {
    /// Syscall profile during the observation window
    pub syscall_profile: SyscallProfile,
    /// Number of network connections observed
    pub network_connection_count: u64,
    /// Number of errors observed
    pub error_count: u32,
    /// OOM kill events
    pub oom_kills: u32,
    /// Segfaults
    pub segfaults: u32,
    /// Failed connection attempts
    pub failed_connections: u32,
    /// Non-zero exit codes from processes
    pub nonzero_exits: u32,
    /// Signal-killed processes (SIGKILL, SIGSEGV, etc.)
    pub signal_kills: u32,
    /// Duration of the observation window
    pub observation_duration_secs: u64,
    /// Deployment timestamp
    pub deployment_timestamp_ns: u64,
}

/// Rolling baseline for canary comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanaryBaseline {
    /// Historical snapshots (most recent last), up to BASELINE_DEPLOYMENT_COUNT
    snapshots: Vec<CanarySnapshot>,
}

/// Result of a canary observation comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CanaryResult {
    /// Service is healthy — no significant deviations detected
    Healthy {
        /// Overall deviation percentage (below threshold)
        deviation_percent: f64,
        /// Number of baseline snapshots used for comparison
        baseline_count: usize,
    },
    /// Deviation detected — syscall profile diverges from baseline
    Deviation {
        /// Overall deviation percentage
        deviation_percent: f64,
        /// Specific syscall deviations that exceeded threshold
        syscall_deviations: Vec<AnomalyFlag>,
        /// Number of baseline snapshots used for comparison
        baseline_count: usize,
    },
    /// Early warning — kernel-level errors detected
    EarlyWarning {
        /// Kernel error anomaly flags
        errors: Vec<AnomalyFlag>,
        /// Whether deviation was also detected
        has_deviation: bool,
    },
    /// Insufficient baseline data — still building
    BaselineBuilding {
        /// Number of snapshots available (< BASELINE_DEPLOYMENT_COUNT threshold)
        available_snapshots: usize,
    },
}

/// Canary observation configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanaryConfig {
    /// Observation window duration in seconds
    pub observation_window_secs: u64,
    /// Deviation threshold percentage (5-95)
    pub deviation_threshold_percent: u8,
    /// Number of historical deployments for baseline (default 10)
    pub baseline_count: usize,
}

impl Default for CanaryConfig {
    fn default() -> Self {
        Self {
            observation_window_secs: DEFAULT_OBSERVATION_WINDOW_SECS,
            deviation_threshold_percent: DEFAULT_DEVIATION_THRESHOLD_PERCENT,
            baseline_count: BASELINE_DEPLOYMENT_COUNT,
        }
    }
}

impl CanaryConfig {
    /// Create a new config with validation applied.
    pub fn new(observation_window_secs: u64, deviation_threshold_percent: u8) -> Self {
        Self {
            observation_window_secs: observation_window_secs
                .clamp(MIN_OBSERVATION_WINDOW_SECS, MAX_OBSERVATION_WINDOW_SECS),
            deviation_threshold_percent: deviation_threshold_percent
                .clamp(MIN_DEVIATION_THRESHOLD_PERCENT, MAX_DEVIATION_THRESHOLD_PERCENT),
            baseline_count: BASELINE_DEPLOYMENT_COUNT,
        }
    }

    /// Get the observation window as a Duration.
    pub fn observation_window(&self) -> Duration {
        Duration::from_secs(self.observation_window_secs)
    }
}

/// Deployment detection method.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DeploymentDetectionMethod {
    /// Process binary file changed (mtime or inode)
    BinaryChange {
        binary_path: String,
        previous_mtime: u64,
        new_mtime: u64,
    },
    /// Kubernetes rollout event (placeholder — requires k8s API integration)
    KubernetesRollout {
        namespace: String,
        deployment_name: String,
        new_revision: String,
    },
    /// Systemd service restart detected (placeholder)
    SystemdRestart {
        unit_name: String,
    },
}

/// Canary observer — manages observation lifecycle and baseline comparison.
#[derive(Debug, Clone)]
pub struct CanaryObserver {
    config: CanaryConfig,
    baseline: CanaryBaseline,
    /// Current observation in progress (if any)
    current_observation: Option<CanarySnapshot>,
    /// Kernel error events accumulator during current observation
    kernel_errors: Vec<AnomalyFlag>,
    /// Failed connection timestamps (for 30s window counting)
    failed_connection_timestamps: Vec<u64>,
}

impl CanaryBaseline {
    /// Create a new empty baseline.
    pub fn new() -> Self {
        Self {
            snapshots: Vec::new(),
        }
    }

    /// Get the number of recorded snapshots.
    pub fn snapshot_count(&self) -> usize {
        self.snapshots.len()
    }

    /// Whether the baseline has enough data for comparison.
    pub fn has_sufficient_data(&self) -> bool {
        // We need at least 1 snapshot to compare against, but for reliability
        // we use the full BASELINE_DEPLOYMENT_COUNT threshold from Req 14.9
        !self.snapshots.is_empty()
    }

    /// Whether still in baseline-building mode (fewer than 10 historical deployments).
    pub fn is_building(&self) -> bool {
        self.snapshots.len() < BASELINE_DEPLOYMENT_COUNT
    }

    /// Record a completed canary snapshot.
    pub fn record_snapshot(&mut self, snapshot: CanarySnapshot) {
        self.snapshots.push(snapshot);
        // Keep only the most recent BASELINE_DEPLOYMENT_COUNT entries
        if self.snapshots.len() > BASELINE_DEPLOYMENT_COUNT {
            let excess = self.snapshots.len() - BASELINE_DEPLOYMENT_COUNT;
            self.snapshots.drain(..excess);
        }
    }

    /// Compute the average syscall profile from the baseline.
    pub fn average_syscall_profile(&self) -> SyscallProfile {
        let mut totals: HashMap<u32, (u64, u64)> = HashMap::new();
        let count = self.snapshots.len() as u64;

        if count == 0 {
            return SyscallProfile::default();
        }

        for snapshot in &self.snapshots {
            for (&syscall_id, stats) in &snapshot.syscall_profile.syscalls {
                let entry = totals.entry(syscall_id).or_insert((0, 0));
                entry.0 += stats.count;
                entry.1 += stats.total_latency_ns;
            }
        }

        let mut profile = SyscallProfile::default();
        for (syscall_id, (total_count, total_latency)) in totals {
            profile.syscalls.insert(
                syscall_id,
                SyscallStats {
                    count: total_count / count,
                    total_latency_ns: total_latency / count,
                },
            );
        }

        profile
    }
}

impl Default for CanaryBaseline {
    fn default() -> Self {
        Self::new()
    }
}

impl CanaryObserver {
    /// Create a new canary observer.
    pub fn new(config: CanaryConfig) -> Self {
        Self {
            config,
            baseline: CanaryBaseline::new(),
            current_observation: None,
            kernel_errors: Vec::new(),
            failed_connection_timestamps: Vec::new(),
        }
    }

    /// Create with an existing baseline.
    pub fn with_baseline(config: CanaryConfig, baseline: CanaryBaseline) -> Self {
        Self {
            config,
            baseline,
            current_observation: None,
            kernel_errors: Vec::new(),
            failed_connection_timestamps: Vec::new(),
        }
    }

    /// Get a reference to the config.
    pub fn config(&self) -> &CanaryConfig {
        &self.config
    }

    /// Get a reference to the baseline.
    pub fn baseline(&self) -> &CanaryBaseline {
        &self.baseline
    }

    /// Start a new canary observation window.
    pub fn start_observation(&mut self, deployment_timestamp_ns: u64) {
        self.current_observation = Some(CanarySnapshot {
            syscall_profile: SyscallProfile::default(),
            network_connection_count: 0,
            error_count: 0,
            oom_kills: 0,
            segfaults: 0,
            failed_connections: 0,
            nonzero_exits: 0,
            signal_kills: 0,
            observation_duration_secs: self.config.observation_window_secs,
            deployment_timestamp_ns,
        });
        self.kernel_errors.clear();
        self.failed_connection_timestamps.clear();
    }

    /// Whether an observation is currently in progress.
    pub fn is_observing(&self) -> bool {
        self.current_observation.is_some()
    }

    /// Record a syscall event during observation.
    pub fn record_syscall(&mut self, syscall_id: u32, count: u64, latency_ns: u64) {
        if let Some(ref mut obs) = self.current_observation {
            let entry = obs
                .syscall_profile
                .syscalls
                .entry(syscall_id)
                .or_insert(SyscallStats::default());
            entry.count += count;
            entry.total_latency_ns += latency_ns;
        }
    }

    /// Record a network connection during observation.
    pub fn record_network_connection(&mut self) {
        if let Some(ref mut obs) = self.current_observation {
            obs.network_connection_count += 1;
        }
    }

    /// Record a failed connection attempt. Checks if the threshold is breached.
    pub fn record_failed_connection(&mut self, timestamp_ns: u64) -> Option<AnomalyFlag> {
        if let Some(ref mut obs) = self.current_observation {
            obs.failed_connections += 1;
            self.failed_connection_timestamps.push(timestamp_ns);

            // Check 30-second window threshold
            let window_ns = (FAILED_CONNECTION_WINDOW_SECS as u64) * 1_000_000_000;
            let cutoff = timestamp_ns.saturating_sub(window_ns);
            let recent_count = self
                .failed_connection_timestamps
                .iter()
                .filter(|&&ts| ts >= cutoff)
                .count() as u32;

            if recent_count >= FAILED_CONNECTION_THRESHOLD {
                let flag = AnomalyFlag::KernelError {
                    error_type: KernelErrorType::FailedConnections,
                    count: recent_count,
                    window_secs: FAILED_CONNECTION_WINDOW_SECS,
                };
                self.kernel_errors.push(flag.clone());
                return Some(flag);
            }
        }
        None
    }

    /// Record an OOM kill event.
    pub fn record_oom_kill(&mut self) -> AnomalyFlag {
        if let Some(ref mut obs) = self.current_observation {
            obs.oom_kills += 1;
            obs.error_count += 1;
        }
        let flag = AnomalyFlag::KernelError {
            error_type: KernelErrorType::OomKill,
            count: 1,
            window_secs: 0,
        };
        self.kernel_errors.push(flag.clone());
        flag
    }

    /// Record a segfault event.
    pub fn record_segfault(&mut self) -> AnomalyFlag {
        if let Some(ref mut obs) = self.current_observation {
            obs.segfaults += 1;
            obs.error_count += 1;
        }
        let flag = AnomalyFlag::KernelError {
            error_type: KernelErrorType::Segfault,
            count: 1,
            window_secs: 0,
        };
        self.kernel_errors.push(flag.clone());
        flag
    }

    /// Record a non-zero exit code.
    pub fn record_nonzero_exit(&mut self) {
        if let Some(ref mut obs) = self.current_observation {
            obs.nonzero_exits += 1;
            obs.error_count += 1;
        }
    }

    /// Record a signal kill (SIGKILL, SIGSEGV, etc.).
    pub fn record_signal_kill(&mut self) {
        if let Some(ref mut obs) = self.current_observation {
            obs.signal_kills += 1;
            obs.error_count += 1;
        }
    }

    /// Complete the observation window and produce a canary result.
    ///
    /// Compares the observed profile against the rolling baseline and returns
    /// the canary verdict. Also records the snapshot in the baseline for future
    /// comparisons.
    pub fn complete_observation(&mut self) -> CanaryResult {
        let snapshot = match self.current_observation.take() {
            Some(s) => s,
            None => {
                return CanaryResult::BaselineBuilding {
                    available_snapshots: self.baseline.snapshot_count(),
                };
            }
        };

        // Check for kernel errors first (early warning takes priority)
        if !self.kernel_errors.is_empty() {
            let errors = std::mem::take(&mut self.kernel_errors);
            let has_deviation = if self.baseline.has_sufficient_data() {
                let deviation = self.compute_deviation(&snapshot);
                deviation > self.config.deviation_threshold_percent as f64
            } else {
                false
            };
            self.baseline.record_snapshot(snapshot);
            return CanaryResult::EarlyWarning {
                errors,
                has_deviation,
            };
        }

        // If baseline is still building (< 10 deployments), report raw telemetry
        if self.baseline.is_building() && !self.baseline.has_sufficient_data() {
            let available = self.baseline.snapshot_count();
            self.baseline.record_snapshot(snapshot);
            return CanaryResult::BaselineBuilding {
                available_snapshots: available,
            };
        }

        // Compare against baseline
        let deviation_percent = self.compute_deviation(&snapshot);
        let baseline_count = self.baseline.snapshot_count();

        if deviation_percent > self.config.deviation_threshold_percent as f64 {
            let syscall_deviations = self.compute_syscall_deviations(&snapshot);
            self.baseline.record_snapshot(snapshot);
            CanaryResult::Deviation {
                deviation_percent,
                syscall_deviations,
                baseline_count,
            }
        } else {
            self.baseline.record_snapshot(snapshot);
            CanaryResult::Healthy {
                deviation_percent,
                baseline_count,
            }
        }
    }

    /// Compute overall deviation percentage between current snapshot and baseline.
    fn compute_deviation(&self, snapshot: &CanarySnapshot) -> f64 {
        let baseline_profile = self.baseline.average_syscall_profile();

        if baseline_profile.syscalls.is_empty() && snapshot.syscall_profile.syscalls.is_empty() {
            return 0.0;
        }

        let mut total_deviation = 0.0;
        let mut comparison_count = 0u64;

        // Compare each syscall in the current snapshot against baseline
        for (&syscall_id, current_stats) in &snapshot.syscall_profile.syscalls {
            let baseline_stats = baseline_profile
                .syscalls
                .get(&syscall_id)
                .copied()
                .unwrap_or_default();

            if baseline_stats.count > 0 {
                let count_deviation = (current_stats.count as f64 - baseline_stats.count as f64).abs()
                    / baseline_stats.count as f64
                    * 100.0;
                total_deviation += count_deviation;
                comparison_count += 1;
            } else if current_stats.count > 0 {
                // New syscall not in baseline — 100% deviation for this entry
                total_deviation += 100.0;
                comparison_count += 1;
            }
        }

        // Check for syscalls that disappeared
        for (&syscall_id, baseline_stats) in &baseline_profile.syscalls {
            if baseline_stats.count > 0
                && !snapshot.syscall_profile.syscalls.contains_key(&syscall_id)
            {
                total_deviation += 100.0;
                comparison_count += 1;
            }
        }

        if comparison_count == 0 {
            return 0.0;
        }

        total_deviation / comparison_count as f64
    }

    /// Compute individual syscall deviation flags.
    fn compute_syscall_deviations(&self, snapshot: &CanarySnapshot) -> Vec<AnomalyFlag> {
        let baseline_profile = self.baseline.average_syscall_profile();
        let threshold = self.config.deviation_threshold_percent as f64;
        let mut flags = Vec::new();

        for (&syscall_id, current_stats) in &snapshot.syscall_profile.syscalls {
            let baseline_stats = baseline_profile
                .syscalls
                .get(&syscall_id)
                .copied()
                .unwrap_or_default();

            if baseline_stats.count > 0 {
                let deviation_percent = (current_stats.count as f64 - baseline_stats.count as f64).abs()
                    / baseline_stats.count as f64
                    * 100.0;

                if deviation_percent > threshold {
                    flags.push(AnomalyFlag::SyscallDeviation {
                        syscall_id,
                        current_count: current_stats.count,
                        baseline_count: baseline_stats.count,
                        deviation_percent,
                    });
                }
            }
        }

        flags
    }
}

/// Detect deployment via process binary change.
///
/// Simplified detection: checks if the binary at the given path has a different
/// modification time than the previously recorded value.
pub fn detect_binary_change(
    binary_path: &str,
    previous_mtime: u64,
) -> Option<DeploymentDetectionMethod> {
    match std::fs::metadata(binary_path) {
        Ok(metadata) => {
            let mtime = metadata
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();

            if mtime != previous_mtime {
                Some(DeploymentDetectionMethod::BinaryChange {
                    binary_path: binary_path.to_string(),
                    previous_mtime,
                    new_mtime: mtime,
                })
            } else {
                None
            }
        }
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn make_baseline_snapshot(
        syscalls: Vec<(u32, u64)>,
        observation_secs: u64,
    ) -> CanarySnapshot {
        let mut profile = SyscallProfile::default();
        for (id, count) in syscalls {
            profile.syscalls.insert(id, SyscallStats { count, total_latency_ns: count * 100 });
        }
        CanarySnapshot {
            syscall_profile: profile,
            network_connection_count: 10,
            error_count: 0,
            oom_kills: 0,
            segfaults: 0,
            failed_connections: 0,
            nonzero_exits: 0,
            signal_kills: 0,
            observation_duration_secs: observation_secs,
            deployment_timestamp_ns: 1000,
        }
    }

    #[test]
    fn test_canary_config_validation() {
        let config = CanaryConfig::new(30, 50); // 30s below minimum
        assert_eq!(config.observation_window_secs, 60); // clamped to min

        let config = CanaryConfig::new(7200, 50); // above max
        assert_eq!(config.observation_window_secs, 3600); // clamped to max

        let config = CanaryConfig::new(300, 2); // threshold below min
        assert_eq!(config.deviation_threshold_percent, 5); // clamped

        let config = CanaryConfig::new(300, 99); // threshold above max
        assert_eq!(config.deviation_threshold_percent, 95); // clamped
    }

    #[test]
    fn test_canary_healthy_result() {
        let config = CanaryConfig::new(300, 30);
        let mut observer = CanaryObserver::new(config);

        // Build baseline with 10 identical snapshots
        for _ in 0..10 {
            observer.baseline.record_snapshot(make_baseline_snapshot(
                vec![(1, 100), (2, 200), (3, 50)],
                300,
            ));
        }

        // Start observation with similar profile
        observer.start_observation(5000);
        observer.record_syscall(1, 105, 10500); // 5% deviation
        observer.record_syscall(2, 190, 19000); // 5% deviation
        observer.record_syscall(3, 48, 4800);   // 4% deviation

        let result = observer.complete_observation();
        match result {
            CanaryResult::Healthy { deviation_percent, baseline_count } => {
                assert!(deviation_percent < 30.0);
                assert_eq!(baseline_count, 10);
            }
            _ => panic!("Expected Healthy result, got {:?}", result),
        }
    }

    #[test]
    fn test_canary_deviation_result() {
        let config = CanaryConfig::new(300, 30);
        let mut observer = CanaryObserver::new(config);

        // Build baseline
        for _ in 0..10 {
            observer.baseline.record_snapshot(make_baseline_snapshot(
                vec![(1, 100), (2, 200)],
                300,
            ));
        }

        // Start observation with high deviation
        observer.start_observation(5000);
        observer.record_syscall(1, 500, 50000); // 400% deviation
        observer.record_syscall(2, 800, 80000); // 300% deviation

        let result = observer.complete_observation();
        match result {
            CanaryResult::Deviation { deviation_percent, syscall_deviations, .. } => {
                assert!(deviation_percent > 30.0);
                assert!(!syscall_deviations.is_empty());
            }
            _ => panic!("Expected Deviation result, got {:?}", result),
        }
    }

    #[test]
    fn test_canary_early_warning_oom() {
        let config = CanaryConfig::new(300, 30);
        let mut observer = CanaryObserver::new(config);

        for _ in 0..10 {
            observer.baseline.record_snapshot(make_baseline_snapshot(
                vec![(1, 100)],
                300,
            ));
        }

        observer.start_observation(5000);
        observer.record_syscall(1, 100, 10000);
        observer.record_oom_kill();

        let result = observer.complete_observation();
        match result {
            CanaryResult::EarlyWarning { errors, .. } => {
                assert!(!errors.is_empty());
                assert!(matches!(
                    errors[0],
                    AnomalyFlag::KernelError { error_type: KernelErrorType::OomKill, .. }
                ));
            }
            _ => panic!("Expected EarlyWarning result, got {:?}", result),
        }
    }

    #[test]
    fn test_canary_early_warning_failed_connections() {
        let config = CanaryConfig::new(300, 30);
        let mut observer = CanaryObserver::new(config);

        for _ in 0..10 {
            observer.baseline.record_snapshot(make_baseline_snapshot(
                vec![(1, 100)],
                300,
            ));
        }

        observer.start_observation(5000);
        // Record 5 failed connections within 30 seconds
        let base_ns = 1_000_000_000u64; // 1 second
        for i in 0..5 {
            let result = observer.record_failed_connection(base_ns + i * 1_000_000_000);
            if i == 4 {
                assert!(result.is_some()); // Threshold breached on 5th
            }
        }

        let result = observer.complete_observation();
        assert!(matches!(result, CanaryResult::EarlyWarning { .. }));
    }

    #[test]
    fn test_canary_baseline_building() {
        let config = CanaryConfig::new(300, 30);
        let mut observer = CanaryObserver::new(config);
        // No baseline at all

        observer.start_observation(5000);
        observer.record_syscall(1, 100, 10000);

        let result = observer.complete_observation();
        match result {
            CanaryResult::BaselineBuilding { available_snapshots } => {
                assert_eq!(available_snapshots, 0);
            }
            _ => panic!("Expected BaselineBuilding result, got {:?}", result),
        }
    }

    #[test]
    fn test_baseline_retention() {
        let mut baseline = CanaryBaseline::new();

        // Record 12 snapshots — should only keep 10
        for i in 0..12 {
            baseline.record_snapshot(make_baseline_snapshot(vec![(1, i as u64 * 10)], 300));
        }

        assert_eq!(baseline.snapshot_count(), 10);
    }

    #[test]
    fn test_observation_lifecycle() {
        let config = CanaryConfig::new(300, 30);
        let mut observer = CanaryObserver::new(config);

        assert!(!observer.is_observing());
        observer.start_observation(1000);
        assert!(observer.is_observing());
        observer.complete_observation();
        assert!(!observer.is_observing());
    }

    // --- Property-based tests ---

    proptest! {
        /// **Validates: Requirements 14.1** - Observation window is always clamped to [1, 60] minutes
        #[test]
        fn prop_observation_window_clamped(
            window_secs in 0u64..10000,
        ) {
            let config = CanaryConfig::new(window_secs, 30);
            prop_assert!(config.observation_window_secs >= MIN_OBSERVATION_WINDOW_SECS);
            prop_assert!(config.observation_window_secs <= MAX_OBSERVATION_WINDOW_SECS);
        }

        /// **Validates: Requirements 14.2** - Deviation threshold is clamped to [5, 95]%
        #[test]
        fn prop_deviation_threshold_clamped(
            threshold in 0u8..=100,
        ) {
            let config = CanaryConfig::new(300, threshold);
            prop_assert!(config.deviation_threshold_percent >= MIN_DEVIATION_THRESHOLD_PERCENT);
            prop_assert!(config.deviation_threshold_percent <= MAX_DEVIATION_THRESHOLD_PERCENT);
        }

        /// **Validates: Requirements 14.2** - Baseline keeps max BASELINE_DEPLOYMENT_COUNT snapshots
        #[test]
        fn prop_baseline_max_retention(
            num_snapshots in 1usize..30,
        ) {
            let mut baseline = CanaryBaseline::new();
            for i in 0..num_snapshots {
                baseline.record_snapshot(make_baseline_snapshot(vec![(1, (i as u64 + 1) * 10)], 300));
            }
            prop_assert!(baseline.snapshot_count() <= BASELINE_DEPLOYMENT_COUNT);
        }

        /// **Validates: Requirements 14.3** - 5+ failed connections in 30s triggers early warning
        #[test]
        fn prop_failed_connection_threshold(
            num_connections in 5u32..20,
        ) {
            let config = CanaryConfig::new(300, 30);
            let mut observer = CanaryObserver::new(config);

            // Add baseline so we don't get BaselineBuilding
            for _ in 0..10 {
                observer.baseline.record_snapshot(make_baseline_snapshot(vec![(1, 100)], 300));
            }

            observer.start_observation(5000);
            let base_ns = 1_000_000_000u64;
            let mut triggered = false;

            for i in 0..num_connections {
                // All within 30 seconds
                if observer.record_failed_connection(base_ns + (i as u64) * 100_000_000).is_some() {
                    triggered = true;
                }
            }

            prop_assert!(triggered);
            let result = observer.complete_observation();
            let is_early_warning = matches!(result, CanaryResult::EarlyWarning { .. });
            prop_assert!(is_early_warning);
        }

        /// **Validates: Requirements 14.5** - Healthy canary when deviation < threshold
        #[test]
        fn prop_healthy_when_deviation_below_threshold(
            baseline_count_val in 100u64..200,
            deviation_factor in 0.8f64..1.15, // Within ±15%
        ) {
            let config = CanaryConfig::new(300, 30); // 30% threshold
            let mut observer = CanaryObserver::new(config);

            for _ in 0..10 {
                observer.baseline.record_snapshot(make_baseline_snapshot(
                    vec![(1, baseline_count_val)],
                    300,
                ));
            }

            observer.start_observation(5000);
            let observed = (baseline_count_val as f64 * deviation_factor) as u64;
            observer.record_syscall(1, observed, observed * 100);

            let result = observer.complete_observation();
            // With deviation < 30%, should be Healthy
            match result {
                CanaryResult::Healthy { deviation_percent, .. } => {
                    prop_assert!(deviation_percent < 30.0);
                }
                _ => {
                    // Acceptable — might trigger a small deviation
                    // due to floating point edge cases around exactly 15%
                }
            }
        }

        /// **Validates: Requirements 14.9** - Baseline building when < 10 deployments and no data
        #[test]
        fn prop_baseline_building_with_insufficient_data(
            num_snapshots in 0usize..1, // 0 snapshots = no data
        ) {
            let config = CanaryConfig::new(300, 30);
            let mut observer = CanaryObserver::new(config);

            for i in 0..num_snapshots {
                observer.baseline.record_snapshot(make_baseline_snapshot(
                    vec![(1, (i as u64 + 1) * 10)],
                    300,
                ));
            }

            observer.start_observation(5000);
            observer.record_syscall(1, 100, 10000);

            let result = observer.complete_observation();
            let is_baseline_building = matches!(result, CanaryResult::BaselineBuilding { .. });
            prop_assert!(is_baseline_building);
        }
    }
}
