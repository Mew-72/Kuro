use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;
use crate::context::{KuroContext, KuroProfile};
use crate::typing::TypingState;
use crate::session::SessionTracker;
use crate::health::SystemHealth;
use crate::profile;

/// Shared application state accessible from Tauri commands.
pub struct AppState {
    pub profile: Mutex<KuroProfile>,
    pub session: Mutex<SessionTracker>,
    pub typing: Arc<TypingState>,
    pub health: Mutex<SystemHealth>,
    pub current_activity: Mutex<String>,
    pub current_app: Mutex<String>,
    pub current_title: Mutex<String>,
    pub app_data_dir: std::path::PathBuf,
}

#[tauri::command]
pub fn get_context(state: tauri::State<'_, Arc<AppState>>) -> KuroContext {
    let profile = state.profile.lock().unwrap();
    let session = state.session.lock().unwrap();
    let health = state.health.lock().unwrap();
    let activity = state.current_activity.lock().unwrap();
    let app = state.current_app.lock().unwrap();
    let title = state.current_title.lock().unwrap();
    let wpm = state.typing.current_wpm.load(Ordering::Relaxed);
    let now = chrono::Local::now();
    let hour = now.hour();
    let weekday = now.weekday();
    use chrono::{Datelike, Timelike};
    KuroContext {
        user_name: profile.user_name.clone(),
        device_name: profile.device_name.clone(),
        days_since_first_met: profile::days_since_first_met(&profile),
        current_app: app.clone(),
        current_window_title: title.clone(),
        activity_type: activity.clone(),
        current_wpm: wpm,
        peak_wpm_today: session.peak_wpm_today,
        session_coding_minutes: session.coding_minutes(),
        session_distracted_minutes: session.distracted_minutes(),
        session_idle_minutes: session.idle_minutes(),
        focus_streak_minutes: session.focus_streak_minutes(),
        longest_streak_today: session.longest_streak_minutes(),
        battery_percent: health.battery_percent,
        is_charging: health.is_charging,
        cpu_percent: health.cpu_percent,
        ram_percent: health.ram_percent,
        open_window_count: health.open_window_count,
        hour,
        is_weekend: weekday == chrono::Weekday::Sat || weekday == chrono::Weekday::Sun,
        time_of_day: crate::context::time_of_day(hour).to_string(),
        total_days_active: profile.total_days_active,
        total_coding_hours: profile.total_coding_hours,
        total_headpats: profile.total_headpats,
    }
}

#[tauri::command]
pub fn get_profile(state: tauri::State<'_, Arc<AppState>>) -> KuroProfile {
    state.profile.lock().unwrap().clone()
}

#[tauri::command]
pub fn record_headpat(state: tauri::State<'_, Arc<AppState>>) -> u32 {
    let mut profile = state.profile.lock().unwrap();
    profile.total_headpats += 1;
    let count = profile.total_headpats;
    profile::save_profile(&state.app_data_dir, &profile);
    count
}
