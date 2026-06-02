//! Pre-flight kernel compatibility check.
//!
//! Verifies that the host kernel meets requirements for eBPF probe attachment:
//! - Kernel version: 5.15+ (amd64) or 6.1+ (arm64)
//! - BPF syscall availability
//! - Required capabilities: CAP_BPF + CAP_PERFMON (or CAP_SYS_ADMIN on < 5.8)

use serde::{Deserialize, Serialize};
use std::fs;
use tracing::{debug, info};

/// Minimum kernel versions by architecture.
const MIN_KERNEL_AMD64: (u32, u32) = (5, 15);
const MIN_KERNEL_ARM64: (u32, u32) = (6, 1);

/// Linux capabilities required for eBPF probe attachment.
const CAP_BPF: u32 = 39;
const CAP_PERFMON: u32 = 38;
const CAP_SYS_ADMIN: u32 = 21;

/// Result of the pre-flight kernel compatibility check.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum KernelCheckResult {
    /// Kernel version and capabilities are sufficient for full eBPF operation.
    Pass {
        kernel_version: String,
        arch: String,
    },

    /// Kernel version is supported but capabilities are insufficient.
    /// Agent should operate in userspace fallback mode.
    Degraded {
        kernel_version: String,
        arch: String,
        missing_caps: Vec<String>,
    },

    /// Kernel version is too old or BPF syscall is unavailable.
    /// Agent must operate exclusively in userspace fallback mode.
    Unsupported {
        kernel_version: String,
        arch: String,
        reason: String,
    },
}

/// Perform the pre-flight kernel compatibility check.
///
/// Checks kernel version, BPF syscall availability, and process capabilities.
/// Returns the check result (pass, degraded, or unsupported).
pub fn perform_kernel_check() -> KernelCheckResult {
    let kernel_version = read_kernel_version().unwrap_or_else(|| "unknown".to_string());
    let arch = detect_architecture();

    info!(
        kernel_version = %kernel_version,
        arch = %arch,
        "Performing kernel compatibility check"
    );

    // Check kernel version meets minimum
    let (major, minor) = parse_kernel_version(&kernel_version);
    let (min_major, min_minor) = match arch.as_str() {
        "aarch64" | "arm64" => MIN_KERNEL_ARM64,
        _ => MIN_KERNEL_AMD64, // Default to amd64 requirements
    };

    if major < min_major || (major == min_major && minor < min_minor) {
        return KernelCheckResult::Unsupported {
            kernel_version,
            arch: arch.clone(),
            reason: format!(
                "Kernel {}.{} is below minimum {}.{} for {}",
                major, minor, min_major, min_minor, arch
            ),
        };
    }

    // Check BPF syscall availability
    if !check_bpf_syscall_available() {
        return KernelCheckResult::Unsupported {
            kernel_version,
            arch,
            reason: "BPF syscall is not available on this system".to_string(),
        };
    }

    // Check capabilities
    let missing_caps = check_capabilities(major, minor);
    if !missing_caps.is_empty() {
        return KernelCheckResult::Degraded {
            kernel_version,
            arch,
            missing_caps,
        };
    }

    KernelCheckResult::Pass {
        kernel_version,
        arch,
    }
}

/// Read kernel version from /proc/version or uname.
fn read_kernel_version() -> Option<String> {
    // Try /proc/version first
    if let Ok(version_str) = fs::read_to_string("/proc/version") {
        // Format: "Linux version 5.15.0-generic (...)"
        if let Some(version) = version_str
            .split_whitespace()
            .nth(2)
        {
            return Some(version.to_string());
        }
    }

    // Fallback: use libc uname
    #[cfg(target_os = "linux")]
    {
        let mut uname_buf: libc::utsname = unsafe { std::mem::zeroed() };
        let ret = unsafe { libc::uname(&mut uname_buf) };
        if ret == 0 {
            let release = unsafe {
                std::ffi::CStr::from_ptr(uname_buf.release.as_ptr())
                    .to_string_lossy()
                    .to_string()
            };
            return Some(release);
        }
    }

    None
}

/// Detect host architecture.
fn detect_architecture() -> String {
    #[cfg(target_arch = "x86_64")]
    {
        return "x86_64".to_string();
    }

    #[cfg(target_arch = "aarch64")]
    {
        return "aarch64".to_string();
    }

    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        // Fallback: try to read from uname
        "unknown".to_string()
    }
}

/// Parse major.minor from kernel version string (e.g., "5.15.0-generic" -> (5, 15)).
fn parse_kernel_version(version: &str) -> (u32, u32) {
    let parts: Vec<&str> = version.split('.').collect();
    let major = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    (major, minor)
}

/// Check if the BPF syscall (number 321 on x86_64, 280 on arm64) is available.
fn check_bpf_syscall_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        // Attempt a harmless BPF syscall (BPF_PROG_GET_FD_BY_ID with id=0)
        // If the syscall exists, we get EINVAL or EPERM (not ENOSYS)
        let ret = unsafe { libc::syscall(libc::SYS_bpf, 0u32, std::ptr::null::<u8>(), 0u32) };
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);

        // ENOSYS (38) means syscall doesn't exist
        // Any other error (EINVAL, EPERM, EFAULT) means it exists
        debug!(ret = ret, errno = errno, "BPF syscall probe result");
        errno != libc::ENOSYS
    }

    #[cfg(not(target_os = "linux"))]
    {
        // BPF is Linux-only
        false
    }
}

/// Check if the process has required capabilities for eBPF.
///
/// On kernels >= 5.8: requires CAP_BPF + CAP_PERFMON
/// On kernels < 5.8: requires CAP_SYS_ADMIN
fn check_capabilities(kernel_major: u32, kernel_minor: u32) -> Vec<String> {
    let mut missing = Vec::new();

    #[cfg(target_os = "linux")]
    {
        let needs_new_caps = kernel_major > 5 || (kernel_major == 5 && kernel_minor >= 8);

        if needs_new_caps {
            if !has_capability(CAP_BPF) {
                missing.push("CAP_BPF".to_string());
            }
            if !has_capability(CAP_PERFMON) {
                missing.push("CAP_PERFMON".to_string());
            }
        } else {
            if !has_capability(CAP_SYS_ADMIN) {
                missing.push("CAP_SYS_ADMIN".to_string());
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        missing.push("Not running on Linux".to_string());
    }

    missing
}

/// Check if the current process has a specific Linux capability.
#[cfg(target_os = "linux")]
fn has_capability(cap: u32) -> bool {
    // Read /proc/self/status for CapEff (effective capabilities bitmask)
    if let Ok(status) = fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if line.starts_with("CapEff:") {
                if let Some(hex_str) = line.split_whitespace().nth(1) {
                    if let Ok(cap_bits) = u64::from_str_radix(hex_str.trim(), 16) {
                        return (cap_bits & (1u64 << cap)) != 0;
                    }
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_kernel_version() {
        assert_eq!(parse_kernel_version("5.15.0-generic"), (5, 15));
        assert_eq!(parse_kernel_version("6.1.0"), (6, 1));
        assert_eq!(parse_kernel_version("4.18.0-372.el8"), (4, 18));
        assert_eq!(parse_kernel_version(""), (0, 0));
        assert_eq!(parse_kernel_version("5"), (5, 0));
    }

    #[test]
    fn test_kernel_check_unsupported_old_kernel() {
        // A kernel version 4.18 on amd64 should be unsupported
        let (major, minor) = parse_kernel_version("4.18.0");
        let (min_major, min_minor) = MIN_KERNEL_AMD64;
        assert!(
            major < min_major || (major == min_major && minor < min_minor),
            "Kernel 4.18 should be below minimum 5.15 for amd64"
        );
    }

    #[test]
    fn test_kernel_check_supported_amd64() {
        let (major, minor) = parse_kernel_version("5.15.0");
        let (min_major, min_minor) = MIN_KERNEL_AMD64;
        assert!(
            major > min_major || (major == min_major && minor >= min_minor),
            "Kernel 5.15 should meet minimum for amd64"
        );
    }

    #[test]
    fn test_kernel_check_supported_arm64() {
        let (major, minor) = parse_kernel_version("6.1.0");
        let (min_major, min_minor) = MIN_KERNEL_ARM64;
        assert!(
            major > min_major || (major == min_major && minor >= min_minor),
            "Kernel 6.1 should meet minimum for arm64"
        );
    }

    #[test]
    fn test_kernel_check_arm64_unsupported() {
        let (major, minor) = parse_kernel_version("5.15.0");
        let (min_major, min_minor) = MIN_KERNEL_ARM64;
        assert!(
            major < min_major || (major == min_major && minor < min_minor),
            "Kernel 5.15 should be below minimum 6.1 for arm64"
        );
    }
}
