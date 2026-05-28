use serde::{Deserialize, Serialize};

use crate::mood::MoodSnapshot;

/// The full context object emitted to frontend every 3 seconds.
///
/// V1 adds `mood` and `current_episode` to carry the new emotional model.
/// Cat-era fields (e.g. `total_headpats`) are gone; if you need a count,
/// reach for the new `total_interactions` accumulator on the profile.
#[derive(Serialize, Clone, Debug)]
pub struct KuroContext {
    // Identity
    pub user_name: String,
    pub device_name: String,
    pub days_since_first_met: u32,

    // Current activity
    pub current_app: String,
    pub current_window_title: String,
    /// "coding" | "distracted" | "learning" | "researching" | "entertainment"
    /// | "music" | "gaming" | "idle" | "unknown"
    pub activity_type: String,

    // Typing
    pub current_wpm: u32,
    pub peak_wpm_today: u32,

    // Session stats (resets at midnight)
    pub session_coding_minutes: u32,
    pub session_distracted_minutes: u32,
    pub session_idle_minutes: u32,
    pub focus_streak_minutes: u32,
    pub longest_streak_today: u32,

    // System health
    pub battery_percent: u8,
    pub is_charging: bool,
    pub cpu_percent: f32,
    pub ram_percent: f32,
    pub open_window_count: u32,

    // Time context
    pub hour: u32,
    pub is_weekend: bool,
    /// "morning"|"afternoon"|"evening"|"night"|"late_night"|"dead_hours"
    pub time_of_day: String,

    // V1 emotional model (M3)
    pub mood: MoodSnapshot,
    /// Snake-case episode name, or `None` when no episode is active.
    pub current_episode: Option<String>,
    /// Unix seconds when the current episode began. `None` when idle.
    pub episode_started_at: Option<u64>,

    // Lifetime stats
    pub total_days_active: u32,
    pub total_coding_hours: u32,
    pub total_interactions: u32,
}

/// Stored permanently in kuro-profile.json.
///
/// Note for migration: any v0 profile on disk is read by `profile::init_profile`
/// with `serde(default)` semantics — missing fields fill with defaults.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KuroProfile {
    pub user_name: String,
    pub device_name: String,
    pub first_launch: String, // ISO date string "YYYY-MM-DD"
    #[serde(default = "default_one")]
    pub total_days_active: u32,
    #[serde(default)]
    pub total_coding_hours: u32,
    /// Counts every direct interaction (click/headpat-equivalent).
    /// Replaces v0 `total_headpats`.
    #[serde(default, alias = "total_headpats")]
    pub total_interactions: u32,
    #[serde(default)]
    pub favorite_app: String,
    #[serde(default)]
    pub peak_wpm_ever: u32,
    /// In minutes.
    #[serde(default)]
    pub longest_streak_ever: u32,
}

fn default_one() -> u32 {
    1
}

/// Map an hour (0–23) to a human-readable time-of-day label.
pub fn time_of_day(hour: u32) -> &'static str {
    match hour {
        6..=11 => "morning",
        12..=16 => "afternoon",
        17..=20 => "evening",
        21..=23 => "night",
        0..=2 => "late_night",
        3..=5 => "dead_hours",
        _ => "unknown",
    }
}
