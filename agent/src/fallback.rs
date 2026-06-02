//! Userspace fallback mode for process tree and network collection.
//!
//! When eBPF probe attachment fails (kernel version too old, missing
//! capabilities, or permissions denied), the agent falls back to
//! userspace collection by scanning /proc for process tree data
//! and /proc/net/tcp for network connections.

use crate::telemetry::TelemetryEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

/// Reason for entering userspace fallback mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FallbackReason {
    /// Kernel version is too old for eBPF
    KernelUnsupported,
    /// Missing required capabilities (CAP_BPF, CAP_PERFMON)
    InsufficientCapabilities,
    /// BPF syscall not available
    BpfSyscallUnavailable,
    /// Probe attachment failed at runtime
    ProbeAttachmentFailed,
    /// Permission denied when loading BPF programs
    PermissionDenied,
}

/// Status report for the fallback mode, sent to Collector API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FallbackStatus {
    /// Why the agent is in fallback mode
    pub reason: FallbackReason,
    /// Human-readable description of the degradation
    pub description: String,
    /// Kernel version detected
    pub kernel_version: String,
    /// Architecture
    pub arch: String,
    /// What capabilities are available in fallback mode
    pub available_capabilities: Vec<String>,
    /// What is NOT available in fallback mode
    pub unavailable_capabilities: Vec<String>,
}

/// Parsed process info from /proc/[pid]/
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcProcessInfo {
    /// Process ID
    pub pid: u32,
    /// Parent process ID
    pub ppid: u32,
    /// Command name
    pub comm: String,
    /// Full command line arguments
    pub cmdline: Vec<String>,
    /// Current working directory
    pub cwd: PathBuf,
}

/// Parsed network connection from /proc/net/tcp
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcNetConnection {
    /// Local address
    pub local_addr: IpAddr,
    /// Local port
    pub local_port: u16,
    /// Remote address
    pub remote_addr: IpAddr,
    /// Remote port
    pub remote_port: u16,
    /// Connection state (TCP state number)
    pub state: u8,
    /// Owning UID
    pub uid: u32,
    /// Inode number (for PID mapping)
    pub inode: u64,
}

/// Userspace fallback collector.
///
/// Provides degraded but functional process tree and network
/// connection monitoring when eBPF probes are unavailable.
#[derive(Debug, Clone)]
pub struct UserspaceCollector {
    /// Reason for being in fallback mode
    pub reason: FallbackReason,
    /// Base path for /proc (configurable for testing)
    proc_path: PathBuf,
    /// Previously seen PIDs for change detection
    known_pids: HashMap<u32, String>,
}

impl UserspaceCollector {
    /// Create a new userspace collector with the given fallback reason.
    pub fn new(reason: FallbackReason) -> Self {
        info!(
            reason = ?reason,
            "Entering userspace fallback mode — eBPF probes unavailable"
        );

        Self {
            reason,
            proc_path: PathBuf::from("/proc"),
            known_pids: HashMap::new(),
        }
    }

    /// Create a collector with a custom /proc path (for testing).
    pub fn with_proc_path(reason: FallbackReason, proc_path: PathBuf) -> Self {
        Self {
            reason,
            proc_path,
            known_pids: HashMap::new(),
        }
    }

    /// Generate the fallback status report for the Collector API.
    pub fn status_report(&self, kernel_version: &str, arch: &str) -> FallbackStatus {
        let description = match &self.reason {
            FallbackReason::KernelUnsupported => {
                format!("Kernel {} does not meet minimum version for eBPF", kernel_version)
            }
            FallbackReason::InsufficientCapabilities => {
                "Process lacks CAP_BPF and CAP_PERFMON capabilities".to_string()
            }
            FallbackReason::BpfSyscallUnavailable => {
                "BPF syscall is not available on this kernel".to_string()
            }
            FallbackReason::ProbeAttachmentFailed => {
                "eBPF probe attachment failed at runtime".to_string()
            }
            FallbackReason::PermissionDenied => {
                "Permission denied when loading BPF programs".to_string()
            }
        };

        FallbackStatus {
            reason: self.reason.clone(),
            description,
            kernel_version: kernel_version.to_string(),
            arch: arch.to_string(),
            available_capabilities: vec![
                "process_tree_scanning".to_string(),
                "network_connection_scanning".to_string(),
                "resource_usage_monitoring".to_string(),
            ],
            unavailable_capabilities: vec![
                "syscall_tracing".to_string(),
                "real_time_file_write_detection".to_string(),
                "real_time_process_exec_detection".to_string(),
                "network_payload_inspection".to_string(),
            ],
        }
    }

    /// Scan /proc for the current process tree.
    ///
    /// Reads /proc/[pid]/stat, /proc/[pid]/cmdline, and /proc/[pid]/cwd
    /// for each process directory found.
    pub fn scan_process_tree(&mut self) -> Vec<ProcProcessInfo> {
        let mut processes = Vec::new();

        let proc_dir = match fs::read_dir(&self.proc_path) {
            Ok(dir) => dir,
            Err(e) => {
                warn!(error = %e, "Failed to read /proc directory");
                return processes;
            }
        };

        for entry in proc_dir.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            // Only look at numeric directories (PIDs)
            if let Ok(pid) = name_str.parse::<u32>() {
                if let Some(info) = self.read_process_info(pid) {
                    processes.push(info);
                }
            }
        }

        // Update known PIDs
        self.known_pids.clear();
        for proc in &processes {
            self.known_pids.insert(proc.pid, proc.comm.clone());
        }

        processes
    }

    /// Read process info from /proc/[pid]/
    fn read_process_info(&self, pid: u32) -> Option<ProcProcessInfo> {
        let pid_dir = self.proc_path.join(pid.to_string());

        // Read comm
        let comm = fs::read_to_string(pid_dir.join("comm"))
            .ok()?
            .trim()
            .to_string();

        // Read stat for ppid (field 4 in /proc/[pid]/stat)
        let stat = fs::read_to_string(pid_dir.join("stat")).ok()?;
        let ppid = parse_ppid_from_stat(&stat)?;

        // Read cmdline
        let cmdline_raw = fs::read_to_string(pid_dir.join("cmdline")).unwrap_or_default();
        let cmdline: Vec<String> = cmdline_raw
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        // Read cwd (symlink)
        let cwd = fs::read_link(pid_dir.join("cwd")).unwrap_or_else(|_| PathBuf::from("/"));

        Some(ProcProcessInfo {
            pid,
            ppid,
            comm,
            cmdline,
            cwd,
        })
    }

    /// Scan /proc/net/tcp for active network connections.
    pub fn scan_network_connections(&self) -> Vec<ProcNetConnection> {
        let tcp_path = self.proc_path.join("net/tcp");
        let mut connections = Vec::new();

        let content = match fs::read_to_string(&tcp_path) {
            Ok(c) => c,
            Err(e) => {
                debug!(error = %e, "Failed to read /proc/net/tcp");
                return connections;
            }
        };

        // Skip header line
        for line in content.lines().skip(1) {
            if let Some(conn) = parse_tcp_line(line) {
                connections.push(conn);
            }
        }

        connections
    }

    /// Convert scanned processes to TelemetryEvents.
    pub fn processes_to_events(&self, processes: &[ProcProcessInfo], timestamp_ns: u64) -> Vec<TelemetryEvent> {
        processes
            .iter()
            .map(|p| TelemetryEvent::ProcessTree {
                pid: p.pid,
                ppid: p.ppid,
                comm: p.comm.clone(),
                argv: p.cmdline.clone(),
                cwd: p.cwd.clone(),
                timestamp_ns,
            })
            .collect()
    }

    /// Convert scanned connections to TelemetryEvents.
    ///
    /// Only includes established connections (state = 1) to remote hosts.
    pub fn connections_to_events(&self, connections: &[ProcNetConnection], timestamp_ns: u64) -> Vec<TelemetryEvent> {
        connections
            .iter()
            .filter(|c| c.state == 1) // ESTABLISHED
            .filter(|c| !is_loopback(&c.remote_addr))
            .map(|c| TelemetryEvent::NetworkConnect {
                pid: 0, // PID mapping requires additional /proc/[pid]/fd scanning
                dest_addr: c.remote_addr,
                dest_port: c.remote_port,
                domain: None,
                timestamp_ns,
            })
            .collect()
    }
}

/// Parse PPID from /proc/[pid]/stat content.
///
/// Format: "pid (comm) state ppid ..."
/// The comm field can contain spaces and parentheses, so we find the last ')'.
fn parse_ppid_from_stat(stat: &str) -> Option<u32> {
    // Find the last closing paren to handle comm with spaces/parens
    let after_comm = stat.rfind(')')? + 1;
    let fields: Vec<&str> = stat[after_comm..].split_whitespace().collect();
    // After (comm), fields are: state, ppid, pgrp, ...
    // So ppid is at index 1 (0-indexed after the closing paren)
    fields.get(1)?.parse().ok()
}

/// Parse a line from /proc/net/tcp.
///
/// Format: "sl local_address rem_address st ..."
/// Addresses are in hex format: XXXXXXXX:YYYY
fn parse_tcp_line(line: &str) -> Option<ProcNetConnection> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() < 10 {
        return None;
    }

    let local = parse_hex_address(fields.get(1)?)?;
    let remote = parse_hex_address(fields.get(2)?)?;
    let state = u8::from_str_radix(fields.get(3)?, 16).ok()?;
    let uid = fields.get(7)?.parse().ok()?;
    let inode = fields.get(9)?.parse().ok()?;

    Some(ProcNetConnection {
        local_addr: local.0,
        local_port: local.1,
        remote_addr: remote.0,
        remote_port: remote.1,
        state,
        uid,
        inode,
    })
}

/// Parse hex address from /proc/net/tcp format (e.g., "0100007F:0050").
fn parse_hex_address(s: &str) -> Option<(IpAddr, u16)> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return None;
    }

    let addr_hex = parts[0];
    let port_hex = parts[1];

    let addr_u32 = u32::from_str_radix(addr_hex, 16).ok()?;
    let port = u16::from_str_radix(port_hex, 16).ok()?;

    // /proc/net/tcp uses little-endian format for addresses
    let addr = IpAddr::V4(Ipv4Addr::from(addr_u32.to_be()));

    Some((addr, port))
}

/// Check if an IP address is loopback.
fn is_loopback(addr: &IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_parse_ppid_from_stat() {
        // Standard format
        let stat = "1234 (bash) S 1000 1234 1234 0 -1 ...";
        assert_eq!(parse_ppid_from_stat(stat), Some(1000));

        // Comm with spaces
        let stat = "5678 (my process) R 42 5678 5678 0 -1 ...";
        assert_eq!(parse_ppid_from_stat(stat), Some(42));

        // Comm with parentheses
        let stat = "9999 (proc (special)) S 100 9999 9999 0 -1 ...";
        assert_eq!(parse_ppid_from_stat(stat), Some(100));
    }

    #[test]
    fn test_parse_hex_address() {
        // 127.0.0.1:80 in /proc/net/tcp format (little-endian)
        let result = parse_hex_address("0100007F:0050");
        assert!(result.is_some());
        let (addr, port) = result.unwrap();
        assert_eq!(port, 80);
        assert_eq!(addr, IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
    }

    #[test]
    fn test_parse_tcp_line() {
        let line = "   0: 0100007F:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 ...";
        let conn = parse_tcp_line(line);
        assert!(conn.is_some());
        let conn = conn.unwrap();
        assert_eq!(conn.local_port, 80);
        assert_eq!(conn.state, 0x0A); // LISTEN
        assert_eq!(conn.uid, 1000);
        assert_eq!(conn.inode, 12345);
    }

    #[test]
    fn test_fallback_status_report() {
        let collector = UserspaceCollector::new(FallbackReason::KernelUnsupported);
        let status = collector.status_report("4.18.0", "x86_64");

        assert_eq!(status.reason, FallbackReason::KernelUnsupported);
        assert!(status.description.contains("4.18.0"));
        assert!(status.available_capabilities.contains(&"process_tree_scanning".to_string()));
        assert!(status.unavailable_capabilities.contains(&"syscall_tracing".to_string()));
    }

    #[test]
    fn test_fallback_status_all_reasons() {
        let reasons = vec![
            FallbackReason::KernelUnsupported,
            FallbackReason::InsufficientCapabilities,
            FallbackReason::BpfSyscallUnavailable,
            FallbackReason::ProbeAttachmentFailed,
            FallbackReason::PermissionDenied,
        ];

        for reason in reasons {
            let collector = UserspaceCollector::new(reason.clone());
            let status = collector.status_report("5.10.0", "x86_64");
            assert_eq!(status.reason, reason);
            assert!(!status.description.is_empty());
        }
    }

    #[test]
    fn test_is_loopback() {
        assert!(is_loopback(&IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(!is_loopback(&IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
    }

    #[test]
    fn test_connections_to_events_filters_loopback() {
        let collector = UserspaceCollector::new(FallbackReason::ProbeAttachmentFailed);
        let connections = vec![
            ProcNetConnection {
                local_addr: IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
                local_port: 8080,
                remote_addr: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
                remote_port: 443,
                state: 1,
                uid: 1000,
                inode: 100,
            },
            ProcNetConnection {
                local_addr: IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
                local_port: 8080,
                remote_addr: IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
                remote_port: 443,
                state: 1,
                uid: 1000,
                inode: 200,
            },
        ];

        let events = collector.connections_to_events(&connections, 1000);
        // Only non-loopback established connection should be included
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn test_connections_to_events_filters_non_established() {
        let collector = UserspaceCollector::new(FallbackReason::ProbeAttachmentFailed);
        let connections = vec![
            ProcNetConnection {
                local_addr: IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
                local_port: 80,
                remote_addr: IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
                remote_port: 443,
                state: 0x0A, // LISTEN
                uid: 1000,
                inode: 100,
            },
        ];

        let events = collector.connections_to_events(&connections, 1000);
        assert_eq!(events.len(), 0);
    }

    // --- Property-based tests ---

    proptest! {
        /// **Validates: Requirements 13.12** - fallback status always reports degraded capabilities
        #[test]
        fn prop_fallback_always_reports_degraded(
            reason in prop_oneof![
                Just(FallbackReason::KernelUnsupported),
                Just(FallbackReason::InsufficientCapabilities),
                Just(FallbackReason::BpfSyscallUnavailable),
                Just(FallbackReason::ProbeAttachmentFailed),
                Just(FallbackReason::PermissionDenied),
            ],
            kernel_version in "[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,3}",
            arch in prop_oneof![Just("x86_64"), Just("aarch64")],
        ) {
            let collector = UserspaceCollector::new(reason.clone());
            let status = collector.status_report(&kernel_version, arch);

            prop_assert_eq!(&status.reason, &reason);
            prop_assert!(!status.available_capabilities.is_empty());
            prop_assert!(!status.unavailable_capabilities.is_empty());
            prop_assert!(status.available_capabilities.contains(&"process_tree_scanning".to_string()));
            prop_assert!(status.unavailable_capabilities.contains(&"syscall_tracing".to_string()));
        }

        /// **Validates: Requirements 13.12** - process events always have valid structure
        #[test]
        fn prop_process_events_have_valid_pids(
            pid in 1u32..65535,
            ppid in 0u32..65535,
        ) {
            let collector = UserspaceCollector::new(FallbackReason::ProbeAttachmentFailed);
            let procs = vec![ProcProcessInfo {
                pid,
                ppid,
                comm: "test".to_string(),
                cmdline: vec!["test".to_string()],
                cwd: PathBuf::from("/"),
            }];

            let events = collector.processes_to_events(&procs, 1000);
            prop_assert_eq!(events.len(), 1);
            match &events[0] {
                TelemetryEvent::ProcessTree { pid: p, ppid: pp, .. } => {
                    prop_assert_eq!(*p, pid);
                    prop_assert_eq!(*pp, ppid);
                }
                _ => prop_assert!(false, "Expected ProcessTree event"),
            }
        }

        /// **Validates: Requirements 13.12** - only established non-loopback connections emitted
        #[test]
        fn prop_only_established_non_loopback_connections(
            remote_octets in (1u8..126, 0u8..255, 0u8..255, 1u8..255),
            port in 1u16..65535,
            state in 0u8..15,
        ) {
            let collector = UserspaceCollector::new(FallbackReason::ProbeAttachmentFailed);
            let remote_addr = IpAddr::V4(Ipv4Addr::new(
                remote_octets.0, remote_octets.1, remote_octets.2, remote_octets.3
            ));
            let conn = ProcNetConnection {
                local_addr: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
                local_port: 0,
                remote_addr,
                remote_port: port,
                state,
                uid: 0,
                inode: 0,
            };

            let events = collector.connections_to_events(&[conn], 1000);

            if state == 1 && !remote_addr.is_loopback() {
                prop_assert_eq!(events.len(), 1);
            } else {
                prop_assert_eq!(events.len(), 0);
            }
        }
    }
}
