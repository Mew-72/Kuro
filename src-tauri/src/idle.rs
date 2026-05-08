use std::sync::atomic::Ordering;
use std::sync::Arc;

use crate::typing::TypingState;

/// Returns the number of seconds since the last keyboard/mouse input.
pub fn get_idle_seconds(state: &Arc<TypingState>) -> u64 {
    let last_ms = state.last_input_epoch_ms.load(Ordering::Relaxed);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    now_ms.saturating_sub(last_ms) / 1000
}

/// Idle detection state machine.
///
/// Tracks previous idle status and detects transitions for emitting events.
pub struct IdleTracker {
    pub previous_idle_seconds: u64,
    pub was_sleeping: bool,
    pub was_wandering: bool,
}

impl IdleTracker {
    pub fn new() -> Self {
        Self {
            previous_idle_seconds: 0,
            was_sleeping: false,
            was_wandering: false,
        }
    }

    /// Evaluate idle state. Returns an event to emit, if any.
    pub fn tick(&mut self, idle_seconds: u64) -> Option<IdleEvent> {
        let event;

        // User just returned from being away
        if self.previous_idle_seconds > 300 && idle_seconds < 10 {
            event = Some(IdleEvent::Returned {
                was_gone_minutes: self.previous_idle_seconds / 60,
            });
            self.was_sleeping = false;
            self.was_wandering = false;
        }
        // Deep idle — wandering territory (30+ minutes)
        else if idle_seconds > 1800 && !self.was_wandering {
            event = Some(IdleEvent::Wandering {
                seconds: idle_seconds,
            });
            self.was_wandering = true;
        }
        // Sleeping territory (10+ minutes)
        else if idle_seconds > 600 && !self.was_sleeping {
            event = Some(IdleEvent::Sleeping {
                seconds: idle_seconds,
            });
            self.was_sleeping = true;
        } else {
            event = None;
        }

        self.previous_idle_seconds = idle_seconds;
        event
    }
}

/// Events produced by idle detection.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum IdleEvent {
    Sleeping { seconds: u64 },
    Wandering { seconds: u64 },
    Returned { was_gone_minutes: u64 },
}
