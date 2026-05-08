use std::fs;
use std::path::Path;
use chrono::Local;
use sysinfo::System;
use crate::context::KuroProfile;

/// Load existing profile or create a new one on first launch.
pub fn init_profile(app_data_dir: &Path) -> KuroProfile {
    let path = app_data_dir.join("kuro-profile.json");
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(profile) = serde_json::from_str::<KuroProfile>(&data) {
                return profile;
            }
        }
    }
    // First launch
    let mut sys = System::new_all();
    sys.refresh_all();
    let user_name = {
        let users = sysinfo::Users::new_with_refreshed_list();
        users.list().first().map(|u| u.name().to_string()).unwrap_or_else(|| "you".to_string())
    };
    let device_name = System::host_name().unwrap_or_else(|| "this PC".to_string());
    let profile = KuroProfile {
        user_name, device_name,
        first_launch: Local::now().format("%Y-%m-%d").to_string(),
        total_days_active: 1, total_coding_hours: 0, total_headpats: 0,
        favorite_app: String::new(), peak_wpm_ever: 0, longest_streak_ever: 0,
    };
    save_profile(app_data_dir, &profile);
    profile
}

/// Save profile to disk.
pub fn save_profile(app_data_dir: &Path, profile: &KuroProfile) {
    let path = app_data_dir.join("kuro-profile.json");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(profile) {
        let _ = fs::write(&path, json);
    }
}

/// Calculate days since first launch.
pub fn days_since_first_met(profile: &KuroProfile) -> u32 {
    use chrono::NaiveDate;
    let today = Local::now().date_naive();
    if let Ok(first) = NaiveDate::parse_from_str(&profile.first_launch, "%Y-%m-%d") {
        let diff = today.signed_duration_since(first).num_days();
        if diff > 0 { diff as u32 } else { 0 }
    } else { 0 }
}
