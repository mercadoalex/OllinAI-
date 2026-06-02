//! Process ancestry tree tracking.
//!
//! Maintains an in-memory process tree built from fork/exec events captured
//! by eBPF probes. Used for supply chain detection (credential access from
//! package installer descendants) and Build_Attestation generation.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// A single node in the process ancestry tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessNode {
    /// Process ID
    pub pid: u32,
    /// Parent process ID
    pub ppid: u32,
    /// Command name (e.g., "npm", "node")
    pub comm: String,
    /// Command arguments
    pub argv: Vec<String>,
    /// Working directory at exec time
    pub cwd: PathBuf,
    /// Child PIDs
    pub children: Vec<u32>,
    /// Process start time (nanosecond timestamp)
    pub start_time: u64,
}

/// Process ancestry tree — maintains full parent-child relationships
/// for all observed processes during a pipeline execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessAncestry {
    /// All known processes indexed by PID
    processes: HashMap<u32, ProcessNode>,
    /// Root process PID (typically the pipeline shell)
    root_pid: u32,
}

impl ProcessAncestry {
    /// Create a new empty process ancestry tree with the given root PID.
    pub fn new(root_pid: u32) -> Self {
        Self {
            processes: HashMap::new(),
            root_pid,
        }
    }

    /// Get the root PID.
    pub fn root_pid(&self) -> u32 {
        self.root_pid
    }

    /// Get the total number of tracked processes.
    pub fn process_count(&self) -> usize {
        self.processes.len()
    }

    /// Record a new process from a fork/exec event.
    ///
    /// Automatically updates the parent's children list if the parent is tracked.
    pub fn record_process(
        &mut self,
        pid: u32,
        ppid: u32,
        comm: String,
        argv: Vec<String>,
        cwd: PathBuf,
        start_time: u64,
    ) {
        // Update parent's children list
        if let Some(parent) = self.processes.get_mut(&ppid) {
            if !parent.children.contains(&pid) {
                parent.children.push(pid);
            }
        }

        let node = ProcessNode {
            pid,
            ppid,
            comm,
            argv,
            cwd,
            children: Vec::new(),
            start_time,
        };

        self.processes.insert(pid, node);
    }

    /// Look up a process by PID.
    pub fn get_process(&self, pid: u32) -> Option<&ProcessNode> {
        self.processes.get(&pid)
    }

    /// Get the full ancestry chain for a given PID, from the process
    /// up to the root. Returns an ordered vec starting from the given PID
    /// and walking up through parents.
    ///
    /// Returns an empty vec if the PID is not tracked.
    pub fn get_ancestry_chain(&self, pid: u32) -> Vec<&ProcessNode> {
        let mut chain = Vec::new();
        let mut current_pid = pid;

        // Walk up the tree until we hit the root or a process not in the tree.
        // Limit iterations to prevent infinite loops from malformed data.
        let max_depth = self.processes.len();
        let mut depth = 0;

        while depth < max_depth {
            if let Some(node) = self.processes.get(&current_pid) {
                chain.push(node);
                if current_pid == self.root_pid || node.ppid == current_pid {
                    break;
                }
                current_pid = node.ppid;
            } else {
                break;
            }
            depth += 1;
        }

        chain
    }

    /// Get all direct children of a process.
    pub fn get_children(&self, pid: u32) -> Vec<&ProcessNode> {
        match self.processes.get(&pid) {
            Some(node) => node
                .children
                .iter()
                .filter_map(|child_pid| self.processes.get(child_pid))
                .collect(),
            None => Vec::new(),
        }
    }

    /// Get all descendant PIDs of a process (recursive).
    pub fn get_descendants(&self, pid: u32) -> Vec<u32> {
        let mut descendants = Vec::new();
        let mut stack = vec![pid];

        while let Some(current) = stack.pop() {
            if let Some(node) = self.processes.get(&current) {
                for &child_pid in &node.children {
                    descendants.push(child_pid);
                    stack.push(child_pid);
                }
            }
        }

        descendants
    }

    /// Check if a given PID has an ancestor matching a predicate.
    ///
    /// Walks up the tree from the given PID, checking each ancestor.
    pub fn has_ancestor<F>(&self, pid: u32, predicate: F) -> bool
    where
        F: Fn(&ProcessNode) -> bool,
    {
        let chain = self.get_ancestry_chain(pid);
        // Skip the first entry (the process itself) and check ancestors
        chain.iter().skip(1).any(|node| predicate(node))
    }

    /// Get an iterator over all processes in the tree.
    pub fn iter_processes(&self) -> impl Iterator<Item = (&u32, &ProcessNode)> {
        self.processes.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// Build a simple test tree:
    /// root(1) -> shell(2) -> npm(3) -> node(4)
    fn build_test_tree() -> ProcessAncestry {
        let mut tree = ProcessAncestry::new(1);
        tree.record_process(1, 0, "init".into(), vec![], PathBuf::from("/"), 1000);
        tree.record_process(2, 1, "bash".into(), vec!["-c".into(), "npm install".into()], PathBuf::from("/app"), 2000);
        tree.record_process(3, 2, "npm".into(), vec!["install".into()], PathBuf::from("/app"), 3000);
        tree.record_process(4, 3, "node".into(), vec!["script.js".into()], PathBuf::from("/app"), 4000);
        tree
    }

    #[test]
    fn test_record_and_lookup() {
        let tree = build_test_tree();
        assert_eq!(tree.process_count(), 4);

        let node = tree.get_process(3).unwrap();
        assert_eq!(node.comm, "npm");
        assert_eq!(node.ppid, 2);
    }

    #[test]
    fn test_ancestry_chain() {
        let tree = build_test_tree();
        let chain = tree.get_ancestry_chain(4);

        assert_eq!(chain.len(), 4);
        assert_eq!(chain[0].pid, 4); // node
        assert_eq!(chain[1].pid, 3); // npm
        assert_eq!(chain[2].pid, 2); // bash
        assert_eq!(chain[3].pid, 1); // init (root)
    }

    #[test]
    fn test_ancestry_chain_nonexistent_pid() {
        let tree = build_test_tree();
        let chain = tree.get_ancestry_chain(999);
        assert!(chain.is_empty());
    }

    #[test]
    fn test_get_children() {
        let tree = build_test_tree();
        let children = tree.get_children(1);
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].pid, 2);
    }

    #[test]
    fn test_get_descendants() {
        let tree = build_test_tree();
        let descendants = tree.get_descendants(1);
        assert_eq!(descendants.len(), 3); // 2, 3, 4
        assert!(descendants.contains(&2));
        assert!(descendants.contains(&3));
        assert!(descendants.contains(&4));
    }

    #[test]
    fn test_has_ancestor() {
        let tree = build_test_tree();
        // node(4) should have npm(3) as ancestor
        assert!(tree.has_ancestor(4, |n| n.comm == "npm"));
        // node(4) should not have "pip" as ancestor
        assert!(!tree.has_ancestor(4, |n| n.comm == "pip"));
    }

    #[test]
    fn test_parent_children_updated() {
        let tree = build_test_tree();
        let root = tree.get_process(1).unwrap();
        assert!(root.children.contains(&2));

        let npm = tree.get_process(3).unwrap();
        assert!(npm.children.contains(&4));
    }

    // --- Property-based tests ---

    prop_compose! {
        fn arb_process_node()(
            pid in 1u32..10000,
            ppid in 0u32..10000,
            comm in "[a-z]{1,10}",
            start_time in 0u64..u64::MAX,
        ) -> (u32, u32, String, u64) {
            (pid, ppid, comm, start_time)
        }
    }

    proptest! {
        #[test]
        fn prop_recorded_process_is_retrievable(
            pid in 1u32..10000,
            comm in "[a-z]{1,10}",
        ) {
            let mut tree = ProcessAncestry::new(0);
            tree.record_process(pid, 0, comm.clone(), vec![], PathBuf::from("/"), 1000);
            let node = tree.get_process(pid).unwrap();
            prop_assert_eq!(&node.comm, &comm);
            prop_assert_eq!(node.pid, pid);
        }

        #[test]
        fn prop_ancestry_chain_starts_with_self(
            pid in 1u32..1000,
        ) {
            let mut tree = ProcessAncestry::new(1);
            tree.record_process(1, 0, "root".into(), vec![], PathBuf::from("/"), 100);
            tree.record_process(pid.max(2), 1, "child".into(), vec![], PathBuf::from("/"), 200);

            let target = pid.max(2);
            let chain = tree.get_ancestry_chain(target);
            prop_assert!(!chain.is_empty());
            prop_assert_eq!(chain[0].pid, target);
        }

        #[test]
        fn prop_ancestry_chain_ends_at_root_or_boundary(
            depth in 2u32..20,
        ) {
            let mut tree = ProcessAncestry::new(1);
            tree.record_process(1, 0, "root".into(), vec![], PathBuf::from("/"), 100);

            for i in 2..=depth {
                tree.record_process(i, i - 1, format!("proc{}", i), vec![], PathBuf::from("/"), i as u64 * 100);
            }

            let chain = tree.get_ancestry_chain(depth);
            let last = chain.last().unwrap();
            // Last node should be root (pid 1)
            prop_assert_eq!(last.pid, 1);
        }

        #[test]
        fn prop_descendants_dont_include_self(
            num_children in 1u32..10,
        ) {
            let mut tree = ProcessAncestry::new(1);
            tree.record_process(1, 0, "root".into(), vec![], PathBuf::from("/"), 100);

            for i in 2..=num_children + 1 {
                tree.record_process(i, 1, format!("child{}", i), vec![], PathBuf::from("/"), i as u64 * 100);
            }

            let descendants = tree.get_descendants(1);
            prop_assert!(!descendants.contains(&1));
            prop_assert_eq!(descendants.len() as u32, num_children);
        }
    }
}
