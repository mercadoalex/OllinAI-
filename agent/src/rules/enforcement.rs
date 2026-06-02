//! Monitor-only and Enforcement modes for the rule engine.
//!
//! - Monitor mode: log matches, do not terminate pipeline
//! - Enforcement mode: critical matches terminate job immediately, info/warning continue
//! - Emit alert events with: rule ID, matched process, Process_Ancestry chain, severity
//!
//! Requirements: 18.5, 18.6

use super::DetectionAlert;
use crate::mode::AgentMode;
use serde::{Deserialize, Serialize};

/// Action to take after a rule match is evaluated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EnforcementAction {
    /// Log the alert and continue (monitor mode or non-critical severity)
    LogAndContinue,
    /// Terminate the pipeline immediately (enforcement mode + critical severity)
    TerminatePipeline,
}

/// An alert event emitted after rule evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertEvent {
    pub rule_id: String,
    pub rule_name: String,
    pub severity: String,
    pub matched_process_pid: Option<u32>,
    pub matched_process_comm: Option<String>,
    pub process_ancestry_chain: Vec<String>,
    pub action_taken: EnforcementAction,
    pub description: String,
    pub timestamp: u64,
}

/// Enforcement policy: decides what action to take based on mode and alert severity.
#[derive(Debug, Clone)]
pub struct EnforcementPolicy {
    mode: AgentMode,
}

impl EnforcementPolicy {
    pub fn new(mode: AgentMode) -> Self {
        Self { mode }
    }

    /// Update the policy mode (e.g., on config reload).
    pub fn set_mode(&mut self, mode: AgentMode) {
        self.mode = mode;
    }

    /// Get the current mode.
    pub fn mode(&self) -> &AgentMode {
        &self.mode
    }

    /// Determine the enforcement action for a given detection alert.
    pub fn decide_action(&self, alert: &DetectionAlert) -> EnforcementAction {
        match &self.mode {
            AgentMode::MonitorOnly => {
                // Monitor mode: always log, never terminate
                EnforcementAction::LogAndContinue
            }
            AgentMode::Enforcement => {
                // Enforcement mode: critical terminates, others continue
                if alert.severity == "critical" {
                    EnforcementAction::TerminatePipeline
                } else {
                    EnforcementAction::LogAndContinue
                }
            }
            // In other modes (Profiling, CanaryObservation, BaselineBuilding),
            // treat as monitor-only for rule engine purposes
            _ => EnforcementAction::LogAndContinue,
        }
    }

    /// Process a list of alerts and produce alert events with decided actions.
    pub fn process_alerts(&self, alerts: Vec<DetectionAlert>) -> Vec<AlertEvent> {
        alerts
            .into_iter()
            .map(|alert| {
                let action = self.decide_action(&alert);
                AlertEvent {
                    rule_id: alert.rule_id,
                    rule_name: alert.rule_name,
                    severity: alert.severity,
                    matched_process_pid: alert.matched_process_pid,
                    matched_process_comm: alert.matched_process_comm,
                    process_ancestry_chain: alert.process_ancestry_chain,
                    action_taken: action,
                    description: alert.description,
                    timestamp: alert.timestamp,
                }
            })
            .collect()
    }

    /// Check if any of the produced alert events require pipeline termination.
    pub fn should_terminate(events: &[AlertEvent]) -> bool {
        events
            .iter()
            .any(|e| e.action_taken == EnforcementAction::TerminatePipeline)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn make_alert(severity: &str) -> DetectionAlert {
        DetectionAlert {
            rule_id: "test-rule-001".into(),
            rule_name: "Test Rule".into(),
            severity: severity.into(),
            matched_process_pid: Some(42),
            matched_process_comm: Some("malicious".into()),
            process_ancestry_chain: vec!["bash".into(), "npm".into(), "malicious".into()],
            description: "Test alert".into(),
            timestamp: 1000,
        }
    }

    #[test]
    fn test_monitor_mode_never_terminates() {
        let policy = EnforcementPolicy::new(AgentMode::MonitorOnly);
        let alert = make_alert("critical");
        assert_eq!(policy.decide_action(&alert), EnforcementAction::LogAndContinue);
    }

    #[test]
    fn test_enforcement_mode_terminates_critical() {
        let policy = EnforcementPolicy::new(AgentMode::Enforcement);
        let alert = make_alert("critical");
        assert_eq!(
            policy.decide_action(&alert),
            EnforcementAction::TerminatePipeline
        );
    }

    #[test]
    fn test_enforcement_mode_continues_warning() {
        let policy = EnforcementPolicy::new(AgentMode::Enforcement);
        let alert = make_alert("warning");
        assert_eq!(policy.decide_action(&alert), EnforcementAction::LogAndContinue);
    }

    #[test]
    fn test_enforcement_mode_continues_info() {
        let policy = EnforcementPolicy::new(AgentMode::Enforcement);
        let alert = make_alert("info");
        assert_eq!(policy.decide_action(&alert), EnforcementAction::LogAndContinue);
    }

    #[test]
    fn test_process_alerts_mixed() {
        let policy = EnforcementPolicy::new(AgentMode::Enforcement);
        let alerts = vec![
            make_alert("info"),
            make_alert("warning"),
            make_alert("critical"),
        ];
        let events = policy.process_alerts(alerts);
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].action_taken, EnforcementAction::LogAndContinue);
        assert_eq!(events[1].action_taken, EnforcementAction::LogAndContinue);
        assert_eq!(events[2].action_taken, EnforcementAction::TerminatePipeline);
    }

    #[test]
    fn test_should_terminate_with_critical() {
        let policy = EnforcementPolicy::new(AgentMode::Enforcement);
        let alerts = vec![make_alert("info"), make_alert("critical")];
        let events = policy.process_alerts(alerts);
        assert!(EnforcementPolicy::should_terminate(&events));
    }

    #[test]
    fn test_should_not_terminate_without_critical() {
        let policy = EnforcementPolicy::new(AgentMode::Enforcement);
        let alerts = vec![make_alert("info"), make_alert("warning")];
        let events = policy.process_alerts(alerts);
        assert!(!EnforcementPolicy::should_terminate(&events));
    }

    #[test]
    fn test_profiling_mode_never_terminates() {
        let policy = EnforcementPolicy::new(AgentMode::Profiling);
        let alert = make_alert("critical");
        assert_eq!(policy.decide_action(&alert), EnforcementAction::LogAndContinue);
    }

    // Property-based tests
    proptest! {
        /// Monitor mode never terminates regardless of severity
        #[test]
        fn prop_monitor_mode_never_terminates(
            severity in prop_oneof![Just("info"), Just("warning"), Just("critical")],
        ) {
            let policy = EnforcementPolicy::new(AgentMode::MonitorOnly);
            let alert = make_alert(&severity);
            prop_assert_eq!(policy.decide_action(&alert), EnforcementAction::LogAndContinue);
        }

        /// Enforcement mode only terminates on critical
        #[test]
        fn prop_enforcement_terminates_only_critical(
            severity in prop_oneof![Just("info"), Just("warning"), Just("critical")],
        ) {
            let policy = EnforcementPolicy::new(AgentMode::Enforcement);
            let alert = make_alert(&severity);
            let action = policy.decide_action(&alert);
            if severity == "critical" {
                prop_assert_eq!(action, EnforcementAction::TerminatePipeline);
            } else {
                prop_assert_eq!(action, EnforcementAction::LogAndContinue);
            }
        }

        /// Alert events always contain the correct rule_id from the input alert
        #[test]
        fn prop_alert_event_preserves_rule_id(
            rule_id in "[a-z]{3,10}-[0-9]{3}",
            severity in prop_oneof![Just("info"), Just("warning"), Just("critical")],
        ) {
            let policy = EnforcementPolicy::new(AgentMode::Enforcement);
            let mut alert = make_alert(&severity);
            alert.rule_id = rule_id.clone();
            let events = policy.process_alerts(vec![alert]);
            prop_assert_eq!(&events[0].rule_id, &rule_id);
        }
    }
}
