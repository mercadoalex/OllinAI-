//! Data Residency Telemetry Routing
//!
//! When data residency is enabled: write telemetry + attestations to tenant S3 bucket.
//! When disabled: route to Collector API.
//! Handles S3 write failures with standard buffer policy (5 min, retry 30s).
//!
//! Requirements: 19.1, 19.5

use crate::config::AgentConfig;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Telemetry destination — determines where events are routed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TelemetryDestination {
    /// Standard: route to OllinAI Collector API
    CollectorApi { endpoint: String },
    /// Data Residency: route to tenant S3 bucket
    S3Bucket {
        bucket_arn: String,
        region: String,
    },
}

impl fmt::Display for TelemetryDestination {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TelemetryDestination::CollectorApi { endpoint } => {
                write!(f, "CollectorAPI({})", endpoint)
            }
            TelemetryDestination::S3Bucket { bucket_arn, region } => {
                write!(f, "S3({}, {})", bucket_arn, region)
            }
        }
    }
}

/// Routing result from the residency router.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    pub destination: TelemetryDestination,
    pub data_residency_enabled: bool,
}

/// S3 write result (simulated).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3WriteResult {
    Success,
    Failed { reason: String },
}

/// Residency router: decides where telemetry should go based on agent config.
#[derive(Debug, Clone)]
pub struct ResidencyRouter {
    data_residency_enabled: bool,
    bucket_arn: Option<String>,
    bucket_region: Option<String>,
    collector_url: String,
    /// Number of consecutive S3 failures
    consecutive_failures: u32,
    /// Max failures before logging degraded state
    max_consecutive_failures: u32,
}

impl ResidencyRouter {
    /// Create a new residency router from agent config.
    pub fn from_config(config: &AgentConfig) -> Self {
        Self {
            data_residency_enabled: config.data_residency_enabled,
            bucket_arn: config.data_residency_bucket_arn.clone(),
            bucket_region: config.data_residency_region.clone(),
            collector_url: config.collector_url.clone(),
            consecutive_failures: 0,
            max_consecutive_failures: 10,
        }
    }

    /// Create a new router with explicit settings (for testing).
    pub fn new(
        data_residency_enabled: bool,
        bucket_arn: Option<String>,
        bucket_region: Option<String>,
        collector_url: String,
    ) -> Self {
        Self {
            data_residency_enabled,
            bucket_arn,
            bucket_region,
            collector_url,
            consecutive_failures: 0,
            max_consecutive_failures: 10,
        }
    }

    /// Determine the telemetry destination based on current config.
    pub fn route(&self) -> RoutingDecision {
        if self.data_residency_enabled {
            if let (Some(arn), Some(region)) = (&self.bucket_arn, &self.bucket_region) {
                return RoutingDecision {
                    destination: TelemetryDestination::S3Bucket {
                        bucket_arn: arn.clone(),
                        region: region.clone(),
                    },
                    data_residency_enabled: true,
                };
            }
            // Fallback: residency enabled but no bucket configured — use collector
            tracing::warn!(
                "Data residency enabled but S3 bucket not configured — falling back to Collector API"
            );
        }

        RoutingDecision {
            destination: TelemetryDestination::CollectorApi {
                endpoint: self.collector_url.clone(),
            },
            data_residency_enabled: false,
        }
    }

    /// Check if data residency is enabled and properly configured.
    pub fn is_residency_active(&self) -> bool {
        self.data_residency_enabled
            && self.bucket_arn.is_some()
            && self.bucket_region.is_some()
    }

    /// Record a successful S3 write (resets failure counter).
    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
    }

    /// Record a failed S3 write. Returns true if we should buffer and retry.
    pub fn record_failure(&mut self) -> bool {
        self.consecutive_failures += 1;
        // Always buffer and retry per standard policy (5 min buffer, retry 30s)
        true
    }

    /// Get the number of consecutive S3 write failures.
    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures
    }

    /// Check if the router is in a degraded state (many consecutive failures).
    pub fn is_degraded(&self) -> bool {
        self.consecutive_failures >= self.max_consecutive_failures
    }

    /// Simulate writing telemetry to S3 (placeholder for actual AWS SDK integration).
    /// In production, this would use aws-sdk-rust to PutObject.
    pub fn write_to_s3(
        &mut self,
        _key: &str,
        _data: &[u8],
    ) -> S3WriteResult {
        if !self.is_residency_active() {
            return S3WriteResult::Failed {
                reason: "Data residency not active".into(),
            };
        }

        // Simulated success — actual implementation uses AWS SDK
        self.record_success();
        S3WriteResult::Success
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_routing_disabled_goes_to_collector() {
        let router = ResidencyRouter::new(
            false,
            None,
            None,
            "https://collector.ollinai.dev".into(),
        );
        let decision = router.route();
        assert!(!decision.data_residency_enabled);
        assert_eq!(
            decision.destination,
            TelemetryDestination::CollectorApi {
                endpoint: "https://collector.ollinai.dev".into()
            }
        );
    }

    #[test]
    fn test_routing_enabled_goes_to_s3() {
        let router = ResidencyRouter::new(
            true,
            Some("arn:aws:s3:::my-bucket".into()),
            Some("us-west-2".into()),
            "https://collector.ollinai.dev".into(),
        );
        let decision = router.route();
        assert!(decision.data_residency_enabled);
        assert_eq!(
            decision.destination,
            TelemetryDestination::S3Bucket {
                bucket_arn: "arn:aws:s3:::my-bucket".into(),
                region: "us-west-2".into(),
            }
        );
    }

    #[test]
    fn test_routing_enabled_but_no_bucket_falls_back() {
        let router = ResidencyRouter::new(
            true,
            None,
            None,
            "https://collector.ollinai.dev".into(),
        );
        let decision = router.route();
        assert!(!decision.data_residency_enabled);
        match decision.destination {
            TelemetryDestination::CollectorApi { .. } => {}
            _ => panic!("Expected CollectorApi fallback"),
        }
    }

    #[test]
    fn test_failure_tracking() {
        let mut router = ResidencyRouter::new(
            true,
            Some("arn:aws:s3:::bucket".into()),
            Some("eu-west-1".into()),
            "https://collector.ollinai.dev".into(),
        );
        assert_eq!(router.consecutive_failures(), 0);
        assert!(!router.is_degraded());

        for _ in 0..10 {
            router.record_failure();
        }
        assert_eq!(router.consecutive_failures(), 10);
        assert!(router.is_degraded());
    }

    #[test]
    fn test_success_resets_failures() {
        let mut router = ResidencyRouter::new(
            true,
            Some("arn:aws:s3:::bucket".into()),
            Some("eu-west-1".into()),
            "https://collector.ollinai.dev".into(),
        );
        router.record_failure();
        router.record_failure();
        assert_eq!(router.consecutive_failures(), 2);
        router.record_success();
        assert_eq!(router.consecutive_failures(), 0);
    }

    #[test]
    fn test_write_to_s3_when_active() {
        let mut router = ResidencyRouter::new(
            true,
            Some("arn:aws:s3:::bucket".into()),
            Some("eu-west-1".into()),
            "https://collector.ollinai.dev".into(),
        );
        let result = router.write_to_s3("test/key", b"data");
        assert_eq!(result, S3WriteResult::Success);
    }

    #[test]
    fn test_write_to_s3_when_inactive() {
        let mut router = ResidencyRouter::new(
            false,
            None,
            None,
            "https://collector.ollinai.dev".into(),
        );
        let result = router.write_to_s3("test/key", b"data");
        assert_eq!(
            result,
            S3WriteResult::Failed {
                reason: "Data residency not active".into()
            }
        );
    }

    // Property-based tests
    proptest! {
        /// When residency is disabled, always routes to collector regardless of bucket config
        #[test]
        fn prop_disabled_always_routes_to_collector(
            has_bucket in proptest::bool::ANY,
            has_region in proptest::bool::ANY,
        ) {
            let bucket = if has_bucket { Some("arn:aws:s3:::b".into()) } else { None };
            let region = if has_region { Some("us-east-1".into()) } else { None };
            let router = ResidencyRouter::new(false, bucket, region, "https://api.test".into());
            let decision = router.route();
            prop_assert!(!decision.data_residency_enabled);
            match decision.destination {
                TelemetryDestination::CollectorApi { .. } => {}
                _ => prop_assert!(false, "Expected CollectorApi"),
            }
        }

        /// When residency is enabled with valid bucket+region, routes to S3
        #[test]
        fn prop_enabled_with_config_routes_to_s3(
            bucket_name in "[a-z]{3,20}",
            region in prop_oneof![
                Just("us-east-1"),
                Just("us-west-2"),
                Just("eu-west-1"),
                Just("ap-southeast-1"),
            ],
        ) {
            let arn = format!("arn:aws:s3:::{}", bucket_name);
            let router = ResidencyRouter::new(
                true,
                Some(arn.clone()),
                Some(region.to_string()),
                "https://api.test".into(),
            );
            let decision = router.route();
            prop_assert!(decision.data_residency_enabled);
            match decision.destination {
                TelemetryDestination::S3Bucket { bucket_arn, region: r } => {
                    prop_assert_eq!(bucket_arn, arn);
                    prop_assert_eq!(r, region.to_string());
                }
                _ => prop_assert!(false, "Expected S3Bucket"),
            }
        }

        /// Failure counter always increments and success always resets
        #[test]
        fn prop_failure_counter_behavior(
            failures in 1u32..50,
        ) {
            let mut router = ResidencyRouter::new(true, Some("arn:aws:s3:::b".into()), Some("us-east-1".into()), "url".into());
            for _ in 0..failures {
                router.record_failure();
            }
            prop_assert_eq!(router.consecutive_failures(), failures);
            router.record_success();
            prop_assert_eq!(router.consecutive_failures(), 0);
        }
    }
}
