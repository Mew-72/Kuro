/**
 * Shared types for the V1 character runtime.
 *
 * These mirror the Rust event payload shapes from `src-tauri/src/context.rs`
 * and friends. When a payload changes on the Rust side, update this file in
 * the same commit per the rule in `.kiro/steering/backend.md`.
 */

export interface MoodSnapshot {
    affection: number;
    annoyance: number;
    attention_hunger: number;
    energy: number;
}

export interface KuroContext {
    user_name: string;
    device_name: string;
    days_since_first_met: number;
    current_app: string;
    current_window_title: string;
    activity_type: ActivityType;
    current_wpm: number;
    peak_wpm_today: number;
    session_coding_minutes: number;
    session_distracted_minutes: number;
    session_idle_minutes: number;
    focus_streak_minutes: number;
    longest_streak_today: number;
    battery_percent: number;
    is_charging: boolean;
    cpu_percent: number;
    ram_percent: number;
    open_window_count: number;
    hour: number;
    is_weekend: boolean;
    time_of_day: TimeOfDay;
    mood: MoodSnapshot;
    current_episode: EpisodeName | null;
    episode_started_at: number | null;
    total_days_active: number;
    total_coding_hours: number;
    total_interactions: number;
}

export type ActivityType =
    | "coding"
    | "researching"
    | "learning"
    | "entertainment"
    | "distracted"
    | "gaming"
    | "music"
    | "idle"
    | "unknown";

export type TimeOfDay =
    | "morning"
    | "afternoon"
    | "evening"
    | "night"
    | "late_night"
    | "dead_hours"
    | "unknown";

/**
 * Provisional episode set. Names match the Rust side
 * (`src-tauri/src/episodes.rs`). Final list is a design-spec call.
 */
export type EpisodeName =
    | "withdrawn"
    | "clingy"
    | "pouty"
    | "gleeful"
    | "huffy"
    | "jealous";

export interface EpisodeStartEvent {
    episode: EpisodeName;
    started_at: number;
    expected_duration_seconds: number;
    trigger_event: string | null;
}

export interface EpisodeEndEvent {
    episode: EpisodeName;
    ended_at: number;
    exit_reason: "duration_elapsed" | "manual" | "superseded";
}

export interface IdleEvent {
    type: "Sleeping" | "Wandering" | "Returned";
    seconds?: number;
    was_gone_minutes?: number;
}

export interface SystemHealthAlert {
    alert_type: "cpu_high" | "ram_high" | "battery_low" | "battery_critical";
    value: number;
}

export interface MilestoneEvent {
    milestone_type:
    | "focus_25"
    | "focus_60"
    | "focus_120"
    | "new_peak_wpm"
    | "distracted_majority";
    value?: number;
}

export interface ActiveWindowEvent {
    title: string;
    app: string;
    activity: ActivityType;
}

export interface TypingSpeedEvent {
    wpm: number;
}

/**
 * Predicate: is this running inside the Tauri webview?
 *
 * Per `.kiro/steering/frontend.md`, every Tauri import is dynamic and
 * feature-checked. Use this helper before touching anything Tauri-shaped.
 */
export function isTauri(): boolean {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
}
