use serde::Serialize;

/// Tracks session statistics that reset at midnight.
pub struct SessionTracker {
    pub coding_seconds: u32,
    pub distracted_seconds: u32,
    pub idle_seconds: u32,
    pub current_streak_seconds: u32,
    pub longest_streak_seconds: u32,
    pub peak_wpm_today: u32,
    consecutive_idle_seconds: u32,
    last_activity: String,
    /// Milestones already fired this session, to avoid repeats.
    fired_milestones: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MilestoneEvent {
    pub milestone_type: String,
    /// Optional associated value (e.g. WPM for new_peak_wpm).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<u32>,
}

impl SessionTracker {
    pub fn new() -> Self {
        Self {
            coding_seconds: 0,
            distracted_seconds: 0,
            idle_seconds: 0,
            current_streak_seconds: 0,
            longest_streak_seconds: 0,
            peak_wpm_today: 0,
            consecutive_idle_seconds: 0,
            last_activity: String::new(),
            fired_milestones: Vec::new(),
        }
    }

    /// Called every 60 seconds with the current activity type.
    /// Returns a list of milestone events triggered by this tick.
    pub fn tick(&mut self, current_activity: &str) -> Vec<MilestoneEvent> {
        let mut milestones = Vec::new();

        match current_activity {
            "coding" | "researching" | "learning" => {
                self.coding_seconds += 60;
                self.current_streak_seconds += 60;
                self.consecutive_idle_seconds = 0;

                if self.current_streak_seconds > self.longest_streak_seconds {
                    self.longest_streak_seconds = self.current_streak_seconds;
                }

                // Focus streak milestones
                let streak_min = self.current_streak_seconds / 60;
                if streak_min == 25 && !self.fired_milestones.contains(&"focus_25".to_string()) {
                    milestones.push(MilestoneEvent {
                        milestone_type: "focus_25".to_string(),
                        value: Some(25),
                    });
                    self.fired_milestones.push("focus_25".to_string());
                }
                if streak_min == 60 && !self.fired_milestones.contains(&"focus_60".to_string()) {
                    milestones.push(MilestoneEvent {
                        milestone_type: "focus_60".to_string(),
                        value: Some(60),
                    });
                    self.fired_milestones.push("focus_60".to_string());
                }
                if streak_min == 120 && !self.fired_milestones.contains(&"focus_120".to_string()) {
                    milestones.push(MilestoneEvent {
                        milestone_type: "focus_120".to_string(),
                        value: Some(120),
                    });
                    self.fired_milestones.push("focus_120".to_string());
                }
            }
            "distracted" | "entertainment" => {
                self.distracted_seconds += 60;
                self.current_streak_seconds = 0; // streak broken
                self.consecutive_idle_seconds = 0;

                // Check if distracted > coding today
                if self.distracted_seconds > self.coding_seconds
                    && self.distracted_seconds > 300
                    && !self.fired_milestones.contains(&"distracted_majority".to_string())
                {
                    milestones.push(MilestoneEvent {
                        milestone_type: "distracted_majority".to_string(),
                        value: None,
                    });
                    self.fired_milestones.push("distracted_majority".to_string());
                }
            }
            "idle" => {
                self.idle_seconds += 60;
                self.consecutive_idle_seconds += 60;
                // Don't break streak for short idle (bathroom break etc)
                if self.consecutive_idle_seconds > 300 {
                    self.current_streak_seconds = 0;
                }
            }
            _ => {
                self.consecutive_idle_seconds = 0;
            }
        }

        self.last_activity = current_activity.to_string();
        milestones
    }

    /// Update peak WPM tracker. Returns a milestone if a new peak is set.
    pub fn update_wpm(&mut self, wpm: u32) -> Option<MilestoneEvent> {
        if wpm > self.peak_wpm_today && wpm > 20 {
            // Only count if reasonably above noise
            self.peak_wpm_today = wpm;
            Some(MilestoneEvent {
                milestone_type: "new_peak_wpm".to_string(),
                value: Some(wpm),
            })
        } else {
            None
        }
    }

    /// Reset all session stats (called at midnight).
    pub fn reset(&mut self) {
        self.coding_seconds = 0;
        self.distracted_seconds = 0;
        self.idle_seconds = 0;
        self.current_streak_seconds = 0;
        self.longest_streak_seconds = 0;
        self.peak_wpm_today = 0;
        self.consecutive_idle_seconds = 0;
        self.last_activity.clear();
        self.fired_milestones.clear();
    }

    // Convenience accessors in minutes
    pub fn coding_minutes(&self) -> u32 {
        self.coding_seconds / 60
    }
    pub fn distracted_minutes(&self) -> u32 {
        self.distracted_seconds / 60
    }
    pub fn idle_minutes(&self) -> u32 {
        self.idle_seconds / 60
    }
    pub fn focus_streak_minutes(&self) -> u32 {
        self.current_streak_seconds / 60
    }
    pub fn longest_streak_minutes(&self) -> u32 {
        self.longest_streak_seconds / 60
    }
}
