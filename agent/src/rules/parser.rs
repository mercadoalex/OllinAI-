//! YAML Rule Parser
//!
//! Parses declarative YAML detection rules with match types:
//! processAncestry, fileAccess, networkDestination, resourceThreshold.
//! Supports AND/OR condition combinators.
//!
//! Requirements: 18.1, 18.2, 18.4

use serde::{Deserialize, Serialize};

/// A detection rule parsed from YAML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub severity: String,
    #[serde(rename = "match")]
    pub match_block: MatchBlock,
    pub conditions: Option<ConditionGroup>,
}

/// The match block of a rule — each field is optional.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MatchBlock {
    #[serde(rename = "processAncestry")]
    pub process_ancestry: Option<AncestryPattern>,
    #[serde(rename = "fileAccess")]
    pub file_access: Option<FileAccessPattern>,
    #[serde(rename = "networkDestination")]
    pub network_destination: Option<NetworkPattern>,
    #[serde(rename = "resourceThreshold")]
    pub resource_threshold: Option<ResourcePattern>,
}

/// Pattern for matching on process ancestry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AncestryPattern {
    /// Regex pattern for ancestor command
    #[serde(rename = "ancestorCommand")]
    pub ancestor_command: String,
    /// Optional regex for descendant (current process)
    #[serde(rename = "descendantCommand")]
    pub descendant_command: Option<String>,
    /// Maximum ancestry depth to search
    #[serde(rename = "maxDepth")]
    pub max_depth: Option<u32>,
}

/// Pattern for matching file access events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAccessPattern {
    /// File path patterns (supports ~ prefix and ** glob)
    pub paths: Vec<String>,
    /// Operation type to match: "read" or "write"
    pub operation: Option<String>,
}

/// Pattern for matching network destinations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPattern {
    /// Domain patterns to match (suffix matching)
    pub domains: Option<Vec<String>>,
    /// Specific IP addresses to match
    pub ips: Option<Vec<String>>,
    /// Specific ports to match
    pub ports: Option<Vec<u16>>,
}

/// Pattern for matching resource thresholds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourcePattern {
    /// Maximum CPU percent before triggering
    #[serde(rename = "maxCpuPercent")]
    pub max_cpu_percent: Option<f32>,
    /// Maximum memory bytes before triggering
    #[serde(rename = "maxMemoryBytes")]
    pub max_memory_bytes: Option<u64>,
}

/// Condition group — combines match results with AND/OR logic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConditionGroup {
    pub operator: Operator,
}

/// Logical operator for combining match results.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Operator {
    And,
    Or,
}

/// Parse a YAML string containing an array of detection rules.
pub fn parse_rules(yaml_content: &str) -> Result<Vec<DetectionRule>, String> {
    serde_yaml::from_str::<Vec<DetectionRule>>(yaml_content)
        .map_err(|e| format!("Failed to parse rules YAML: {}", e))
}

/// Validate a single rule for correctness.
pub fn validate_rule(rule: &DetectionRule) -> Result<(), String> {
    if rule.id.is_empty() {
        return Err("Rule ID cannot be empty".into());
    }
    if rule.name.is_empty() {
        return Err("Rule name cannot be empty".into());
    }

    let valid_severities = ["info", "warning", "critical"];
    if !valid_severities.contains(&rule.severity.as_str()) {
        return Err(format!(
            "Invalid severity '{}'. Must be one of: info, warning, critical",
            rule.severity
        ));
    }

    // Validate at least one match block is present
    if rule.match_block.process_ancestry.is_none()
        && rule.match_block.file_access.is_none()
        && rule.match_block.network_destination.is_none()
        && rule.match_block.resource_threshold.is_none()
    {
        return Err("Rule must have at least one match block".into());
    }

    // Validate regex patterns compile
    if let Some(ref ancestry) = rule.match_block.process_ancestry {
        regex::Regex::new(&ancestry.ancestor_command)
            .map_err(|e| format!("Invalid ancestorCommand regex: {}", e))?;
        if let Some(ref desc) = ancestry.descendant_command {
            regex::Regex::new(desc)
                .map_err(|e| format!("Invalid descendantCommand regex: {}", e))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_parse_basic_rule() {
        let yaml = r#"
- id: "test-001"
  name: "Test rule"
  description: "A test"
  severity: critical
  match:
    processAncestry:
      ancestorCommand: "npm install"
"#;
        let rules = parse_rules(yaml).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "test-001");
        assert_eq!(rules[0].severity, "critical");
        assert!(rules[0].match_block.process_ancestry.is_some());
    }

    #[test]
    fn test_parse_multiple_match_types() {
        let yaml = r#"
- id: "multi-001"
  name: "Multi match"
  description: "Tests multiple match types"
  severity: warning
  match:
    fileAccess:
      paths:
        - "~/.aws/credentials"
      operation: read
    networkDestination:
      domains:
        - ".evil.com"
      ports:
        - 4444
    resourceThreshold:
      maxCpuPercent: 95.0
      maxMemoryBytes: 4294967296
  conditions:
    operator: or
"#;
        let rules = parse_rules(yaml).unwrap();
        assert_eq!(rules.len(), 1);
        let rule = &rules[0];
        assert!(rule.match_block.file_access.is_some());
        assert!(rule.match_block.network_destination.is_some());
        assert!(rule.match_block.resource_threshold.is_some());
        assert_eq!(rule.conditions.as_ref().unwrap().operator, Operator::Or);
    }

    #[test]
    fn test_parse_invalid_yaml() {
        let yaml = "not valid yaml: [[[";
        let result = parse_rules(yaml);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_rule_valid() {
        let rule = DetectionRule {
            id: "test-001".into(),
            name: "Test".into(),
            description: "Desc".into(),
            severity: "critical".into(),
            match_block: MatchBlock {
                process_ancestry: Some(AncestryPattern {
                    ancestor_command: "npm".into(),
                    descendant_command: None,
                    max_depth: None,
                }),
                ..Default::default()
            },
            conditions: None,
        };
        assert!(validate_rule(&rule).is_ok());
    }

    #[test]
    fn test_validate_rule_empty_id() {
        let rule = DetectionRule {
            id: "".into(),
            name: "Test".into(),
            description: "Desc".into(),
            severity: "critical".into(),
            match_block: MatchBlock {
                process_ancestry: Some(AncestryPattern {
                    ancestor_command: "npm".into(),
                    descendant_command: None,
                    max_depth: None,
                }),
                ..Default::default()
            },
            conditions: None,
        };
        assert!(validate_rule(&rule).is_err());
    }

    #[test]
    fn test_validate_rule_no_match_block() {
        let rule = DetectionRule {
            id: "test-001".into(),
            name: "Test".into(),
            description: "Desc".into(),
            severity: "critical".into(),
            match_block: MatchBlock::default(),
            conditions: None,
        };
        let result = validate_rule(&rule);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("at least one match block"));
    }

    #[test]
    fn test_validate_rule_invalid_severity() {
        let rule = DetectionRule {
            id: "test-001".into(),
            name: "Test".into(),
            description: "Desc".into(),
            severity: "extreme".into(),
            match_block: MatchBlock {
                resource_threshold: Some(ResourcePattern {
                    max_cpu_percent: Some(90.0),
                    max_memory_bytes: None,
                }),
                ..Default::default()
            },
            conditions: None,
        };
        assert!(validate_rule(&rule).is_err());
    }

    // Property-based tests
    proptest! {
        /// Round-trip: a serialized rule can be deserialized back to the same structure
        #[test]
        fn prop_rule_yaml_roundtrip(
            id in "[a-z]{3,10}-[0-9]{3}",
            name in "[A-Za-z ]{5,30}",
            severity in prop_oneof![Just("info"), Just("warning"), Just("critical")],
            ancestor_cmd in "[a-z]{2,8}",
        ) {
            let rule = DetectionRule {
                id: id.clone(),
                name: name.clone(),
                description: "Test description".into(),
                severity: severity.to_string(),
                match_block: MatchBlock {
                    process_ancestry: Some(AncestryPattern {
                        ancestor_command: ancestor_cmd.clone(),
                        descendant_command: None,
                        max_depth: Some(10),
                    }),
                    ..Default::default()
                },
                conditions: None,
            };

            let yaml = serde_yaml::to_string(&vec![rule.clone()]).unwrap();
            let parsed = parse_rules(&yaml).unwrap();
            prop_assert_eq!(parsed.len(), 1);
            prop_assert_eq!(&parsed[0].id, &id);
            prop_assert_eq!(&parsed[0].name, &name);
            prop_assert_eq!(&parsed[0].severity, &severity.to_string());
        }

        /// All valid rules pass validation
        #[test]
        fn prop_valid_rules_pass_validation(
            id in "[a-z]{3,10}-[0-9]{3}",
            name in "[A-Za-z ]{5,30}",
            severity in prop_oneof![Just("info"), Just("warning"), Just("critical")],
            max_cpu in 1.0f32..100.0f32,
        ) {
            let rule = DetectionRule {
                id,
                name,
                description: "Auto-generated".into(),
                severity: severity.to_string(),
                match_block: MatchBlock {
                    resource_threshold: Some(ResourcePattern {
                        max_cpu_percent: Some(max_cpu),
                        max_memory_bytes: None,
                    }),
                    ..Default::default()
                },
                conditions: None,
            };
            prop_assert!(validate_rule(&rule).is_ok());
        }
    }
}
