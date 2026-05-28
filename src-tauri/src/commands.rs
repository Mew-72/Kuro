use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use tauri::Emitter;

use crate::context::{KuroContext, KuroProfile};
use crate::episodes::{EpisodeEndEvent, EpisodeStartEvent, EpisodeTracker};
use crate::health::SystemHealth;
use crate::mood::{MoodSnapshot, MoodVector};
use crate::profile;
use crate::session::SessionTracker;
use crate::typing::TypingState;
use crate::vrm_install::{self, VrmInstalled};

/// Shared application state accessible from Tauri commands.
pub struct AppState {
    pub profile: Mutex<KuroProfile>,
    pub session: Mutex<SessionTracker>,
    pub typing: Arc<TypingState>,
    pub health: Mutex<SystemHealth>,
    pub mood: Mutex<MoodVector>,
    pub episodes: Mutex<EpisodeTracker>,
    pub current_activity: Mutex<String>,
    pub current_app: Mutex<String>,
    pub current_title: Mutex<String>,
    /// Unix milliseconds of the last direct interaction (click/headpat etc.).
    pub last_interaction_ms: Mutex<u64>,
    pub app_data_dir: std::path::PathBuf,
}

#[tauri::command]
pub fn get_context(state: tauri::State<'_, Arc<AppState>>) -> KuroContext {
    let profile = state.profile.lock().unwrap();
    let session = state.session.lock().unwrap();
    let health = state.health.lock().unwrap();
    let mood = state.mood.lock().unwrap();
    let episodes = state.episodes.lock().unwrap();
    let activity = state.current_activity.lock().unwrap();
    let app = state.current_app.lock().unwrap();
    let title = state.current_title.lock().unwrap();
    let wpm = state.typing.current_wpm.load(Ordering::Relaxed);
    let now = chrono::Local::now();
    use chrono::{Datelike, Timelike};
    let hour = now.hour();
    let weekday = now.weekday();

    let (current_episode, episode_started_at) = match episodes.current() {
        Some((name, started_at, _dur)) => (Some(name), Some(started_at)),
        None => (None, None),
    };

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
        mood: MoodSnapshot::from(*mood),
        current_episode,
        episode_started_at,
        total_days_active: profile.total_days_active,
        total_coding_hours: profile.total_coding_hours,
        total_interactions: profile.total_interactions,
    }
}

#[tauri::command]
pub fn get_profile(state: tauri::State<'_, Arc<AppState>>) -> KuroProfile {
    state.profile.lock().unwrap().clone()
}

/// Record a direct user→character interaction (click/headpat-equivalent).
///
/// V1 surfaces this through a single command. The frontend passes a `kind`
/// string for future categorisation (`"pet"`, `"hug"`, `"poke"` etc.), but
/// V1 treats them all as positive interactions.
#[tauri::command]
pub fn record_interaction(
    state: tauri::State<'_, Arc<AppState>>,
    kind: String,
) -> u32 {
    let _ = kind; // V1 doesn't differentiate yet — kind is for future use.

    let mut profile = state.profile.lock().unwrap();
    profile.total_interactions += 1;
    let count = profile.total_interactions;
    profile::save_profile(&state.app_data_dir, &profile);
    drop(profile);

    {
        let mut mood = state.mood.lock().unwrap();
        mood.on_positive_interaction();
    }
    {
        let mut last = state.last_interaction_ms.lock().unwrap();
        *last = now_ms();
    }
    count
}

/// Force a specific episode to start. Used by the settings debug panel.
#[tauri::command]
pub fn force_episode(
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
) -> EpisodeStartEvent {
    let mut episodes = state.episodes.lock().unwrap();
    episodes.force_start(&name, now_secs(), Some("debug_force"))
}

/// Toggle DND mode. Triggers a `withdrawn` episode on enable; ends it on disable.
/// Frontend listens for `kuro:episode-start` / `kuro:episode-end` to react.
#[tauri::command]
pub fn set_dnd(
    state: tauri::State<'_, Arc<AppState>>,
    enabled: bool,
) -> Option<EpisodeStartEvent> {
    let mut episodes = state.episodes.lock().unwrap();
    let mut mood = state.mood.lock().unwrap();
    let now = now_secs();

    if enabled {
        mood.on_dnd_engaged();
        Some(episodes.force_start("withdrawn", now, Some("dnd_on")))
    } else {
        mood.on_dnd_released();
        // The end event is consumed via the polling thread when emitted; the
        // frontend will see `kuro:episode-end` for "withdrawn".
        let _: Option<EpisodeEndEvent> = episodes.force_end(now);
        None
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_secs() -> u64 {
    now_ms() / 1000
}

// ---------- VRM model install ----------

/// Returns the currently installed VRM file's metadata, or `null` if none.
#[tauri::command]
pub fn get_installed_vrm(state: tauri::State<'_, Arc<AppState>>) -> Option<VrmInstalled> {
    vrm_install::read_installed(&state.app_data_dir)
}

/// Install a VRM file by copying from the user-picked path into the app
/// data dir, then emit `kuro:vrm-installed` so the character window
/// hot-reloads. The frontend opens the file picker (via the dialog
/// plugin's JS API) and passes the resulting path here.
#[tauri::command]
pub fn install_vrm_from_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    source_path: String,
) -> Result<VrmInstalled, String> {
    let source = std::path::PathBuf::from(&source_path);
    let installed = vrm_install::install_from_path(&state.app_data_dir, &source)?;
    let _ = app.emit("kuro:vrm-installed", &installed);
    Ok(installed)
}

/// Remove the installed VRM file (if any) and emit a reload event so the
/// frontend goes back to the bundled fallback / empty state.
#[tauri::command]
pub fn clear_installed_vrm(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let path = vrm_install::installed_vrm_path(&state.app_data_dir);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("remove failed: {e}"))?;
    }
    let _ = app.emit("kuro:vrm-cleared", ());
    Ok(())
}
