use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use rdev::{listen, EventType};

/// Shared state for typing speed tracking.
/// `current_wpm` is updated every time a key is pressed.
/// `last_input_epoch_ms` is updated on ANY input event (key, mouse, button)
/// and is consumed by idle detection.
pub struct TypingState {
    pub current_wpm: Arc<AtomicU32>,
    pub last_input_epoch_ms: Arc<AtomicU64>,
}

impl TypingState {
    pub fn new() -> Self {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Self {
            current_wpm: Arc::new(AtomicU32::new(0)),
            last_input_epoch_ms: Arc::new(AtomicU64::new(now_ms)),
        }
    }
}

/// Start the global input listener in a dedicated background thread.
///
/// This uses `rdev::listen` to capture ALL keyboard and mouse events
/// system-wide. It maintains a rolling 60-second window of keypresses
/// to calculate WPM, and updates the last-input timestamp on any event.
///
/// **Must be called from a spawned thread** — `rdev::listen` blocks forever.
pub fn start_input_listener(state: Arc<TypingState>) {
    let wpm = state.current_wpm.clone();
    let last_input = state.last_input_epoch_ms.clone();

    // We track the boot instant and keypress instants relative to it
    // to avoid issues with system clock changes.
    let boot = Instant::now();
    let mut keypress_offsets: VecDeque<u64> = VecDeque::new(); // ms since boot

    let result = listen(move |event| {
        let now = Instant::now();
        let now_ms_since_boot = now.duration_since(boot).as_millis() as u64;
        let now_epoch_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        // Update last input time on ANY event type
        match event.event_type {
            EventType::KeyPress(_)
            | EventType::MouseMove { .. }
            | EventType::ButtonPress(_)
            | EventType::Wheel { .. } => {
                last_input.store(now_epoch_ms, Ordering::Relaxed);
            }
            _ => {}
        }

        // Only count keypresses for WPM
        if let EventType::KeyPress(_) = event.event_type {
            keypress_offsets.push_back(now_ms_since_boot);

            // Keep only keypresses from the last 60 seconds
            let cutoff = now_ms_since_boot.saturating_sub(60_000);
            while keypress_offsets.front().map_or(false, |&t| t < cutoff) {
                keypress_offsets.pop_front();
            }

            // WPM = (keypresses in last 60s) / 5
            // Average word is ~5 keystrokes
            let calculated_wpm = keypress_offsets.len() as u32 / 5;
            wpm.store(calculated_wpm, Ordering::Relaxed);
        }
    });

    if let Err(e) = result {
        log::error!("[Kuro] rdev listener error: {:?}", e);
    }
}
