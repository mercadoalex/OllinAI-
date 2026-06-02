//! Telemetry batching and transmission buffer.
//!
//! Implements a ring buffer with 5-minute capacity for local telemetry
//! storage. Events are batched (max 500 per batch) and transmitted within
//! 10 seconds of capture. Retry logic buffers locally for up to 5 minutes,
//! retrying every 30 seconds. On overflow, oldest events are dropped.

use crate::config::AgentConfig;
use crate::telemetry::{TelemetryBatch, TelemetryEvent};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Ring buffer for telemetry events with overflow tracking.
#[derive(Debug, Clone)]
pub struct TelemetryBuffer {
    /// Underlying ring buffer of events
    events: VecDeque<TimestampedEvent>,
    /// Maximum number of events the buffer can hold
    capacity: usize,
    /// Maximum batch size for transmission (capped at 500)
    max_batch_size: usize,
    /// Maximum latency from capture to transmission (default 10s)
    max_transmission_latency: Duration,
    /// Retry interval when collector is unreachable (default 30s)
    retry_interval: Duration,
    /// Maximum buffer time before dropping (default 5 min)
    max_buffer_time: Duration,
    /// Count of events dropped due to overflow since last successful batch
    dropped_event_count: u64,
    /// Total events dropped since agent start
    total_dropped_count: u64,
    /// Timestamp of last successful transmission
    last_transmission: Option<Instant>,
    /// Timestamp of last retry attempt
    last_retry_attempt: Option<Instant>,
    /// Whether the collector is currently reachable
    collector_reachable: bool,
}

/// An event with its capture timestamp for age tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimestampedEvent {
    /// The telemetry event
    pub event: TelemetryEvent,
    /// Capture timestamp (epoch nanoseconds)
    pub captured_at_ns: u64,
}

/// Result of attempting to flush a batch.
#[derive(Debug, Clone)]
pub enum FlushResult {
    /// Batch was successfully created and is ready for transmission
    Ready(TelemetryBatch),
    /// No events ready to flush
    Empty,
    /// Not yet time to flush (within latency window)
    NotReady,
}

/// Status of the buffer for monitoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferStatus {
    /// Current number of buffered events
    pub buffered_count: usize,
    /// Buffer capacity
    pub capacity: usize,
    /// Events dropped since last successful transmission
    pub dropped_since_last_tx: u64,
    /// Total events dropped since agent start
    pub total_dropped: u64,
    /// Whether the collector is reachable
    pub collector_reachable: bool,
    /// Buffer utilization percentage
    pub utilization_percent: f32,
}

impl TelemetryBuffer {
    /// Create a new telemetry buffer from agent configuration.
    pub fn new(config: &AgentConfig) -> Self {
        Self {
            events: VecDeque::with_capacity(config.buffer_capacity),
            capacity: config.buffer_capacity,
            max_batch_size: config.max_batch_size.min(500), // Hard cap at 500
            max_transmission_latency: Duration::from_secs(config.max_transmission_latency_secs),
            retry_interval: Duration::from_secs(config.retry_interval_secs),
            max_buffer_time: Duration::from_secs(config.max_buffer_time_secs),
            dropped_event_count: 0,
            total_dropped_count: 0,
            last_transmission: None,
            last_retry_attempt: None,
            collector_reachable: true,
        }
    }

    /// Create a buffer with explicit parameters (useful for testing).
    pub fn with_params(capacity: usize, max_batch_size: usize) -> Self {
        Self {
            events: VecDeque::with_capacity(capacity),
            capacity,
            max_batch_size: max_batch_size.min(500),
            max_transmission_latency: Duration::from_secs(10),
            retry_interval: Duration::from_secs(30),
            max_buffer_time: Duration::from_secs(300),
            dropped_event_count: 0,
            total_dropped_count: 0,
            last_transmission: None,
            last_retry_attempt: None,
            collector_reachable: true,
        }
    }

    /// Push a new event into the buffer.
    ///
    /// If the buffer is full, drops the oldest event and increments
    /// the drop counter.
    pub fn push(&mut self, event: TelemetryEvent, captured_at_ns: u64) {
        if self.events.len() >= self.capacity {
            // Drop oldest event
            self.events.pop_front();
            self.dropped_event_count += 1;
            self.total_dropped_count += 1;
        }

        self.events.push_back(TimestampedEvent {
            event,
            captured_at_ns,
        });
    }

    /// Get the current number of buffered events.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Check if the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Get the number of events dropped since the last successful transmission.
    pub fn dropped_event_count(&self) -> u64 {
        self.dropped_event_count
    }

    /// Drain up to max_batch_size events from the buffer into a batch.
    ///
    /// Returns the events and the drop count since last batch. Resets
    /// the drop counter after draining.
    pub fn drain_batch(
        &mut self,
        tenant_id: &str,
        service_id: &str,
        pipeline_id: Option<&str>,
        agent_version: &str,
        kernel_version: &str,
        arch: &str,
        degraded_mode: bool,
    ) -> Option<TelemetryBatch> {
        if self.events.is_empty() {
            return None;
        }

        let drain_count = self.events.len().min(self.max_batch_size);
        let drained: Vec<TimestampedEvent> = self.events.drain(..drain_count).collect();

        let events: Vec<TelemetryEvent> = drained.into_iter().map(|te| te.event).collect();
        let dropped = self.dropped_event_count;
        self.dropped_event_count = 0;

        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        Some(TelemetryBatch {
            batch_id: Uuid::new_v4().to_string(),
            tenant_id: tenant_id.to_string(),
            service_id: service_id.to_string(),
            pipeline_id: pipeline_id.map(|s| s.to_string()),
            events,
            dropped_event_count: dropped,
            agent_version: agent_version.to_string(),
            kernel_version: kernel_version.to_string(),
            arch: arch.to_string(),
            degraded_mode,
            created_at_ns: now_ns,
        })
    }

    /// Check if it's time to retry transmission.
    pub fn should_retry(&self, now: Instant) -> bool {
        if self.collector_reachable {
            return false;
        }
        match self.last_retry_attempt {
            Some(last) => now.duration_since(last) >= self.retry_interval,
            None => true,
        }
    }

    /// Check if buffered events have exceeded the maximum buffer time.
    ///
    /// If they have, oldest events should be dropped.
    pub fn has_expired_events(&self, now_ns: u64) -> bool {
        if let Some(oldest) = self.events.front() {
            let age_ns = now_ns.saturating_sub(oldest.captured_at_ns);
            let max_ns = self.max_buffer_time.as_nanos() as u64;
            return age_ns > max_ns;
        }
        false
    }

    /// Drop events older than max_buffer_time, recording drop counts.
    pub fn drop_expired_events(&mut self, now_ns: u64) {
        let max_ns = self.max_buffer_time.as_nanos() as u64;
        let cutoff_ns = now_ns.saturating_sub(max_ns);

        while let Some(oldest) = self.events.front() {
            if oldest.captured_at_ns < cutoff_ns {
                self.events.pop_front();
                self.dropped_event_count += 1;
                self.total_dropped_count += 1;
            } else {
                break;
            }
        }
    }

    /// Mark a transmission as successful.
    pub fn mark_transmission_success(&mut self) {
        self.last_transmission = Some(Instant::now());
        self.collector_reachable = true;
    }

    /// Mark the collector as unreachable (transmission failed).
    pub fn mark_transmission_failure(&mut self) {
        self.last_retry_attempt = Some(Instant::now());
        self.collector_reachable = false;
    }

    /// Get current buffer status for monitoring/reporting.
    pub fn status(&self) -> BufferStatus {
        BufferStatus {
            buffered_count: self.events.len(),
            capacity: self.capacity,
            dropped_since_last_tx: self.dropped_event_count,
            total_dropped: self.total_dropped_count,
            collector_reachable: self.collector_reachable,
            utilization_percent: (self.events.len() as f32 / self.capacity as f32) * 100.0,
        }
    }

    /// Get maximum batch size.
    pub fn max_batch_size(&self) -> usize {
        self.max_batch_size
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::TelemetryEvent;
    use proptest::prelude::*;
    use std::net::IpAddr;
    use std::path::PathBuf;

    fn make_event(pid: u32) -> TelemetryEvent {
        TelemetryEvent::ProcessTree {
            pid,
            ppid: 1,
            comm: "test".to_string(),
            argv: vec![],
            cwd: PathBuf::from("/"),
            timestamp_ns: 1000,
        }
    }

    #[test]
    fn test_push_and_drain() {
        let mut buf = TelemetryBuffer::with_params(100, 500);
        buf.push(make_event(1), 1000);
        buf.push(make_event(2), 2000);
        buf.push(make_event(3), 3000);

        assert_eq!(buf.len(), 3);

        let batch = buf.drain_batch("t1", "svc1", None, "0.1.0", "5.15.0", "x86_64", false);
        assert!(batch.is_some());
        let batch = batch.unwrap();
        assert_eq!(batch.events.len(), 3);
        assert_eq!(batch.dropped_event_count, 0);
        assert_eq!(buf.len(), 0);
    }

    #[test]
    fn test_overflow_drops_oldest() {
        let mut buf = TelemetryBuffer::with_params(3, 500);
        buf.push(make_event(1), 1000);
        buf.push(make_event(2), 2000);
        buf.push(make_event(3), 3000);
        // Buffer is full, this should drop event 1
        buf.push(make_event(4), 4000);

        assert_eq!(buf.len(), 3);
        assert_eq!(buf.dropped_event_count(), 1);

        let batch = buf.drain_batch("t1", "svc1", None, "0.1.0", "5.15.0", "x86_64", false).unwrap();
        assert_eq!(batch.events.len(), 3);
        assert_eq!(batch.dropped_event_count, 1);

        // After drain, drop count resets
        assert_eq!(buf.dropped_event_count(), 0);
    }

    #[test]
    fn test_batch_max_size_capped() {
        let mut buf = TelemetryBuffer::with_params(1000, 500);
        for i in 0..600 {
            buf.push(make_event(i), i as u64 * 1000);
        }

        let batch = buf.drain_batch("t1", "svc1", None, "0.1.0", "5.15.0", "x86_64", false).unwrap();
        // Should only drain 500 (max batch size)
        assert_eq!(batch.events.len(), 500);
        assert_eq!(buf.len(), 100); // 600 - 500
    }

    #[test]
    fn test_max_batch_size_hard_capped_at_500() {
        let buf = TelemetryBuffer::with_params(1000, 9999);
        assert_eq!(buf.max_batch_size(), 500);
    }

    #[test]
    fn test_drain_empty_buffer() {
        let mut buf = TelemetryBuffer::with_params(100, 500);
        let batch = buf.drain_batch("t1", "svc1", None, "0.1.0", "5.15.0", "x86_64", false);
        assert!(batch.is_none());
    }

    #[test]
    fn test_expired_event_detection() {
        let mut buf = TelemetryBuffer::with_params(100, 500);
        // Push event at time 1000 ns
        buf.push(make_event(1), 1_000);

        // 5 minutes = 300_000_000_000 ns. Check at 6 minutes later.
        let now_ns = 360_000_000_000u64;
        assert!(buf.has_expired_events(now_ns));
    }

    #[test]
    fn test_drop_expired_events() {
        let mut buf = TelemetryBuffer::with_params(100, 500);
        buf.push(make_event(1), 1_000);                 // ~0s — will be dropped
        buf.push(make_event(2), 50_000_000_000);        // 50s — will be dropped
        buf.push(make_event(3), 200_000_000_000);       // 200s — kept

        // Drop events older than 5 min (300s) from now = 400s mark
        // cutoff = 400s - 300s = 100s
        let now_ns = 400_000_000_000u64;
        buf.drop_expired_events(now_ns);

        // Events at ~0s and 50s are older than cutoff (100s), so dropped
        assert_eq!(buf.len(), 1);
        assert_eq!(buf.dropped_event_count(), 2);
    }

    #[test]
    fn test_retry_logic() {
        let mut buf = TelemetryBuffer::with_params(100, 500);
        assert!(!buf.should_retry(Instant::now())); // reachable by default

        buf.mark_transmission_failure();
        // Should retry immediately after failure (no last retry yet — except we just set it)
        // After marking failure, last_retry_attempt is set to now, so need to wait retry_interval
        let future = Instant::now() + Duration::from_secs(31);
        assert!(buf.should_retry(future));
    }

    #[test]
    fn test_status_reporting() {
        let mut buf = TelemetryBuffer::with_params(100, 500);
        buf.push(make_event(1), 1000);
        buf.push(make_event(2), 2000);

        let status = buf.status();
        assert_eq!(status.buffered_count, 2);
        assert_eq!(status.capacity, 100);
        assert_eq!(status.dropped_since_last_tx, 0);
        assert!(status.collector_reachable);
        assert!((status.utilization_percent - 2.0).abs() < 0.01);
    }

    // --- Property-based tests ---

    proptest! {
        /// **Validates: Requirements 13.9** - batch size never exceeds 500
        #[test]
        fn prop_batch_never_exceeds_500(
            num_events in 1usize..2000,
            capacity in 100usize..5000,
            max_batch in 1usize..1000,
        ) {
            let mut buf = TelemetryBuffer::with_params(capacity, max_batch);
            for i in 0..num_events {
                buf.push(make_event(i as u32), i as u64 * 1000);
            }

            if let Some(batch) = buf.drain_batch("t", "s", None, "v", "k", "a", false) {
                prop_assert!(batch.events.len() <= 500);
            }
        }

        /// **Validates: Requirements 13.14, 13.15** - overflow drops oldest, records count
        #[test]
        fn prop_overflow_drops_oldest_records_count(
            capacity in 5usize..50,
            overflow_count in 1usize..20,
        ) {
            let mut buf = TelemetryBuffer::with_params(capacity, 500);

            // Fill to capacity
            for i in 0..capacity {
                buf.push(make_event(i as u32), i as u64 * 1000);
            }
            prop_assert_eq!(buf.dropped_event_count(), 0);

            // Add more causing overflow
            for i in 0..overflow_count {
                buf.push(make_event((capacity + i) as u32), (capacity + i) as u64 * 1000);
            }

            prop_assert_eq!(buf.len(), capacity);
            prop_assert_eq!(buf.dropped_event_count(), overflow_count as u64);
        }

        /// **Validates: Requirements 13.9** - total events tracked = pushed - dropped
        #[test]
        fn prop_event_conservation(
            num_events in 1usize..500,
            capacity in 10usize..100,
        ) {
            let mut buf = TelemetryBuffer::with_params(capacity, 500);
            for i in 0..num_events {
                buf.push(make_event(i as u32), i as u64 * 1000);
            }

            let buffered = buf.len();
            let dropped = buf.dropped_event_count() as usize;
            prop_assert_eq!(buffered + dropped, num_events);
        }
    }
}
