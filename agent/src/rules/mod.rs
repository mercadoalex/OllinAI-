//! Externalized Rule Engine
//!
//! Parses declarative YAML rules with match types: processAncestry, fileAccess,
//! networkDestination, resourceThreshold. Supports AND/OR condition combinators
//! and hot-reload of in-memory rule sets without restart.
//!
//! Requirements: 18.1, 18.2, 18.4

pub mod enforcement;
pub mod parser;

use crate::ancestry::ProcessAncestry;
use parser::{ConditionGroup, DetectionRule, Operator};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::Path;
use std::sync::{Arc, RwLock};

/// Alert generated when a rule matches.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionAlert {
    pub rule_id: String,
    pub rule_name: String,
    pub severity: String,
    pub matched_process_pid: Option<u32>,
    pub matched_process_comm: Option<String>,
    pub process_ancestry_chain: Vec<String>,
    pub description: String,
    pub timestamp: u64,
}

/// Context provided to the rule engine for evaluation.
#[derive(Debug, Clone)]
pub struct EvalContext<'a> {
    pub pid: u32,
    pub comm: &'a str,
    pub ancestry: &'a ProcessAncestry,
    pub file_path: Option<&'a Path>,
    pub file_operation: Option<&'a str>,
    pub network_dest_addr: Option<IpAddr>,
    pub network_dest_port: Option<u16>,
    pub network_domain: Option<&'a str>,
    pub cpu_percent: Option<f32>,
    pub memory_bytes: Option<u64>,
    pub timestamp: u64,
}

/// The rule engine: holds a set of parsed rules and evaluates events against them.
#[derive(Debug, Clone)]
pub struct RuleEngine {
    rules: Arc<RwLock<Vec<DetectionRule>>>,
}

impl RuleEngine {
    /// Create an empty rule engine.
    pub fn new() -> Self {
        Self {
            rules: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Load rules from YAML string (hot-reload safe — replaces in-memory set).
    pub fn load_rules(&self, yaml_content: &str) -> Result<usize, String> {
        let rules = parser::parse_rules(yaml_content)?;
        let count = rules.len();
        let mut store = self.rules.write().map_err(|e| e.to_string())?;
        *store = rules;
        Ok(count)
    }

    /// Get current rule count.
    pub fn rule_count(&self) -> usize {
        self.rules.read().map(|r| r.len()).unwrap_or(0)
    }

    /// Evaluate an event context against all loaded rules. Returns alerts for matches.
    pub fn evaluate(&self, ctx: &EvalContext) -> Vec<DetectionAlert> {
        let rules = match self.rules.read() {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        let mut alerts = Vec::new();
        for rule in rules.iter() {
            if self.rule_matches(rule, ctx) {
                let chain = ctx
                    .ancestry
                    .get_ancestry_chain(ctx.pid)
                    .iter()
                    .map(|n| n.comm.clone())
                    .collect();
                alerts.push(DetectionAlert {
                    rule_id: rule.id.clone(),
                    rule_name: rule.name.clone(),
                    severity: rule.severity.clone(),
                    matched_process_pid: Some(ctx.pid),
                    matched_process_comm: Some(ctx.comm.to_string()),
                    process_ancestry_chain: chain,
                    description: rule.description.clone(),
                    timestamp: ctx.timestamp,
                });
            }
        }
        alerts
    }

    fn rule_matches(&self, rule: &DetectionRule, ctx: &EvalContext) -> bool {
        let mut match_results: Vec<bool> = Vec::new();

        // Check processAncestry match
        if let Some(ref pattern) = rule.match_block.process_ancestry {
            let matched = self.match_process_ancestry(pattern, ctx);
            match_results.push(matched);
        }

        // Check fileAccess match
        if let Some(ref pattern) = rule.match_block.file_access {
            let matched = self.match_file_access(pattern, ctx);
            match_results.push(matched);
        }

        // Check networkDestination match
        if let Some(ref pattern) = rule.match_block.network_destination {
            let matched = self.match_network_destination(pattern, ctx);
            match_results.push(matched);
        }

        // Check resourceThreshold match
        if let Some(ref pattern) = rule.match_block.resource_threshold {
            let matched = self.match_resource_threshold(pattern, ctx);
            match_results.push(matched);
        }

        if match_results.is_empty() {
            return false;
        }

        // Apply condition combinator
        match &rule.conditions {
            Some(group) => self.apply_conditions(group, &match_results),
            None => {
                // Default: AND — all match blocks must match
                match_results.iter().all(|&r| r)
            }
        }
    }

    fn match_process_ancestry(
        &self,
        pattern: &parser::AncestryPattern,
        ctx: &EvalContext,
    ) -> bool {
        let chain = ctx.ancestry.get_ancestry_chain(ctx.pid);
        let max_depth = pattern.max_depth.unwrap_or(chain.len() as u32) as usize;

        let ancestor_re = match regex::Regex::new(&pattern.ancestor_command) {
            Ok(r) => r,
            Err(_) => return false,
        };

        let descendant_re = pattern
            .descendant_command
            .as_ref()
            .and_then(|d| regex::Regex::new(d).ok());

        // Check descendant (current process) first
        if let Some(ref desc_re) = descendant_re {
            let full_cmd = if ctx.comm.is_empty() {
                String::new()
            } else {
                ctx.comm.to_string()
            };
            if !desc_re.is_match(&full_cmd) {
                return false;
            }
        }

        // Walk ancestors (skip self)
        for (i, node) in chain.iter().skip(1).enumerate() {
            if i >= max_depth {
                break;
            }
            let cmd = format!("{} {}", node.comm, node.argv.join(" "));
            if ancestor_re.is_match(&cmd) || ancestor_re.is_match(&node.comm) {
                return true;
            }
        }

        false
    }

    fn match_file_access(&self, pattern: &parser::FileAccessPattern, ctx: &EvalContext) -> bool {
        let file_path = match ctx.file_path {
            Some(p) => p,
            None => return false,
        };

        // Check operation match
        if let Some(ref op) = pattern.operation {
            if let Some(ref actual_op) = ctx.file_operation {
                if actual_op != op {
                    return false;
                }
            } else {
                return false;
            }
        }

        let path_str = file_path.to_string_lossy();
        for path_pattern in &pattern.paths {
            // Handle glob-like patterns
            if path_pattern.contains("**") {
                let suffix = path_pattern.trim_start_matches("**");
                if path_str.ends_with(suffix) {
                    return true;
                }
            } else if path_pattern.starts_with('~') {
                // ~/path matches /home/<any>/path
                let suffix = &path_pattern[1..];
                if path_str.contains(suffix) {
                    return true;
                }
            } else if path_str.contains(path_pattern.as_str()) {
                return true;
            }
        }

        false
    }

    fn match_network_destination(
        &self,
        pattern: &parser::NetworkPattern,
        ctx: &EvalContext,
    ) -> bool {
        // Check domain match
        if let Some(ref domains) = pattern.domains {
            if let Some(domain) = ctx.network_domain {
                for d in domains {
                    if domain.ends_with(d) || domain == d.as_str() {
                        return true;
                    }
                }
            }
        }

        // Check IP match
        if let Some(ref ips) = pattern.ips {
            if let Some(addr) = ctx.network_dest_addr {
                let addr_str = addr.to_string();
                for ip in ips {
                    if addr_str == *ip {
                        return true;
                    }
                }
            }
        }

        // Check port match
        if let Some(ref ports) = pattern.ports {
            if let Some(port) = ctx.network_dest_port {
                if ports.contains(&port) {
                    return true;
                }
            }
        }

        false
    }

    fn match_resource_threshold(
        &self,
        pattern: &parser::ResourcePattern,
        ctx: &EvalContext,
    ) -> bool {
        if let Some(max_cpu) = pattern.max_cpu_percent {
            if let Some(cpu) = ctx.cpu_percent {
                if cpu > max_cpu {
                    return true;
                }
            }
        }

        if let Some(max_mem) = pattern.max_memory_bytes {
            if let Some(mem) = ctx.memory_bytes {
                if mem > max_mem {
                    return true;
                }
            }
        }

        false
    }

    fn apply_conditions(&self, group: &ConditionGroup, results: &[bool]) -> bool {
        match group.operator {
            Operator::And => results.iter().all(|&r| r),
            Operator::Or => results.iter().any(|&r| r),
        }
    }
}

impl Default for RuleEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ancestry::ProcessAncestry;
    use std::net::IpAddr;
    use std::path::PathBuf;

    fn make_ancestry() -> ProcessAncestry {
        let mut tree = ProcessAncestry::new(1);
        tree.record_process(1, 0, "bash".into(), vec![], PathBuf::from("/"), 1000);
        tree.record_process(
            2,
            1,
            "npm".into(),
            vec!["install".into()],
            PathBuf::from("/app"),
            2000,
        );
        tree.record_process(3, 2, "node".into(), vec![], PathBuf::from("/app"), 3000);
        tree.record_process(
            4,
            3,
            "malicious".into(),
            vec![],
            PathBuf::from("/app"),
            4000,
        );
        tree
    }

    const SAMPLE_RULES: &str = r#"
- id: "cred-access-001"
  name: "Credential access from build tool"
  description: "Detects credential file reads by descendants of build tools"
  severity: critical
  match:
    processAncestry:
      ancestorCommand: "^(npm|pip|cargo|go)\\s*(install|build|get)"
    fileAccess:
      paths:
        - "~/.aws/credentials"
        - "~/.docker/config.json"
      operation: read
  conditions:
    operator: and

- id: "network-001"
  name: "Suspicious network destination"
  description: "Connection to known malicious domain"
  severity: warning
  match:
    networkDestination:
      domains:
        - "evil.example.com"
        - ".malware.net"
"#;

    #[test]
    fn test_load_and_evaluate_rules() {
        let engine = RuleEngine::new();
        let count = engine.load_rules(SAMPLE_RULES).unwrap();
        assert_eq!(count, 2);
        assert_eq!(engine.rule_count(), 2);
    }

    #[test]
    fn test_credential_access_rule_matches() {
        let engine = RuleEngine::new();
        engine.load_rules(SAMPLE_RULES).unwrap();
        let ancestry = make_ancestry();

        let ctx = EvalContext {
            pid: 4,
            comm: "malicious",
            ancestry: &ancestry,
            file_path: Some(Path::new("/home/user/.aws/credentials")),
            file_operation: Some("read"),
            network_dest_addr: None,
            network_dest_port: None,
            network_domain: None,
            cpu_percent: None,
            memory_bytes: None,
            timestamp: 5000,
        };

        let alerts = engine.evaluate(&ctx);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].rule_id, "cred-access-001");
        assert_eq!(alerts[0].severity, "critical");
    }

    #[test]
    fn test_network_rule_matches() {
        let engine = RuleEngine::new();
        engine.load_rules(SAMPLE_RULES).unwrap();
        let ancestry = make_ancestry();

        let ctx = EvalContext {
            pid: 4,
            comm: "curl",
            ancestry: &ancestry,
            file_path: None,
            file_operation: None,
            network_dest_addr: None,
            network_dest_port: None,
            network_domain: Some("test.malware.net"),
            cpu_percent: None,
            memory_bytes: None,
            timestamp: 6000,
        };

        let alerts = engine.evaluate(&ctx);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].rule_id, "network-001");
    }

    #[test]
    fn test_hot_reload_replaces_rules() {
        let engine = RuleEngine::new();
        engine.load_rules(SAMPLE_RULES).unwrap();
        assert_eq!(engine.rule_count(), 2);

        let new_rules = r#"
- id: "new-rule-001"
  name: "New rule"
  description: "Replacement rule"
  severity: info
  match:
    resourceThreshold:
      maxCpuPercent: 90.0
"#;
        engine.load_rules(new_rules).unwrap();
        assert_eq!(engine.rule_count(), 1);
    }

    #[test]
    fn test_no_match_without_relevant_context() {
        let engine = RuleEngine::new();
        engine.load_rules(SAMPLE_RULES).unwrap();
        let ancestry = make_ancestry();

        let ctx = EvalContext {
            pid: 4,
            comm: "ls",
            ancestry: &ancestry,
            file_path: Some(Path::new("/tmp/output.txt")),
            file_operation: Some("write"),
            network_dest_addr: None,
            network_dest_port: None,
            network_domain: None,
            cpu_percent: None,
            memory_bytes: None,
            timestamp: 7000,
        };

        let alerts = engine.evaluate(&ctx);
        assert!(alerts.is_empty());
    }
}
