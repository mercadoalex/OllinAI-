//! Anomaly detection against rolling baseline.
//!
//! Computes rolling baselines from the previous 10 executions and detects
//! resource anomalies (>2x CPU or memory vs rolling average) and network
//! anomalies (connections to domains not in baseline). When fewer than 5
//! executions exist, operates in baseline-building mode without generating flags.

use crate::telemetry::{AnomalyFlag, ResourceMetricType};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;

/// Number of previous executions to use for rolling baseline.
const DEFAULT_BASELINE_WINDOW: usize = 10;

/// Minimum executions before anomaly detection is active.
const DEFAULT_MIN_EXECUTIONS: usize = 5;

/// Threshold multiplier for resource anomaly detection (2x).
const RESOURCE_ANOMALY_MULTIPLIER: f64 = 2.0;

/// A single execution's resource snapshot used for baseline computation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionSnapshot {
    /// Average CPU percent during execution
    pub avg_cpu_percent: f64,
    /// Peak memory bytes during execution
    pub peak_memory_bytes: u64,
    /// Set of domains connected to during execution
    pub connected_domains: HashSet<String>,
    /// Execution timestamp (epoch nanoseconds)
    pub timestamp_ns: u64,
}

/// Rolling baseline store — maintains history for anomaly comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineStore {
    /// Historical execution snapshots (most recent last)
    executions: Vec<ExecutionSnapshot>,
    /// Maximum number of executions to retain
    window_size: usize,
    /// Minimum executions before anomaly detection is active
    min_executions: usize,
}

/// Result of a baseline comparison.
#[derive(Debug, Clone)]
pub struct BaselineComparison {
    /// Whether baseline is in building mode (insufficient data)
    pub is_building: bool,
    /// Detected anomaly flags
    pub anomalies: Vec<AnomalyFlag>,
    /// Number of executions in the baseline
    pub baseline_count: usize,
}

impl BaselineStore {
    /// Create a new baseline store with default parameters.
    pub fn new() -> Self {
        Self {
            executions: Vec::new(),
            window_size: DEFAULT_BASELINE_WINDOW,
            min_executions: DEFAULT_MIN_EXECUTIONS,
        }
    }

    /// Create a baseline store with custom parameters.
    pub fn with_params(window_size: usize, min_executions: usize) -> Self {
        Self {
            executions: Vec::new(),
            window_size: window_size.max(1),
            min_executions: min_executions.max(1),
        }
    }

    /// Get the number of recorded executions.
    pub fn execution_count(&self) -> usize {
        self.executions.len()
    }

    /// Whether the baseline is still building (insufficient data).
    pub fn is_building(&self) -> bool {
        self.executions.len() < self.min_executions
    }

    /// Record a completed execution for baseline computation.
    pub fn record_execution(&mut self, snapshot: ExecutionSnapshot) {
        self.executions.push(snapshot);
        // Keep only the most recent window_size entries
        if self.executions.len() > self.window_size {
            let excess = self.executions.len() - self.window_size;
            self.executions.drain(..excess);
        }
    }

    /// Compute the rolling average CPU usage from baseline.
    pub fn avg_cpu(&self) -> Option<f64> {
        if self.executions.is_empty() {
            return None;
        }
        let sum: f64 = self.executions.iter().map(|e| e.avg_cpu_percent).sum();
        Some(sum / self.executions.len() as f64)
    }

    /// Compute the rolling average memory usage from baseline.
    pub fn avg_memory(&self) -> Option<f64> {
        if self.executions.is_empty() {
            return None;
        }
        let sum: f64 = self.executions.iter().map(|e| e.peak_memory_bytes as f64).sum();
        Some(sum / self.executions.len() as f64)
    }

    /// Get the set of all domains seen across baseline executions.
    pub fn baseline_domains(&self) -> HashSet<String> {
        let mut domains = HashSet::new();
        for exec in &self.executions {
            for domain in &exec.connected_domains {
                domains.insert(domain.clone());
            }
        }
        domains
    }

    /// Compare current execution metrics against the baseline.
    ///
    /// Returns anomaly flags for resource and network deviations.
    /// If in baseline-building mode (< min_executions), returns no anomalies.
    pub fn compare(
        &self,
        current_cpu: f64,
        current_memory: u64,
        current_domains: &HashSet<String>,
    ) -> BaselineComparison {
        // Baseline-building mode — no flags generated
        if self.is_building() {
            return BaselineComparison {
                is_building: true,
                anomalies: Vec::new(),
                baseline_count: self.executions.len(),
            };
        }

        let mut anomalies = Vec::new();

        // Check CPU anomaly: >2x rolling average
        if let Some(avg_cpu) = self.avg_cpu() {
            if avg_cpu > 0.0 {
                let ratio = current_cpu / avg_cpu;
                if ratio > RESOURCE_ANOMALY_MULTIPLIER {
                    anomalies.push(AnomalyFlag::ResourceAnomaly {
                        metric: ResourceMetricType::CpuPercent,
                        current_value: current_cpu,
                        baseline_average: avg_cpu,
                        ratio,
                    });
                }
            }
        }

        // Check memory anomaly: >2x rolling average
        if let Some(avg_mem) = self.avg_memory() {
            if avg_mem > 0.0 {
                let ratio = current_memory as f64 / avg_mem;
                if ratio > RESOURCE_ANOMALY_MULTIPLIER {
                    anomalies.push(AnomalyFlag::ResourceAnomaly {
                        metric: ResourceMetricType::MemoryBytes,
                        current_value: current_memory as f64,
                        baseline_average: avg_mem,
                        ratio,
                    });
                }
            }
        }

        // Check network anomaly: domains not in baseline
        let baseline_domains = self.baseline_domains();
        for domain in current_domains {
            if !baseline_domains.contains(domain) {
                anomalies.push(AnomalyFlag::UnknownNetworkDestination {
                    pid: 0, // Will be populated by caller with actual PID
                    domain: domain.clone(),
                    dest_addr: IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED),
                    dest_port: 0,
                    initiating_process: String::new(),
                });
            }
        }

        BaselineComparison {
            is_building: false,
            anomalies,
            baseline_count: self.executions.len(),
        }
    }

    /// Detect resource anomaly for a single metric check.
    ///
    /// Returns true if the current value exceeds 2x the rolling average.
    pub fn is_resource_anomaly(&self, metric: ResourceMetricType, current_value: f64) -> bool {
        if self.is_building() {
            return false;
        }

        let avg = match metric {
            ResourceMetricType::CpuPercent => self.avg_cpu(),
            ResourceMetricType::MemoryBytes => self.avg_memory(),
        };

        match avg {
            Some(avg) if avg > 0.0 => current_value / avg > RESOURCE_ANOMALY_MULTIPLIER,
            _ => false,
        }
    }

    /// Check if a domain is unknown (not in baseline).
    pub fn is_unknown_domain(&self, domain: &str) -> bool {
        if self.is_building() {
            return false;
        }
        let baseline = self.baseline_domains();
        !baseline.contains(domain)
    }
}

impl Default for BaselineStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn make_snapshot(cpu: f64, mem: u64, domains: Vec<&str>) -> ExecutionSnapshot {
        ExecutionSnapshot {
            avg_cpu_percent: cpu,
            peak_memory_bytes: mem,
            connected_domains: domains.into_iter().map(|s| s.to_string()).collect(),
            timestamp_ns: 1000,
        }
    }

    #[test]
    fn test_baseline_building_mode() {
        let mut store = BaselineStore::with_params(10, 5);
        // Add 4 executions (below threshold of 5)
        for i in 0..4 {
            store.record_execution(make_snapshot(10.0, 1000, vec!["example.com"]));
        }

        assert!(store.is_building());
        let result = store.compare(100.0, 100_000, &HashSet::new());
        assert!(result.is_building);
        assert!(result.anomalies.is_empty());
    }

    #[test]
    fn test_baseline_active_after_min_executions() {
        let mut store = BaselineStore::with_params(10, 5);
        for _ in 0..5 {
            store.record_execution(make_snapshot(10.0, 1000, vec!["example.com"]));
        }

        assert!(!store.is_building());
    }

    #[test]
    fn test_cpu_anomaly_detection() {
        let mut store = BaselineStore::with_params(10, 5);
        for _ in 0..5 {
            store.record_execution(make_snapshot(10.0, 1000, vec![]));
        }

        // 2x+ CPU should flag
        let result = store.compare(25.0, 1000, &HashSet::new());
        assert!(!result.is_building);
        assert!(result.anomalies.iter().any(|a| matches!(a, AnomalyFlag::ResourceAnomaly { metric: ResourceMetricType::CpuPercent, .. })));
    }

    #[test]
    fn test_cpu_no_anomaly_below_threshold() {
        let mut store = BaselineStore::with_params(10, 5);
        for _ in 0..5 {
            store.record_execution(make_snapshot(10.0, 1000, vec![]));
        }

        // 1.5x CPU should NOT flag
        let result = store.compare(15.0, 1000, &HashSet::new());
        assert!(result.anomalies.iter().all(|a| !matches!(a, AnomalyFlag::ResourceAnomaly { metric: ResourceMetricType::CpuPercent, .. })));
    }

    #[test]
    fn test_memory_anomaly_detection() {
        let mut store = BaselineStore::with_params(10, 5);
        for _ in 0..5 {
            store.record_execution(make_snapshot(10.0, 1_000_000, vec![]));
        }

        // 3x memory should flag
        let result = store.compare(10.0, 3_000_000, &HashSet::new());
        assert!(result.anomalies.iter().any(|a| matches!(a, AnomalyFlag::ResourceAnomaly { metric: ResourceMetricType::MemoryBytes, .. })));
    }

    #[test]
    fn test_network_anomaly_unknown_domain() {
        let mut store = BaselineStore::with_params(10, 5);
        for _ in 0..5 {
            store.record_execution(make_snapshot(10.0, 1000, vec!["registry.npmjs.org", "github.com"]));
        }

        let mut current_domains = HashSet::new();
        current_domains.insert("evil.com".to_string());
        current_domains.insert("registry.npmjs.org".to_string());

        let result = store.compare(10.0, 1000, &current_domains);
        // evil.com should be flagged, registry.npmjs.org should not
        let unknown_domains: Vec<_> = result.anomalies.iter().filter_map(|a| {
            if let AnomalyFlag::UnknownNetworkDestination { domain, .. } = a {
                Some(domain.as_str())
            } else {
                None
            }
        }).collect();

        assert!(unknown_domains.contains(&"evil.com"));
        assert!(!unknown_domains.contains(&"registry.npmjs.org"));
    }

    #[test]
    fn test_window_size_retention() {
        let mut store = BaselineStore::with_params(3, 2);
        store.record_execution(make_snapshot(10.0, 1000, vec!["a.com"]));
        store.record_execution(make_snapshot(20.0, 2000, vec!["b.com"]));
        store.record_execution(make_snapshot(30.0, 3000, vec!["c.com"]));
        // Adding 4th should drop oldest
        store.record_execution(make_snapshot(40.0, 4000, vec!["d.com"]));

        assert_eq!(store.execution_count(), 3);
        // a.com should no longer be in baseline
        assert!(store.is_unknown_domain("a.com"));
        assert!(!store.is_unknown_domain("d.com"));
    }

    // --- Property-based tests ---

    proptest! {
        /// **Validates: Requirements 13.13** - baseline building mode generates no flags
        #[test]
        fn prop_no_anomalies_in_building_mode(
            num_executions in 0usize..4,
            current_cpu in 0.0f64..1000.0,
            current_memory in 0u64..10_000_000,
        ) {
            let mut store = BaselineStore::with_params(10, 5);
            for _ in 0..num_executions {
                store.record_execution(make_snapshot(10.0, 1000, vec!["x.com"]));
            }

            let mut domains = HashSet::new();
            domains.insert("unknown.evil".to_string());

            let result = store.compare(current_cpu, current_memory, &domains);
            prop_assert!(result.is_building);
            prop_assert!(result.anomalies.is_empty());
        }

        /// **Validates: Requirements 13.8** - resource anomaly detected when >2x average
        #[test]
        fn prop_resource_anomaly_detected_above_2x(
            baseline_cpu in 1.0f64..50.0,
            multiplier in 2.1f64..10.0,
        ) {
            let mut store = BaselineStore::with_params(10, 5);
            for _ in 0..5 {
                store.record_execution(make_snapshot(baseline_cpu, 1000, vec![]));
            }

            let current_cpu = baseline_cpu * multiplier;
            let result = store.compare(current_cpu, 1000, &HashSet::new());
            prop_assert!(!result.is_building);
            let has_cpu_anomaly = result.anomalies.iter().any(|a| {
                matches!(a, AnomalyFlag::ResourceAnomaly { metric: ResourceMetricType::CpuPercent, .. })
            });
            prop_assert!(has_cpu_anomaly);
        }

        /// **Validates: Requirements 13.8** - no anomaly when below 2x
        #[test]
        fn prop_no_resource_anomaly_below_2x(
            baseline_cpu in 1.0f64..50.0,
            multiplier in 0.1f64..1.99,
        ) {
            let mut store = BaselineStore::with_params(10, 5);
            for _ in 0..5 {
                store.record_execution(make_snapshot(baseline_cpu, 1000, vec![]));
            }

            let current_cpu = baseline_cpu * multiplier;
            let result = store.compare(current_cpu, 1000, &HashSet::new());
            let has_cpu_anomaly = result.anomalies.iter().any(|a| {
                matches!(a, AnomalyFlag::ResourceAnomaly { metric: ResourceMetricType::CpuPercent, .. })
            });
            prop_assert!(!has_cpu_anomaly);
        }

        /// **Validates: Requirements 13.3** - unknown domains flagged
        #[test]
        fn prop_unknown_domain_flagged(
            known_domain in "[a-z]{3,8}\\.com",
            unknown_domain in "[a-z]{3,8}\\.evil",
        ) {
            let mut store = BaselineStore::with_params(10, 5);
            for _ in 0..5 {
                store.record_execution(make_snapshot(10.0, 1000, vec![&known_domain]));
            }

            let mut current = HashSet::new();
            current.insert(unknown_domain.clone());

            let result = store.compare(10.0, 1000, &current);
            let flagged: Vec<_> = result.anomalies.iter().filter_map(|a| {
                if let AnomalyFlag::UnknownNetworkDestination { domain, .. } = a {
                    Some(domain.clone())
                } else {
                    None
                }
            }).collect();

            prop_assert!(flagged.contains(&unknown_domain));
        }

        /// **Validates: Requirements 13.3** - known domains not flagged
        #[test]
        fn prop_known_domain_not_flagged(
            domain in "[a-z]{3,8}\\.com",
        ) {
            let mut store = BaselineStore::with_params(10, 5);
            for _ in 0..5 {
                store.record_execution(make_snapshot(10.0, 1000, vec![&domain]));
            }

            let mut current = HashSet::new();
            current.insert(domain.clone());

            let result = store.compare(10.0, 1000, &current);
            let flagged: Vec<_> = result.anomalies.iter().filter_map(|a| {
                if let AnomalyFlag::UnknownNetworkDestination { domain: d, .. } = a {
                    Some(d.clone())
                } else {
                    None
                }
            }).collect();

            prop_assert!(!flagged.contains(&domain));
        }
    }
}
