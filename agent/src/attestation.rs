//! Build Attestation generation.
//!
//! At pipeline completion, serializes the complete process tree, network
//! connections, and file writes into an in-toto-compatible attestation document.
//! Includes a SHA-256 digest of the complete telemetry stream for tamper detection.
//!
//! Requirements: 13.6

use crate::ancestry::ProcessAncestry;
use crate::telemetry::TelemetryEvent;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::path::PathBuf;

/// A record of an outbound network connection observed during the pipeline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NetworkConnectionRecord {
    /// Process that initiated the connection
    pub pid: u32,
    /// Destination IP address
    pub dest_addr: IpAddr,
    /// Destination port
    pub dest_port: u16,
    /// Resolved domain name (if available)
    pub domain: Option<String>,
    /// Timestamp of the connection (nanoseconds)
    pub timestamp_ns: u64,
}

/// A record of a write to a sensitive file path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileWriteRecord {
    /// Process that performed the write
    pub pid: u32,
    /// File path written to
    pub path: PathBuf,
    /// Bytes written
    pub bytes_written: u64,
    /// Timestamp of the write (nanoseconds)
    pub timestamp_ns: u64,
}

/// In-toto compatible Build Attestation document.
///
/// Generated at pipeline completion, containing complete execution lineage,
/// network activity, sensitive file writes, and a telemetry digest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildAttestation {
    /// In-toto attestation type identifier
    #[serde(rename = "_type")]
    pub attestation_type: String,

    /// Attestation predicate type (in-toto spec)
    pub predicate_type: String,

    /// Pipeline identifier
    pub pipeline_id: String,

    /// Tenant identifier
    pub tenant_id: String,

    /// Service identifier
    pub service_id: String,

    /// Complete process ancestry tree
    pub process_ancestry: ProcessAncestry,

    /// All outbound network connections observed
    pub network_connections: Vec<NetworkConnectionRecord>,

    /// All writes to sensitive file paths
    pub sensitive_file_writes: Vec<FileWriteRecord>,

    /// SHA-256 digest of the complete telemetry stream (hex-encoded)
    pub telemetry_digest: String,

    /// Generation timestamp (Unix epoch nanoseconds)
    pub generated_at_ns: u64,

    /// Agent version that generated this attestation
    pub agent_version: String,
}

/// Builder for constructing a BuildAttestation incrementally during pipeline execution.
#[derive(Debug, Clone)]
pub struct AttestationBuilder {
    pipeline_id: String,
    tenant_id: String,
    service_id: String,
    network_connections: Vec<NetworkConnectionRecord>,
    sensitive_file_writes: Vec<FileWriteRecord>,
    /// Running SHA-256 hasher for the telemetry stream
    telemetry_hasher: Vec<u8>,
    /// Count of telemetry events processed
    event_count: u64,
}

/// Paths considered sensitive for file write tracking.
const SENSITIVE_PATH_PREFIXES: &[&str] = &[
    "/etc/",
    "/root/",
    "/home/",
    "/var/run/",
    "/tmp/",
];

/// Specific sensitive file patterns.
const SENSITIVE_FILE_PATTERNS: &[&str] = &[
    ".aws/credentials",
    ".docker/config.json",
    ".ssh/",
    ".npmrc",
    ".pypirc",
    ".cargo/credentials",
    "id_rsa",
    "id_ed25519",
    ".env",
    "GITHUB_TOKEN",
];

impl AttestationBuilder {
    /// Create a new attestation builder for a pipeline execution.
    pub fn new(pipeline_id: String, tenant_id: String, service_id: String) -> Self {
        Self {
            pipeline_id,
            tenant_id,
            service_id,
            network_connections: Vec::new(),
            sensitive_file_writes: Vec::new(),
            telemetry_hasher: Vec::new(),
            event_count: 0,
        }
    }

    /// Process a telemetry event, extracting relevant data and updating the digest.
    pub fn process_event(&mut self, event: &TelemetryEvent) {
        // Update the running digest with the serialized event
        let event_bytes = serde_json::to_vec(event).unwrap_or_default();
        self.telemetry_hasher.extend_from_slice(&event_bytes);
        self.event_count += 1;

        match event {
            TelemetryEvent::NetworkConnect {
                pid,
                dest_addr,
                dest_port,
                domain,
                timestamp_ns,
            } => {
                self.network_connections.push(NetworkConnectionRecord {
                    pid: *pid,
                    dest_addr: *dest_addr,
                    dest_port: *dest_port,
                    domain: domain.clone(),
                    timestamp_ns: *timestamp_ns,
                });
            }
            TelemetryEvent::FileWrite {
                pid,
                path,
                bytes_written,
                timestamp_ns,
            } => {
                if is_sensitive_path(path) {
                    self.sensitive_file_writes.push(FileWriteRecord {
                        pid: *pid,
                        path: path.clone(),
                        bytes_written: *bytes_written,
                        timestamp_ns: *timestamp_ns,
                    });
                }
            }
            _ => {}
        }
    }

    /// Get the current count of processed events.
    pub fn event_count(&self) -> u64 {
        self.event_count
    }

    /// Get the current count of network connections recorded.
    pub fn network_connection_count(&self) -> usize {
        self.network_connections.len()
    }

    /// Get the current count of sensitive file writes recorded.
    pub fn sensitive_file_write_count(&self) -> usize {
        self.sensitive_file_writes.len()
    }

    /// Compute the SHA-256 digest of all processed telemetry events.
    pub fn compute_telemetry_digest(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(&self.telemetry_hasher);
        let result = hasher.finalize();
        hex::encode(result)
    }

    /// Finalize the attestation document at pipeline completion.
    ///
    /// Consumes the builder and produces a complete BuildAttestation.
    pub fn finalize(self, process_ancestry: ProcessAncestry, agent_version: &str) -> BuildAttestation {
        let mut hasher = Sha256::new();
        hasher.update(&self.telemetry_hasher);
        let digest = hasher.finalize();
        let telemetry_digest = hex::encode(digest);

        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        BuildAttestation {
            attestation_type: "https://in-toto.io/Statement/v1".to_string(),
            predicate_type: "https://ollinai.dev/attestation/build/v1".to_string(),
            pipeline_id: self.pipeline_id,
            tenant_id: self.tenant_id,
            service_id: self.service_id,
            process_ancestry,
            network_connections: self.network_connections,
            sensitive_file_writes: self.sensitive_file_writes,
            telemetry_digest,
            generated_at_ns: now_ns,
            agent_version: agent_version.to_string(),
        }
    }
}

/// Check if a file path is considered sensitive.
pub fn is_sensitive_path(path: &PathBuf) -> bool {
    let path_str = path.to_string_lossy();

    // Check specific sensitive file patterns
    for pattern in SENSITIVE_FILE_PATTERNS {
        if path_str.contains(pattern) {
            return true;
        }
    }

    // Check sensitive path prefixes (only flag certain subdirectories)
    for prefix in SENSITIVE_PATH_PREFIXES {
        if path_str.starts_with(prefix) {
            return true;
        }
    }

    false
}

/// Hex encoding utility (avoids adding hex crate dependency).
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ancestry::ProcessAncestry;
    use crate::telemetry::TelemetryEvent;
    use proptest::prelude::*;
    use std::net::{IpAddr, Ipv4Addr};
    use std::path::PathBuf;

    fn make_network_event(pid: u32, port: u16) -> TelemetryEvent {
        TelemetryEvent::NetworkConnect {
            pid,
            dest_addr: IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            dest_port: port,
            domain: Some("example.com".to_string()),
            timestamp_ns: 1000,
        }
    }

    fn make_sensitive_file_write(pid: u32, path: &str) -> TelemetryEvent {
        TelemetryEvent::FileWrite {
            pid,
            path: PathBuf::from(path),
            bytes_written: 100,
            timestamp_ns: 2000,
        }
    }

    fn make_non_sensitive_file_write(pid: u32) -> TelemetryEvent {
        TelemetryEvent::FileWrite {
            pid,
            path: PathBuf::from("/usr/lib/somelib.so"),
            bytes_written: 50,
            timestamp_ns: 3000,
        }
    }

    fn make_process_event(pid: u32) -> TelemetryEvent {
        TelemetryEvent::ProcessTree {
            pid,
            ppid: 1,
            comm: "test".to_string(),
            argv: vec!["--flag".to_string()],
            cwd: PathBuf::from("/app"),
            timestamp_ns: 500,
        }
    }

    #[test]
    fn test_attestation_builder_basic() {
        let mut builder = AttestationBuilder::new(
            "pipeline-1".to_string(),
            "tenant-1".to_string(),
            "svc-1".to_string(),
        );

        builder.process_event(&make_process_event(1));
        builder.process_event(&make_network_event(2, 443));
        builder.process_event(&make_sensitive_file_write(3, "/home/user/.aws/credentials"));

        assert_eq!(builder.event_count(), 3);
        assert_eq!(builder.network_connection_count(), 1);
        assert_eq!(builder.sensitive_file_write_count(), 1);
    }

    #[test]
    fn test_attestation_finalize() {
        let mut builder = AttestationBuilder::new(
            "pipeline-1".to_string(),
            "tenant-1".to_string(),
            "svc-1".to_string(),
        );

        builder.process_event(&make_process_event(1));
        builder.process_event(&make_network_event(2, 443));
        builder.process_event(&make_sensitive_file_write(3, "/home/user/.ssh/id_rsa"));

        let ancestry = ProcessAncestry::new(1);
        let attestation = builder.finalize(ancestry, "0.1.0");

        assert_eq!(attestation.attestation_type, "https://in-toto.io/Statement/v1");
        assert_eq!(attestation.pipeline_id, "pipeline-1");
        assert_eq!(attestation.tenant_id, "tenant-1");
        assert_eq!(attestation.service_id, "svc-1");
        assert_eq!(attestation.network_connections.len(), 1);
        assert_eq!(attestation.sensitive_file_writes.len(), 1);
        assert!(!attestation.telemetry_digest.is_empty());
        assert_eq!(attestation.telemetry_digest.len(), 64); // SHA-256 hex = 64 chars
        assert_eq!(attestation.agent_version, "0.1.0");
    }

    #[test]
    fn test_non_sensitive_file_not_recorded() {
        let mut builder = AttestationBuilder::new(
            "p".to_string(),
            "t".to_string(),
            "s".to_string(),
        );

        builder.process_event(&make_non_sensitive_file_write(1));
        assert_eq!(builder.sensitive_file_write_count(), 0);
    }

    #[test]
    fn test_sensitive_path_detection() {
        assert!(is_sensitive_path(&PathBuf::from("/home/user/.aws/credentials")));
        assert!(is_sensitive_path(&PathBuf::from("/root/.docker/config.json")));
        assert!(is_sensitive_path(&PathBuf::from("/home/runner/.ssh/id_rsa")));
        assert!(is_sensitive_path(&PathBuf::from("/tmp/secrets")));
        assert!(is_sensitive_path(&PathBuf::from("/etc/shadow")));
        assert!(is_sensitive_path(&PathBuf::from("/app/.env")));
        assert!(!is_sensitive_path(&PathBuf::from("/usr/lib/somelib.so")));
        assert!(!is_sensitive_path(&PathBuf::from("/opt/app/main.js")));
    }

    #[test]
    fn test_telemetry_digest_deterministic() {
        let events = vec![
            make_process_event(1),
            make_network_event(2, 80),
        ];

        let mut builder1 = AttestationBuilder::new("p".into(), "t".into(), "s".into());
        let mut builder2 = AttestationBuilder::new("p".into(), "t".into(), "s".into());

        for event in &events {
            builder1.process_event(event);
            builder2.process_event(event);
        }

        assert_eq!(builder1.compute_telemetry_digest(), builder2.compute_telemetry_digest());
    }

    #[test]
    fn test_telemetry_digest_changes_with_different_events() {
        let mut builder1 = AttestationBuilder::new("p".into(), "t".into(), "s".into());
        let mut builder2 = AttestationBuilder::new("p".into(), "t".into(), "s".into());

        builder1.process_event(&make_process_event(1));
        builder2.process_event(&make_process_event(2)); // Different PID

        assert_ne!(builder1.compute_telemetry_digest(), builder2.compute_telemetry_digest());
    }

    // --- Property-based tests ---

    proptest! {
        /// **Validates: Requirements 13.6** - All network connections are captured in attestation
        #[test]
        fn prop_all_network_connections_captured(
            num_connections in 0usize..50,
        ) {
            let mut builder = AttestationBuilder::new("p".into(), "t".into(), "s".into());

            for i in 0..num_connections {
                builder.process_event(&make_network_event(i as u32, (443 + i) as u16));
            }

            prop_assert_eq!(builder.network_connection_count(), num_connections);
        }

        /// **Validates: Requirements 13.6** - Telemetry digest is always 64 hex chars (SHA-256)
        #[test]
        fn prop_telemetry_digest_is_valid_sha256(
            num_events in 1usize..100,
        ) {
            let mut builder = AttestationBuilder::new("p".into(), "t".into(), "s".into());
            for i in 0..num_events {
                builder.process_event(&make_process_event(i as u32));
            }

            let digest = builder.compute_telemetry_digest();
            prop_assert_eq!(digest.len(), 64);
            prop_assert!(digest.chars().all(|c| c.is_ascii_hexdigit()));
        }

        /// **Validates: Requirements 13.6** - Event count matches number of processed events
        #[test]
        fn prop_event_count_matches_processed(
            num_process in 0usize..20,
            num_network in 0usize..20,
            num_file in 0usize..20,
        ) {
            let mut builder = AttestationBuilder::new("p".into(), "t".into(), "s".into());
            let total = num_process + num_network + num_file;

            for i in 0..num_process {
                builder.process_event(&make_process_event(i as u32));
            }
            for i in 0..num_network {
                builder.process_event(&make_network_event(i as u32, 80));
            }
            for i in 0..num_file {
                builder.process_event(&make_non_sensitive_file_write(i as u32));
            }

            prop_assert_eq!(builder.event_count(), total as u64);
        }

        /// **Validates: Requirements 13.6** - Digest is deterministic for same event sequence
        #[test]
        fn prop_digest_deterministic(
            num_events in 1usize..50,
        ) {
            let mut builder1 = AttestationBuilder::new("p".into(), "t".into(), "s".into());
            let mut builder2 = AttestationBuilder::new("p".into(), "t".into(), "s".into());

            for i in 0..num_events {
                let event = make_process_event(i as u32);
                builder1.process_event(&event);
                builder2.process_event(&event);
            }

            prop_assert_eq!(
                builder1.compute_telemetry_digest(),
                builder2.compute_telemetry_digest()
            );
        }
    }
}
