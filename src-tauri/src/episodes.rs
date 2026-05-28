//! Episode evaluator for V1 emotional model (M3).
//!
//! An *episode* is a named, time-bounded emotional state that overrides
//! default behaviour. Episodes are triggered by patterns of mood + recent
//! events, and they emit `kuro:episode-start` / `kuro:episode-end` events
//! the frontend uses to drive locomotion, expression, and dialogue.
//!
//! V1 episodes (provisional — final list locked in design spec):
//!
//! | Episode    | Trigger                                              |
//! |------------|------------------------------------------------------|
//! | withdrawn  | Manual DND toggle on                                 |
//! | clingy     | High `attention_hunger` + low recent interaction     |
//! | pouty      | Ignored a positive milestone or greeting             |
//! | gleeful    | Headpat after long absence; new peak WPM             |
//! | huffy      | Click-spam recently                                  |
//! | jealous    | Long stretch on messaging/social with no work mix    |
//!
//! Triggers in this file are intentionally minimal scaffolding. Tuning
//! belongs in the design spec.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use crate::mood::MoodVector;

/// Maximum episodes remembered for cooldown enforcement.
const HISTORY_CAP: usize = 64;

/// Default cooldown — same episode won't fire twice within this many seconds.
const DEFAULT_COOLDOWN_SECS: u64 = 30 * 60;

/// Manual override episodes (DND) ignore cooldown.
fn cooldown_for(name: &str) -> u64 {
    match name {
        "withdrawn" => 0, // user-controlled
        "huffy" => 5 * 60,
        "gleeful" => 10 * 60,
        _ => DEFAULT_COOLDOWN_SECS,
    }
}

/// Default duration in seconds for a triggered episode.
fn duration_for(name: &str) -> u64 {
    match name {
        "withdrawn" => 0, // user-controlled — ends on DND release
        "clingy" => 4 * 60,
        "pouty" => 3 * 60,
        "gleeful" => 30,
        "huffy" => 60,
        "jealous" => 5 * 60,
        _ => 60,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExitReason {
    DurationElapsed,
    Manual,
    Superseded,
}

#[derive(Debug, Clone, Serialize)]
pub struct EpisodeStartEvent {
    pub episode: String,
    pub started_at: u64,
    pub expected_duration_seconds: u64,
    pub trigger_event: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EpisodeEndEvent {
    pub episode: String,
    pub ended_at: u64,
    pub exit_reason: ExitReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeHistoryEntry {
    pub name: String,
    pub started_at: u64,
}

pub struct EpisodeTracker {
    current: Option<ActiveEpisode>,
    history: VecDeque<EpisodeHistoryEntry>,
}

#[derive(Debug, Clone)]
struct ActiveEpisode {
    name: String,
    started_at: u64,
    expected_duration_seconds: u64,
}

/// Inputs the evaluator looks at on each tick. Kept as a struct so the
/// signature doesn't grow whenever a new heuristic is added.
pub struct EvaluatorInputs<'a> {
    pub now_unix_seconds: u64,
    pub mood: &'a MoodVector,
    /// Current activity classification. Wired through from the polling loop;
    /// the design-spec triggers for `jealous` (messaging-heavy) and
    /// activity-aware variants of `pouty`/`huffy` will read it. Not yet
    /// consumed by `evaluate_triggers`.
    #[allow(dead_code)]
    pub current_activity: &'a str,
    pub session_distracted_minutes: u32,
    pub session_coding_minutes: u32,
    pub minutes_since_last_interaction: u32,
}

impl EpisodeTracker {
    pub fn new() -> Self {
        Self {
            current: None,
            history: VecDeque::new(),
        }
    }

    /// Read current episode name and start time, if any.
    pub fn current(&self) -> Option<(String, u64, u64)> {
        self.current
            .as_ref()
            .map(|e| (e.name.clone(), e.started_at, e.expected_duration_seconds))
    }

    /// Force-trigger an episode (used by debug controls and DND toggle).
    pub fn force_start(&mut self, name: &str, now: u64, trigger: Option<&str>) -> EpisodeStartEvent {
        let ended = self.end_current(now, ExitReason::Superseded);
        let _ = ended;
        let active = ActiveEpisode {
            name: name.to_string(),
            started_at: now,
            expected_duration_seconds: duration_for(name),
        };
        let event = EpisodeStartEvent {
            episode: active.name.clone(),
            started_at: active.started_at,
            expected_duration_seconds: active.expected_duration_seconds,
            trigger_event: trigger.map(|t| t.to_string()),
        };
        self.push_history(&active);
        self.current = Some(active);
        event
    }

    /// Manually end the current episode. Returns the end event if an
    /// episode was active.
    pub fn force_end(&mut self, now: u64) -> Option<EpisodeEndEvent> {
        self.end_current(now, ExitReason::Manual)
    }

    /// Tick the evaluator. Returns any episode-start or episode-end events.
    /// Called from the 60s polling tick.
    pub fn tick(
        &mut self,
        inputs: &EvaluatorInputs,
    ) -> (Option<EpisodeEndEvent>, Option<EpisodeStartEvent>) {
        let mut end_event = None;

        // 1. Expire current episode if its duration is up.
        if let Some(active) = &self.current {
            let is_user_controlled = active.expected_duration_seconds == 0;
            let elapsed = inputs.now_unix_seconds.saturating_sub(active.started_at);
            if !is_user_controlled && elapsed >= active.expected_duration_seconds {
                end_event = self.end_current(inputs.now_unix_seconds, ExitReason::DurationElapsed);
            }
        }

        // 2. If still in an episode, do not evaluate triggers — one at a time.
        if self.current.is_some() {
            return (end_event, None);
        }

        // 3. Evaluate triggers in priority order. First match wins.
        let candidate = self.evaluate_triggers(inputs);
        if let Some((name, trigger)) = candidate {
            if self.is_on_cooldown(&name, inputs.now_unix_seconds) {
                return (end_event, None);
            }
            let event = self.force_start(&name, inputs.now_unix_seconds, Some(&trigger));
            return (end_event, Some(event));
        }

        (end_event, None)
    }

    fn evaluate_triggers(&self, inputs: &EvaluatorInputs) -> Option<(String, String)> {
        let m = inputs.mood;

        // huffy — sharp annoyance spike, recent
        if m.annoyance > 0.75 {
            return Some(("huffy".to_string(), "annoyance_spike".to_string()));
        }

        // gleeful — high affection + high energy, fresh
        if m.affection > 0.85 && m.energy > 0.7 {
            return Some(("gleeful".to_string(), "affection_high".to_string()));
        }

        // jealous — sustained distracted activity dwarfs coding
        if inputs.session_distracted_minutes > 30
            && inputs.session_distracted_minutes > inputs.session_coding_minutes * 2
        {
            return Some(("jealous".to_string(), "distracted_majority".to_string()));
        }

        // pouty — moderate annoyance + low affection, ignored a while
        if m.annoyance > 0.55 && m.affection < 0.4 && inputs.minutes_since_last_interaction > 15 {
            return Some(("pouty".to_string(), "ignored_and_grumpy".to_string()));
        }

        // clingy — high attention hunger + low interaction
        if m.attention_hunger > 0.75 && inputs.minutes_since_last_interaction > 20 {
            return Some(("clingy".to_string(), "attention_starved".to_string()));
        }

        None
    }

    fn is_on_cooldown(&self, name: &str, now: u64) -> bool {
        let cooldown = cooldown_for(name);
        if cooldown == 0 {
            return false;
        }
        self.history
            .iter()
            .filter(|e| e.name == name)
            .any(|e| now.saturating_sub(e.started_at) < cooldown)
    }

    fn push_history(&mut self, active: &ActiveEpisode) {
        self.history.push_back(EpisodeHistoryEntry {
            name: active.name.clone(),
            started_at: active.started_at,
        });
        while self.history.len() > HISTORY_CAP {
            self.history.pop_front();
        }
    }

    fn end_current(&mut self, now: u64, reason: ExitReason) -> Option<EpisodeEndEvent> {
        self.current.take().map(|active| EpisodeEndEvent {
            episode: active.name,
            ended_at: now,
            exit_reason: reason,
        })
    }

    /// Snapshot of the in-memory episode history. Will be consumed by
    /// `KuroProfile` persistence (`episode_history`, see backend.md) so
    /// cooldowns survive restarts. Not yet called by the persistence path.
    #[allow(dead_code)]
    pub fn history(&self) -> Vec<EpisodeHistoryEntry> {
        self.history.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn baseline_inputs<'a>(mood: &'a MoodVector) -> EvaluatorInputs<'a> {
        EvaluatorInputs {
            now_unix_seconds: 1_000_000,
            mood,
            current_activity: "coding",
            session_distracted_minutes: 0,
            session_coding_minutes: 30,
            minutes_since_last_interaction: 5,
        }
    }

    #[test]
    fn no_episode_at_baseline() {
        let mood = MoodVector::baseline();
        let inputs = baseline_inputs(&mood);
        let mut t = EpisodeTracker::new();
        let (_, start) = t.tick(&inputs);
        assert!(start.is_none());
    }

    #[test]
    fn high_annoyance_triggers_huffy() {
        let mut mood = MoodVector::baseline();
        mood.annoyance = 0.9;
        let inputs = baseline_inputs(&mood);
        let mut t = EpisodeTracker::new();
        let (_, start) = t.tick(&inputs);
        assert!(start.is_some());
        assert_eq!(start.unwrap().episode, "huffy");
    }

    #[test]
    fn force_start_overrides_current() {
        let mut t = EpisodeTracker::new();
        t.force_start("withdrawn", 100, Some("dnd_on"));
        assert_eq!(t.current().unwrap().0, "withdrawn");
        t.force_start("gleeful", 200, None);
        assert_eq!(t.current().unwrap().0, "gleeful");
    }

    #[test]
    fn duration_elapsed_emits_end() {
        let mut t = EpisodeTracker::new();
        t.force_start("huffy", 100, None); // duration 60s
        let mood = MoodVector::baseline();
        let mut inputs = baseline_inputs(&mood);
        inputs.now_unix_seconds = 200;
        let (end, _) = t.tick(&inputs);
        assert!(end.is_some());
        assert_eq!(end.unwrap().episode, "huffy");
    }

    #[test]
    fn cooldown_prevents_immediate_retrigger() {
        let mut mood = MoodVector::baseline();
        mood.annoyance = 0.9;
        let mut t = EpisodeTracker::new();
        let mut inputs = baseline_inputs(&mood);

        let (_, first) = t.tick(&inputs);
        assert!(first.is_some());

        // Episode ends after duration, but cooldown should still block re-trigger.
        inputs.now_unix_seconds += 200; // huffy duration is 60s
        let (_end, _maybe) = t.tick(&inputs);
        // Try again right after end — should be on cooldown.
        inputs.now_unix_seconds += 5;
        let (_, retry) = t.tick(&inputs);
        assert!(retry.is_none());
    }

    #[test]
    fn dnd_episode_ignores_cooldown() {
        let mut t = EpisodeTracker::new();
        t.force_start("withdrawn", 100, Some("dnd_on"));
        t.force_end(200);
        // Re-engage immediately
        t.force_start("withdrawn", 201, Some("dnd_on"));
        assert_eq!(t.current().unwrap().0, "withdrawn");
    }
}
