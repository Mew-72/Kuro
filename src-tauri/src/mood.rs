//! Mood substrate for V1 emotional model (M3).
//!
//! Mood is a vector of continuous floats in `[0.0, 1.0]` that drift toward
//! a baseline over time and are mutated by telemetry events. Mood feeds
//! the episode evaluator and biases the dialogue dispatcher on the frontend.
//!
//! The starter dimension set is intentionally small. The V1 design spec
//! will lock the final set by listing desired episodes and reverse-
//! engineering the dimensions they need to draw from. Dimensions added
//! here today should be considered provisional.

use serde::{Deserialize, Serialize};

/// Provisional dimension set for V1. See `.kiro/steering/product.md`
/// (deferred decisions) — final set is a design-spec call.
///
/// All values are clamped to `[0.0, 1.0]` and decay toward `baseline()`
/// over time. They are mutated by `apply_*` methods; nothing external
/// should write the fields directly.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MoodVector {
    /// Warmth toward the user. Headpats raise it, being ignored decays it.
    pub affection: f32,
    /// Frustration. Distracted activity, click-spam, ignored greetings.
    pub annoyance: f32,
    /// "Pet me, talk to me" pressure. Rises with quiet, falls with interaction.
    pub attention_hunger: f32,
    /// Energy / liveliness. Falls late at night, rises after rest.
    pub energy: f32,
}

impl Default for MoodVector {
    fn default() -> Self {
        Self::baseline()
    }
}

impl MoodVector {
    /// The baseline mood every dimension drifts toward when nothing happens.
    pub const fn baseline() -> Self {
        Self {
            affection: 0.55,
            annoyance: 0.10,
            attention_hunger: 0.35,
            energy: 0.65,
        }
    }

    /// Pull every dimension toward baseline by `rate` (0..1).
    /// Called from the polling loop on the mood-decay tick.
    pub fn decay_toward_baseline(&mut self, rate: f32) {
        let b = Self::baseline();
        self.affection += (b.affection - self.affection) * rate;
        self.annoyance += (b.annoyance - self.annoyance) * rate;
        self.attention_hunger += (b.attention_hunger - self.attention_hunger) * rate;
        self.energy += (b.energy - self.energy) * rate;
        self.clamp();
    }

    /// Clamp every dimension to `[0.0, 1.0]`. Called after every mutation.
    pub fn clamp(&mut self) {
        self.affection = self.affection.clamp(0.0, 1.0);
        self.annoyance = self.annoyance.clamp(0.0, 1.0);
        self.attention_hunger = self.attention_hunger.clamp(0.0, 1.0);
        self.energy = self.energy.clamp(0.0, 1.0);
    }

    // --- Mutators (event hooks) ---
    //
    // These are intentionally small and explicit. Each maps a single
    // telemetry event to a small mood delta. Tuning happens in the
    // design spec; the values here are starting points.

    /// User interacted positively (click, headpat-equivalent).
    pub fn on_positive_interaction(&mut self) {
        self.affection += 0.08;
        self.attention_hunger -= 0.20;
        self.annoyance -= 0.05;
        self.clamp();
    }

    /// User clicked her many times in a short window.
    pub fn on_click_spam(&mut self) {
        self.annoyance += 0.15;
        self.clamp();
    }

    /// One minute of focused coding activity ticked.
    pub fn on_focus_tick(&mut self) {
        // She likes seeing the user work, mildly. Attention need rises slowly.
        self.affection += 0.005;
        self.attention_hunger += 0.01;
        self.clamp();
    }

    /// One minute of distracted activity (twitter, reels, etc.) ticked.
    pub fn on_distraction_tick(&mut self) {
        self.annoyance += 0.02;
        self.affection -= 0.005;
        self.clamp();
    }

    /// One minute idle.
    pub fn on_idle_tick(&mut self) {
        self.attention_hunger += 0.015;
        self.clamp();
    }

    /// User came back after a long away period.
    pub fn on_user_returned(&mut self, gone_minutes: u64) {
        let factor = (gone_minutes as f32 / 30.0).min(1.5);
        self.attention_hunger -= 0.30 * factor;
        // Mixed feelings — happy + slightly annoyed at being left.
        self.affection += 0.05;
        self.annoyance += 0.05 * factor;
        self.clamp();
    }

    /// Late-night hour while the user is still active.
    pub fn on_late_night_tick(&mut self) {
        self.energy -= 0.03;
        self.clamp();
    }

    /// User toggled DND on (manual withdrawal request).
    pub fn on_dnd_engaged(&mut self) {
        self.annoyance += 0.10;
        self.affection -= 0.03;
        self.clamp();
    }

    /// User toggled DND off (came back to her).
    pub fn on_dnd_released(&mut self) {
        self.attention_hunger -= 0.10;
        self.clamp();
    }
}

/// Snapshot type for the frontend payload. Mirrors `MoodVector` exactly
/// but lives behind a separate name so the wire format is explicit.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct MoodSnapshot {
    pub affection: f32,
    pub annoyance: f32,
    pub attention_hunger: f32,
    pub energy: f32,
}

impl From<MoodVector> for MoodSnapshot {
    fn from(m: MoodVector) -> Self {
        Self {
            affection: m.affection,
            annoyance: m.annoyance,
            attention_hunger: m.attention_hunger,
            energy: m.energy,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_is_balanced() {
        let m = MoodVector::baseline();
        assert!(m.affection > 0.0 && m.affection < 1.0);
        assert!(m.annoyance < 0.5);
        assert!(m.energy > 0.5);
    }

    #[test]
    fn positive_interaction_raises_affection() {
        let mut m = MoodVector::baseline();
        let before = m.affection;
        m.on_positive_interaction();
        assert!(m.affection > before);
        assert!(m.attention_hunger < MoodVector::baseline().attention_hunger);
    }

    #[test]
    fn decay_pulls_toward_baseline() {
        let mut m = MoodVector::baseline();
        m.affection = 1.0;
        m.decay_toward_baseline(0.5);
        assert!(m.affection < 1.0);
        assert!(m.affection > MoodVector::baseline().affection);
    }

    #[test]
    fn clamp_keeps_values_in_range() {
        let mut m = MoodVector::baseline();
        for _ in 0..100 {
            m.on_positive_interaction();
        }
        assert!(m.affection <= 1.0);
        assert!(m.attention_hunger >= 0.0);
    }

    #[test]
    fn distraction_raises_annoyance() {
        let mut m = MoodVector::baseline();
        let before = m.annoyance;
        for _ in 0..5 {
            m.on_distraction_tick();
        }
        assert!(m.annoyance > before);
    }
}
