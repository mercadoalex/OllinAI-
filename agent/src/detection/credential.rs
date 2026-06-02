//! Supply chain credential exfiltration detection.
//!
//! Detects credential file access from processes whose ancestry includes
//! package installation commands (npm install, pip install, go get, cargo build).
//! Flags high-confidence exfiltration attempts by correlating file access
//! patterns with process ancestry.

use crate::ancestry::ProcessAncestry;
use crate::telemetry::AnomalyFlag;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Known credential file patterns to monitor for access.
const CREDENTIAL_PATTERNS: &[&str] = &[
    "/.aws/credentials",
    "/.aws/config",
    "/.docker/config.json",
    "/.ssh/id_rsa",
    "/.ssh/id_ed25519",
    "/.ssh/id_ecdsa",
    "/.ssh/id_dsa",
    "/.npmrc",
    "/.pypirc",
    "/.gem/credentials",
    "/.cargo/credentials",
    "/.cargo/credentials.toml",
    "/.config/gh/hosts.yml",
    "/.kube/config",
];

/// Environment variable patterns that indicate credential access.
const CREDENTIAL_ENV_PATTERNS: &[&str] = &[
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GITLAB_TOKEN",
    "NPM_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "DOCKER_AUTH_CONFIG",
];

/// Package installer commands that indicate a supply chain context.
const PACKAGE_INSTALLER_COMMANDS: &[PackageInstallerPattern] = &[
    PackageInstallerPattern { comm: "npm", args: &["install", "i", "ci"] },
    PackageInstallerPattern { comm: "yarn", args: &["install", "add"] },
    PackageInstallerPattern { comm: "pnpm", args: &["install", "add", "i"] },
    PackageInstallerPattern { comm: "pip", args: &["install"] },
    PackageInstallerPattern { comm: "pip3", args: &["install"] },
    PackageInstallerPattern { comm: "go", args: &["get", "install", "mod"] },
    PackageInstallerPattern { comm: "cargo", args: &["build", "install", "fetch"] },
    PackageInstallerPattern { comm: "gem", args: &["install"] },
    PackageInstallerPattern { comm: "composer", args: &["install", "require"] },
    PackageInstallerPattern { comm: "bundle", args: &["install"] },
    PackageInstallerPattern { comm: "poetry", args: &["install", "add"] },
    PackageInstallerPattern { comm: "pipenv", args: &["install"] },
];

/// A pattern for matching package installer commands.
#[derive(Debug, Clone)]
struct PackageInstallerPattern {
    /// Command name (e.g., "npm")
    comm: &'static str,
    /// Subcommands that indicate package installation
    args: &'static [&'static str],
}

/// Result of credential exfiltration analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialAccessResult {
    /// Whether this is a high-confidence exfiltration attempt
    pub is_exfiltration: bool,
    /// The credential path accessed
    pub credential_path: PathBuf,
    /// The process that accessed the credential
    pub accessing_pid: u32,
    /// The ancestor command that is a package installer
    pub installer_ancestor: Option<String>,
    /// Full process chain from accessor to installer
    pub process_chain: Vec<String>,
}

/// Credential exfiltration detector.
///
/// Analyzes file access events in the context of process ancestry
/// to detect supply chain credential exfiltration attempts.
#[derive(Debug, Clone)]
pub struct CredentialDetector {
    /// Additional credential paths configured by user/rules
    custom_credential_paths: Vec<String>,
}

impl CredentialDetector {
    /// Create a new credential detector with default patterns.
    pub fn new() -> Self {
        Self {
            custom_credential_paths: Vec::new(),
        }
    }

    /// Add custom credential path patterns.
    pub fn add_custom_paths(&mut self, paths: Vec<String>) {
        self.custom_credential_paths.extend(paths);
    }

    /// Check if a file path matches a known credential pattern.
    pub fn is_credential_path(&self, path: &Path) -> bool {
        let path_str = path.to_string_lossy();

        // Check built-in patterns
        for pattern in CREDENTIAL_PATTERNS {
            if path_str.ends_with(pattern) || path_str.contains(pattern) {
                return true;
            }
        }

        // Check for SSH key patterns more broadly
        if path_str.contains("/.ssh/") && (
            path_str.ends_with("_rsa") ||
            path_str.ends_with("_ed25519") ||
            path_str.ends_with("_ecdsa") ||
            path_str.ends_with("_dsa") ||
            path_str.ends_with(".pem")
        ) {
            return true;
        }

        // Check custom patterns
        for pattern in &self.custom_credential_paths {
            if path_str.contains(pattern) {
                return true;
            }
        }

        false
    }

    /// Check if a process node represents a package installer command.
    pub fn is_package_installer(comm: &str, argv: &[String]) -> bool {
        for pattern in PACKAGE_INSTALLER_COMMANDS {
            if comm == pattern.comm || comm.ends_with(&format!("/{}", pattern.comm)) {
                // If args patterns are empty, any invocation counts
                if pattern.args.is_empty() {
                    return true;
                }
                // Check if any arg matches the installer subcommands
                for arg in argv {
                    if pattern.args.contains(&arg.as_str()) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Analyze a file access event for credential exfiltration.
    ///
    /// Checks if:
    /// 1. The accessed file is a credential file
    /// 2. The accessing process has a package installer in its ancestry
    ///
    /// If both conditions are met, flags as high-confidence exfiltration.
    pub fn analyze_access(
        &self,
        pid: u32,
        file_path: &Path,
        ancestry: &ProcessAncestry,
    ) -> CredentialAccessResult {
        let is_credential = self.is_credential_path(file_path);

        if !is_credential {
            return CredentialAccessResult {
                is_exfiltration: false,
                credential_path: file_path.to_path_buf(),
                accessing_pid: pid,
                installer_ancestor: None,
                process_chain: Vec::new(),
            };
        }

        // Walk the ancestry chain looking for package installers
        let chain = ancestry.get_ancestry_chain(pid);
        let mut process_chain: Vec<String> = Vec::new();
        let mut installer_ancestor: Option<String> = None;

        for node in &chain {
            process_chain.push(node.comm.clone());

            // Skip the accessing process itself — check ancestors
            if node.pid == pid {
                continue;
            }

            if Self::is_package_installer(&node.comm, &node.argv) {
                let cmd_str = if node.argv.is_empty() {
                    node.comm.clone()
                } else {
                    format!("{} {}", node.comm, node.argv.join(" "))
                };
                installer_ancestor = Some(cmd_str);
                break;
            }
        }

        CredentialAccessResult {
            is_exfiltration: installer_ancestor.is_some(),
            credential_path: file_path.to_path_buf(),
            accessing_pid: pid,
            installer_ancestor,
            process_chain,
        }
    }

    /// Generate an AnomalyFlag for a confirmed exfiltration attempt.
    pub fn to_anomaly_flag(result: &CredentialAccessResult) -> Option<AnomalyFlag> {
        if !result.is_exfiltration {
            return None;
        }

        Some(AnomalyFlag::CredentialExfiltration {
            pid: result.accessing_pid,
            credential_path: result.credential_path.clone(),
            ancestor_command: result.installer_ancestor.clone().unwrap_or_default(),
            process_chain: result.process_chain.clone(),
        })
    }
}

impl Default for CredentialDetector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ancestry::ProcessAncestry;
    use proptest::prelude::*;
    use std::path::PathBuf;

    fn build_npm_tree() -> ProcessAncestry {
        let mut tree = ProcessAncestry::new(1);
        tree.record_process(1, 0, "bash".into(), vec!["-c".into(), "npm install".into()], PathBuf::from("/app"), 1000);
        tree.record_process(2, 1, "npm".into(), vec!["install".into()], PathBuf::from("/app"), 2000);
        tree.record_process(3, 2, "node".into(), vec!["lifecycle.js".into()], PathBuf::from("/app"), 3000);
        tree.record_process(4, 3, "sh".into(), vec!["-c".into(), "cat ~/.aws/credentials".into()], PathBuf::from("/app"), 4000);
        tree
    }

    fn build_safe_tree() -> ProcessAncestry {
        let mut tree = ProcessAncestry::new(1);
        tree.record_process(1, 0, "bash".into(), vec![], PathBuf::from("/app"), 1000);
        tree.record_process(2, 1, "aws".into(), vec!["s3".into(), "cp".into()], PathBuf::from("/app"), 2000);
        tree
    }

    #[test]
    fn test_credential_path_detection() {
        let detector = CredentialDetector::new();
        assert!(detector.is_credential_path(Path::new("/home/user/.aws/credentials")));
        assert!(detector.is_credential_path(Path::new("/root/.docker/config.json")));
        assert!(detector.is_credential_path(Path::new("/home/user/.ssh/id_rsa")));
        assert!(detector.is_credential_path(Path::new("/home/user/.ssh/id_ed25519")));
        assert!(!detector.is_credential_path(Path::new("/tmp/output.txt")));
        assert!(!detector.is_credential_path(Path::new("/app/src/main.rs")));
    }

    #[test]
    fn test_package_installer_detection() {
        assert!(CredentialDetector::is_package_installer("npm", &["install".to_string()]));
        assert!(CredentialDetector::is_package_installer("pip", &["install".to_string(), "requests".to_string()]));
        assert!(CredentialDetector::is_package_installer("cargo", &["build".to_string()]));
        assert!(CredentialDetector::is_package_installer("go", &["get".to_string(), "github.com/pkg".to_string()]));
        assert!(!CredentialDetector::is_package_installer("node", &["script.js".to_string()]));
        assert!(!CredentialDetector::is_package_installer("python", &["app.py".to_string()]));
    }

    #[test]
    fn test_exfiltration_detected_npm_ancestry() {
        let detector = CredentialDetector::new();
        let tree = build_npm_tree();

        let result = detector.analyze_access(
            4,
            Path::new("/home/user/.aws/credentials"),
            &tree,
        );

        assert!(result.is_exfiltration);
        assert!(result.installer_ancestor.is_some());
        assert!(result.installer_ancestor.unwrap().contains("npm"));
    }

    #[test]
    fn test_no_exfiltration_without_installer_ancestry() {
        let detector = CredentialDetector::new();
        let tree = build_safe_tree();

        let result = detector.analyze_access(
            2,
            Path::new("/home/user/.aws/credentials"),
            &tree,
        );

        // aws CLI reading credentials is not exfiltration (no package installer ancestor)
        assert!(!result.is_exfiltration);
    }

    #[test]
    fn test_no_exfiltration_non_credential_file() {
        let detector = CredentialDetector::new();
        let tree = build_npm_tree();

        let result = detector.analyze_access(
            4,
            Path::new("/app/package.json"),
            &tree,
        );

        assert!(!result.is_exfiltration);
    }

    #[test]
    fn test_anomaly_flag_generation() {
        let detector = CredentialDetector::new();
        let tree = build_npm_tree();

        let result = detector.analyze_access(
            4,
            Path::new("/home/user/.aws/credentials"),
            &tree,
        );

        let flag = CredentialDetector::to_anomaly_flag(&result);
        assert!(flag.is_some());
        match flag.unwrap() {
            AnomalyFlag::CredentialExfiltration { pid, credential_path, .. } => {
                assert_eq!(pid, 4);
                assert_eq!(credential_path, PathBuf::from("/home/user/.aws/credentials"));
            }
            _ => panic!("Expected CredentialExfiltration flag"),
        }
    }

    #[test]
    fn test_custom_credential_paths() {
        let mut detector = CredentialDetector::new();
        detector.add_custom_paths(vec!["/custom/secret.key".to_string()]);

        assert!(detector.is_credential_path(Path::new("/custom/secret.key")));
    }

    // --- Property-based tests ---

    proptest! {
        /// **Validates: Requirements 13.5** - credential access from installer descendants is flagged
        #[test]
        fn prop_installer_descendant_credential_access_flagged(
            installer in prop_oneof![
                Just(("npm", "install")),
                Just(("pip", "install")),
                Just(("cargo", "build")),
                Just(("go", "get")),
            ],
            credential_path in prop_oneof![
                Just("/home/user/.aws/credentials"),
                Just("/home/user/.docker/config.json"),
                Just("/home/user/.ssh/id_rsa"),
                Just("/home/user/.ssh/id_ed25519"),
            ],
        ) {
            let detector = CredentialDetector::new();
            let mut tree = ProcessAncestry::new(1);
            tree.record_process(1, 0, "bash".into(), vec![], PathBuf::from("/"), 1000);
            tree.record_process(2, 1, installer.0.to_string(), vec![installer.1.to_string()], PathBuf::from("/app"), 2000);
            tree.record_process(3, 2, "malicious".into(), vec![], PathBuf::from("/app"), 3000);

            let result = detector.analyze_access(3, Path::new(credential_path), &tree);
            prop_assert!(result.is_exfiltration);
            prop_assert!(result.installer_ancestor.is_some());
        }

        /// **Validates: Requirements 13.5** - non-credential access is never flagged as exfiltration
        #[test]
        fn prop_non_credential_access_never_flagged(
            path in "/app/src/[a-z]{1,10}\\.(rs|js|py|go)",
        ) {
            let detector = CredentialDetector::new();
            let mut tree = ProcessAncestry::new(1);
            tree.record_process(1, 0, "npm".into(), vec!["install".into()], PathBuf::from("/"), 1000);
            tree.record_process(2, 1, "node".into(), vec![], PathBuf::from("/app"), 2000);

            let result = detector.analyze_access(2, Path::new(&path), &tree);
            prop_assert!(!result.is_exfiltration);
        }

        /// **Validates: Requirements 13.5** - without installer ancestor, credential access is not exfiltration
        #[test]
        fn prop_credential_access_without_installer_not_flagged(
            comm in "[a-z]{3,8}",
        ) {
            // Ensure the command is NOT a package installer
            prop_assume!(
                !["npm", "pip", "pip3", "cargo", "go", "yarn", "pnpm", "gem", "composer", "bundle", "poetry", "pipenv"]
                    .contains(&comm.as_str())
            );

            let detector = CredentialDetector::new();
            let mut tree = ProcessAncestry::new(1);
            tree.record_process(1, 0, comm.clone(), vec!["run".into()], PathBuf::from("/"), 1000);
            tree.record_process(2, 1, "cat".into(), vec![], PathBuf::from("/"), 2000);

            let result = detector.analyze_access(2, Path::new("/home/user/.aws/credentials"), &tree);
            prop_assert!(!result.is_exfiltration);
        }
    }
}
