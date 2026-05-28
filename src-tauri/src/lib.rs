mod activity;
mod commands;
mod context;
mod episodes;
mod health;
mod idle;
mod mood;
mod profile;
mod session;
mod typing;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use commands::AppState;
use episodes::{EpisodeTracker, EvaluatorInputs};
use health::SystemHealth;
use idle::IdleTracker;
use mood::MoodVector;
use session::SessionTracker;
use typing::TypingState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            let window = app.get_webview_window("main").unwrap();

            // --- Click-through polling thread ---
            //
            // V1 simplification: the entire window is the hit-area when the
            // cursor is inside the window bounds. The dialogue bubble is
            // drawn outside the window or as a non-interactive layer per
            // the frontend rules (see .kiro/steering/frontend.md).
            //
            // V2 may publish the character bounding box from the frontend
            // each frame to allow sub-window hit testing.
            window.set_ignore_cursor_events(true)?;
            let poll_window = window.clone();
            std::thread::spawn(move || {
                let mut cursor_inside = false;
                loop {
                    std::thread::sleep(Duration::from_millis(50));
                    let pos = match poll_window.outer_position() {
                        Ok(p) => p,
                        Err(_) => break,
                    };
                    let size = match poll_window.inner_size() {
                        Ok(s) => s,
                        Err(_) => break,
                    };
                    let cursor = match poll_window.cursor_position() {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let inside = cursor.x >= pos.x as f64
                        && cursor.x <= (pos.x + size.width as i32) as f64
                        && cursor.y >= pos.y as f64
                        && cursor.y <= (pos.y + size.height as i32) as f64;
                    if inside != cursor_inside {
                        cursor_inside = inside;
                        let _ = poll_window.set_ignore_cursor_events(!inside);
                    }
                }
            });

            // --- Initialize shared state ---
            let app_data_dir = app.path().app_data_dir().unwrap();
            let _ = std::fs::create_dir_all(&app_data_dir);

            let kuro_profile = profile::init_profile(&app_data_dir);
            let typing_state = Arc::new(TypingState::new());
            let app_state = Arc::new(AppState {
                profile: Mutex::new(kuro_profile),
                session: Mutex::new(SessionTracker::new()),
                typing: typing_state.clone(),
                health: Mutex::new(SystemHealth {
                    cpu_percent: 0.0,
                    ram_percent: 0.0,
                    battery_percent: 100,
                    is_charging: true,
                    open_window_count: 0,
                }),
                mood: Mutex::new(MoodVector::baseline()),
                episodes: Mutex::new(EpisodeTracker::new()),
                current_activity: Mutex::new("unknown".to_string()),
                current_app: Mutex::new(String::new()),
                current_title: Mutex::new(String::new()),
                last_interaction_ms: Mutex::new(now_ms()),
                app_data_dir: app_data_dir.clone(),
            });

            app.manage(app_state.clone());

            // --- Spawn rdev input listener thread ---
            let typing_for_rdev = typing_state.clone();
            std::thread::spawn(move || {
                typing::start_input_listener(typing_for_rdev);
            });

            // --- Main polling/event-emission thread ---
            let emit_window = window.clone();
            let poll_state = app_state.clone();
            let poll_typing = typing_state.clone();
            std::thread::spawn(move || {
                use tauri::Emitter;

                let mut sys = sysinfo::System::new_all();
                sys.refresh_cpu_usage();
                std::thread::sleep(Duration::from_millis(200));

                let mut idle_tracker = IdleTracker::new();
                let mut last_window_title = String::new();
                let mut last_date = chrono::Local::now().date_naive();
                let mut last_emitted_episode: Option<String> = None;

                let mut tick_counter: u64 = 0; // increments every 500ms

                loop {
                    std::thread::sleep(Duration::from_millis(500));
                    tick_counter += 1;

                    // === Every 500ms: poll active window ===
                    if let Some(win_info) = activity::poll_active_window() {
                        let activity_type =
                            activity::classify_activity(&win_info.title, &win_info.exe_name);
                        {
                            let mut act = poll_state.current_activity.lock().unwrap();
                            *act = activity_type.to_string();
                            let mut app_name = poll_state.current_app.lock().unwrap();
                            *app_name = win_info.app_name.clone();
                            let mut title = poll_state.current_title.lock().unwrap();
                            *title = win_info.title.clone();
                        }
                        if win_info.title != last_window_title {
                            last_window_title = win_info.title.clone();
                            let _ = emit_window.emit(
                                "kuro:active-window",
                                serde_json::json!({
                                    "title": win_info.title,
                                    "app": win_info.app_name,
                                    "activity": activity_type,
                                }),
                            );
                        }
                    }

                    // === Every 2s (tick 4): typing speed ===
                    if tick_counter % 4 == 0 {
                        let wpm = poll_typing.current_wpm.load(Ordering::Relaxed);
                        let _ = emit_window.emit(
                            "kuro:typing-speed",
                            serde_json::json!({ "wpm": wpm }),
                        );

                        if wpm > 20 {
                            let mut session = poll_state.session.lock().unwrap();
                            if let Some(milestone) = session.update_wpm(wpm) {
                                let mut profile = poll_state.profile.lock().unwrap();
                                if wpm > profile.peak_wpm_ever {
                                    profile.peak_wpm_ever = wpm;
                                    profile::save_profile(&poll_state.app_data_dir, &profile);
                                }
                                let _ = emit_window.emit("kuro:milestone", &milestone);
                            }
                        }
                    }

                    // === Every 3s (tick 6): full context ===
                    if tick_counter % 6 == 0 {
                        let ctx = build_context(&poll_state);
                        let _ = emit_window.emit("kuro:context", &ctx);

                        // Emit mood separately for finer-grained subscribers
                        // (not strictly needed since context carries it, but
                        // it's a small payload and saves the frontend from
                        // diffing mood out of context).
                        let mood = *poll_state.mood.lock().unwrap();
                        let _ = emit_window.emit(
                            "kuro:mood",
                            &mood::MoodSnapshot::from(mood),
                        );

                        // Episode change detection — keep frontend in sync
                        // even if a force_start happened off-tick.
                        let current_name = poll_state
                            .episodes
                            .lock()
                            .unwrap()
                            .current()
                            .map(|(n, _, _)| n);
                        if current_name != last_emitted_episode {
                            // Note: explicit start/end events are emitted at
                            // the points they happen (see set_dnd, force_episode,
                            // and the 60s evaluator below). This block is purely
                            // a defensive resync — it deliberately does not
                            // re-emit a start, only logs the divergence in dev.
                            last_emitted_episode = current_name;
                        }
                    }

                    // === Every 10s (tick 20): idle + mood decay ===
                    if tick_counter % 20 == 0 {
                        let idle_secs = idle::get_idle_seconds(&poll_typing);
                        if let Some(idle_event) = idle_tracker.tick(idle_secs) {
                            // Mood reaction to user returning
                            if let idle::IdleEvent::Returned { was_gone_minutes } = &idle_event {
                                poll_state
                                    .mood
                                    .lock()
                                    .unwrap()
                                    .on_user_returned(*was_gone_minutes);
                            }
                            let _ = emit_window.emit("kuro:idle", &idle_event);
                        }
                        if idle_secs > 600 {
                            let mut act = poll_state.current_activity.lock().unwrap();
                            *act = "idle".to_string();
                        }

                        // Mood decay — rate is small per 10s tick, accumulates over minutes.
                        poll_state.mood.lock().unwrap().decay_toward_baseline(0.02);
                    }

                    // === Every 30s (tick 60): system health ===
                    if tick_counter % 60 == 0 {
                        let h = health::refresh_health(&mut sys);
                        let alerts = health::check_thresholds(&h);
                        {
                            let mut health_lock = poll_state.health.lock().unwrap();
                            *health_lock = h;
                        }
                        for alert in alerts {
                            let _ = emit_window.emit("kuro:system-health", &alert);
                        }
                    }

                    // === Every 60s (tick 120): session + episode evaluator + midnight ===
                    if tick_counter % 120 == 0 {
                        let activity = poll_state.current_activity.lock().unwrap().clone();

                        // Apply mood deltas for the activity that just elapsed.
                        {
                            let mut mood = poll_state.mood.lock().unwrap();
                            match activity.as_str() {
                                "coding" | "researching" | "learning" => mood.on_focus_tick(),
                                "distracted" | "entertainment" => mood.on_distraction_tick(),
                                "idle" => mood.on_idle_tick(),
                                _ => {}
                            }
                            // Late-night drains energy regardless of activity.
                            let hr = chrono::Local::now().format("%H").to_string();
                            if matches!(hr.as_str(), "00" | "01" | "02" | "03" | "04") {
                                mood.on_late_night_tick();
                            }
                        }

                        let milestones = {
                            let mut session = poll_state.session.lock().unwrap();
                            session.tick(&activity)
                        };
                        for m in milestones {
                            let _ = emit_window.emit("kuro:milestone", &m);
                        }

                        // Episode evaluator — feeds a snapshot into the tracker
                        // and emits any start/end events.
                        let now_secs = now_ms() / 1000;
                        let (mood_snap, session_snap) = {
                            let mood = *poll_state.mood.lock().unwrap();
                            let session = poll_state.session.lock().unwrap();
                            (
                                mood,
                                (
                                    session.distracted_minutes(),
                                    session.coding_minutes(),
                                ),
                            )
                        };
                        let last_int_secs = {
                            let last = *poll_state.last_interaction_ms.lock().unwrap();
                            ((now_ms().saturating_sub(last)) / 1000) as u32
                        };
                        let inputs = EvaluatorInputs {
                            now_unix_seconds: now_secs,
                            mood: &mood_snap,
                            current_activity: &activity,
                            session_distracted_minutes: session_snap.0,
                            session_coding_minutes: session_snap.1,
                            minutes_since_last_interaction: last_int_secs / 60,
                        };
                        let (end_evt, start_evt) = {
                            let mut tracker = poll_state.episodes.lock().unwrap();
                            tracker.tick(&inputs)
                        };
                        if let Some(end) = end_evt {
                            let _ = emit_window.emit("kuro:episode-end", &end);
                        }
                        if let Some(start) = start_evt {
                            let _ = emit_window.emit("kuro:episode-start", &start);
                        }

                        // Midnight check
                        let today = chrono::Local::now().date_naive();
                        if today != last_date {
                            last_date = today;
                            let (coding_min, longest_min) = {
                                let session = poll_state.session.lock().unwrap();
                                (session.coding_minutes(), session.longest_streak_minutes())
                            };
                            {
                                let mut profile = poll_state.profile.lock().unwrap();
                                profile.total_coding_hours += coding_min / 60;
                                if longest_min > profile.longest_streak_ever {
                                    profile.longest_streak_ever = longest_min;
                                }
                                profile.total_days_active += 1;
                                profile::save_profile(&poll_state.app_data_dir, &profile);
                            }
                            poll_state.session.lock().unwrap().reset();
                        }
                    }
                }
            });

            // --- Log plugin (debug only) ---
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_context,
            commands::get_profile,
            commands::record_interaction,
            commands::force_episode,
            commands::set_dnd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Build a `KuroContext` snapshot from the shared state.
fn build_context(state: &Arc<AppState>) -> context::KuroContext {
    let profile = state.profile.lock().unwrap();
    let session = state.session.lock().unwrap();
    let health_snap = state.health.lock().unwrap();
    let mood_snap = *state.mood.lock().unwrap();
    let episodes = state.episodes.lock().unwrap();
    let activity = state.current_activity.lock().unwrap();
    let app_name = state.current_app.lock().unwrap();
    let title = state.current_title.lock().unwrap();
    let wpm = state.typing.current_wpm.load(Ordering::Relaxed);
    let now = chrono::Local::now();
    use chrono::{Datelike, Timelike};
    let hour = now.hour();

    let (current_episode, episode_started_at) = match episodes.current() {
        Some((name, started_at, _dur)) => (Some(name), Some(started_at)),
        None => (None, None),
    };

    context::KuroContext {
        user_name: profile.user_name.clone(),
        device_name: profile.device_name.clone(),
        days_since_first_met: profile::days_since_first_met(&profile),
        current_app: app_name.clone(),
        current_window_title: title.clone(),
        activity_type: activity.clone(),
        current_wpm: wpm,
        peak_wpm_today: session.peak_wpm_today,
        session_coding_minutes: session.coding_minutes(),
        session_distracted_minutes: session.distracted_minutes(),
        session_idle_minutes: session.idle_minutes(),
        focus_streak_minutes: session.focus_streak_minutes(),
        longest_streak_today: session.longest_streak_minutes(),
        battery_percent: health_snap.battery_percent,
        is_charging: health_snap.is_charging,
        cpu_percent: health_snap.cpu_percent,
        ram_percent: health_snap.ram_percent,
        open_window_count: health_snap.open_window_count,
        hour,
        is_weekend: now.weekday() == chrono::Weekday::Sat
            || now.weekday() == chrono::Weekday::Sun,
        time_of_day: context::time_of_day(hour).to_string(),
        mood: mood::MoodSnapshot::from(mood_snap),
        current_episode,
        episode_started_at,
        total_days_active: profile.total_days_active,
        total_coding_hours: profile.total_coding_hours,
        total_interactions: profile.total_interactions,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
