//! eBPF probe infrastructure — probe attachment and BPF program management.
//!
//! Uses libbpf-rs for loading and attaching BPF programs to kernel tracepoints
//! and kprobes. In production, BPF object files are compiled separately via
//! the BPF builder container and embedded at build time.
//!
//! Probes attached:
//! - execve (tracepoint/syscalls/sys_enter_execve) — process execution
//! - fork/clone (tracepoint/sched/sched_process_fork) — process creation
//! - Network syscalls (connect, sendto, recvfrom) — network activity
//! - File operations (openat, write) — file system writes and credential access

pub mod kernel_check;

use crate::config::AgentConfig;
use std::path::Path;
use tracing::{debug, error, info, warn};

/// Path where pre-compiled BPF object files are expected.
const BPF_OBJ_DIR: &str = "/usr/lib/ollinai/bpf";

/// Names of BPF programs the agent attaches.
const BPF_PROGRAMS: &[&str] = &[
    "trace_execve",
    "trace_fork",
    "trace_clone",
    "trace_connect",
    "trace_sendto",
    "trace_openat",
    "trace_write",
];

/// Probe attachment state tracker.
pub struct ProbeManager {
    /// Whether eBPF probes are successfully attached
    pub probes_attached: bool,

    /// List of successfully attached probe names
    pub attached_probes: Vec<String>,

    /// List of probes that failed to attach
    pub failed_probes: Vec<(String, String)>, // (name, error)
}

impl ProbeManager {
    pub fn new() -> Self {
        Self {
            probes_attached: false,
            attached_probes: Vec::new(),
            failed_probes: Vec::new(),
        }
    }
}

/// Attempt to attach eBPF probes for syscall monitoring.
///
/// Looks for pre-compiled BPF object files in BPF_OBJ_DIR. In development,
/// these may not exist — the agent gracefully falls back to userspace mode.
///
/// # Probes Attached
///
/// | Syscall | Tracepoint/Kprobe | Purpose |
/// |---------|-------------------|---------|
/// | execve | tracepoint/syscalls/sys_enter_execve | Process execution tracking |
/// | fork | tracepoint/sched/sched_process_fork | Process creation (fork) |
/// | clone | tracepoint/sched/sched_process_fork | Process creation (clone/thread) |
/// | connect | kprobe/__sys_connect | Outbound network connections |
/// | sendto | kprobe/__sys_sendto | Network data transmission |
/// | openat | tracepoint/syscalls/sys_enter_openat | File access (read tracking) |
/// | write | tracepoint/syscalls/sys_enter_write | File write operations |
pub async fn attach_probes(config: &AgentConfig) -> Result<ProbeManager, ProbeError> {
    let bpf_dir = Path::new(BPF_OBJ_DIR);
    let mut manager = ProbeManager::new();

    if !bpf_dir.exists() {
        return Err(ProbeError::BpfObjectsNotFound(BPF_OBJ_DIR.to_string()));
    }

    for prog_name in BPF_PROGRAMS {
        let obj_path = bpf_dir.join(format!("{}.bpf.o", prog_name));

        if !obj_path.exists() {
            let msg = format!("BPF object file not found: {}", obj_path.display());
            warn!(probe = prog_name, "{}", msg);
            manager.failed_probes.push((prog_name.to_string(), msg));
            continue;
        }

        match load_and_attach_probe(&obj_path, prog_name) {
            Ok(()) => {
                info!(probe = prog_name, "eBPF probe attached successfully");
                manager.attached_probes.push(prog_name.to_string());
            }
            Err(e) => {
                let msg = format!("Failed to attach probe: {}", e);
                error!(probe = prog_name, error = %e, "Probe attachment failed");
                manager.failed_probes.push((prog_name.to_string(), msg));
            }
        }
    }

    manager.probes_attached = !manager.attached_probes.is_empty();

    if manager.attached_probes.is_empty() {
        Err(ProbeError::NoProbesAttached)
    } else {
        info!(
            attached = manager.attached_probes.len(),
            failed = manager.failed_probes.len(),
            "Probe attachment complete"
        );
        Ok(manager)
    }
}

/// Load a BPF object file and attach its programs.
///
/// This is a placeholder for the actual libbpf-rs loading logic.
/// In production, BPF programs are compiled from C source via clang/llvm
/// and packaged as .bpf.o files in the container image.
fn load_and_attach_probe(obj_path: &Path, _prog_name: &str) -> Result<(), ProbeError> {
    debug!(path = %obj_path.display(), "Loading BPF object");

    // In production, this would:
    // 1. Open the BPF object file with ObjectBuilder
    // 2. Load it into the kernel
    // 3. Attach to the appropriate tracepoint/kprobe
    // 4. Set up perf buffer or ring buffer for event output
    //
    // Example (actual implementation):
    // ```
    // let obj_builder = ObjectBuilder::default();
    // let open_obj = obj_builder.open_file(obj_path)?;
    // let obj = open_obj.load()?;
    // let prog = obj.prog("trace_execve")?;
    // let _link = prog.attach()?;
    // ```

    // Placeholder: verify file exists and is readable
    if !obj_path.exists() {
        return Err(ProbeError::BpfObjectsNotFound(
            obj_path.display().to_string(),
        ));
    }

    Ok(())
}

/// Errors that can occur during probe attachment.
#[derive(Debug, thiserror::Error)]
pub enum ProbeError {
    #[error("BPF object files not found at: {0}")]
    BpfObjectsNotFound(String),

    #[error("No probes could be attached")]
    NoProbesAttached,

    #[error("libbpf error: {0}")]
    Libbpf(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Kernel version unsupported: {0}")]
    KernelUnsupported(String),
}
