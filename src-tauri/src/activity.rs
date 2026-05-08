/// Classify the current user activity based on window title and exe name.
///
/// Returns one of: "coding", "researching", "learning", "entertainment",
/// "distracted", "gaming", "music", "unknown".
pub fn classify_activity(title: &str, exe_name: &str) -> &'static str {
    let t = title.to_lowercase();
    let e = exe_name.to_lowercase();

    // Coding — check exe first (more reliable than title)
    if e.contains("code")
        || e.contains("cursor")
        || e.contains("idea")
        || e.contains("vim")
        || e.contains("nvim")
        || e.contains("sublime")
        || t.contains(".tsx")
        || t.contains(".rs")
        || t.contains(".py")
        || t.contains(".js")
        || t.contains(".cpp")
        || t.contains(".java")
        || t.contains("— vs code")
        || t.contains("— cursor")
    {
        return "coding";
    }

    // Terminal — treat as coding adjacent
    if e.contains("wt.exe")
        || e.contains("powershell")
        || e.contains("cmd")
        || e.contains("terminal")
        || t.contains("powershell")
        || t.contains("bash")
    {
        return "coding";
    }

    // Researching (productive web use)
    if t.contains("stackoverflow")
        || t.contains("stack overflow")
        || t.contains("mdn web docs")
        || t.contains("docs.rs")
        || t.contains("github.com")
        || t.contains("crates.io")
        || t.contains("npmjs.com")
        || t.contains("rust-lang.org")
        || t.contains("developer.mozilla")
        || t.contains("api reference")
        || t.contains("documentation")
        || t.contains("tauri.app")
    {
        return "researching";
    }

    // Learning (youtube but educational — give partial credit)
    if (t.contains("youtube") || t.contains("youtu.be"))
        && (t.contains("tutorial")
            || t.contains("course")
            || t.contains("learn")
            || t.contains("how to")
            || t.contains("explained")
            || t.contains("crash course"))
    {
        return "learning";
    }

    // Pure entertainment
    if t.contains("youtube")
        || t.contains("netflix")
        || t.contains("prime video")
        || t.contains("hotstar")
        || t.contains("twitch")
        || t.contains("crunchyroll")
        || t.contains("disney+")
    {
        return "entertainment";
    }

    // Distraction (maximum judgment)
    if t.contains("twitter")
        || t.contains("x.com")
        || t.contains("instagram")
        || t.contains("reddit")
        || t.contains("facebook")
        || t.contains("tiktok")
        || t.contains("snapchat")
    {
        return "distracted";
    }

    // Gaming
    if e.contains("steam")
        || t.contains("— steam")
        || e.contains("game")
        || t.contains("fps")
    {
        return "gaming";
    }

    // Music apps (neutral)
    if e.contains("spotify")
        || t.contains("spotify")
        || e.contains("music")
        || t.contains("apple music")
    {
        return "music";
    }

    "unknown"
}

/// Info about the currently active window.
#[derive(Debug, Clone)]
pub struct ActiveWindowInfo {
    pub title: String,
    pub exe_name: String,
    pub app_name: String,
}

/// Poll the currently active (foreground) window using active-win-pos-rs.
pub fn poll_active_window() -> Option<ActiveWindowInfo> {
    match active_win_pos_rs::get_active_window() {
        Ok(win) => Some(ActiveWindowInfo {
            title: win.title.clone(),
            exe_name: win.process_path
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or("")
                .to_string(),
            app_name: win.app_name.clone(),
        }),
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coding_vscode() {
        assert_eq!(classify_activity("main.rs — VS Code", "code.exe"), "coding");
    }

    #[test]
    fn test_coding_cursor() {
        assert_eq!(classify_activity("file.tsx — Cursor", "cursor.exe"), "coding");
    }

    #[test]
    fn test_terminal() {
        assert_eq!(classify_activity("PowerShell", "wt.exe"), "coding");
    }

    #[test]
    fn test_researching_github() {
        assert_eq!(classify_activity("rustdesk/rustdesk · GitHub.com", "chrome.exe"), "researching");
    }

    #[test]
    fn test_researching_docs() {
        assert_eq!(classify_activity("serde - docs.rs", "firefox.exe"), "researching");
    }

    #[test]
    fn test_learning_youtube() {
        assert_eq!(classify_activity("Rust Crash Course - YouTube", "chrome.exe"), "learning");
    }

    #[test]
    fn test_entertainment_youtube() {
        assert_eq!(classify_activity("Funny Cats Compilation - YouTube", "chrome.exe"), "entertainment");
    }

    #[test]
    fn test_distracted_twitter() {
        assert_eq!(classify_activity("Home / Twitter", "chrome.exe"), "distracted");
    }

    #[test]
    fn test_distracted_reddit() {
        assert_eq!(classify_activity("r/rust - Reddit", "chrome.exe"), "distracted");
    }

    #[test]
    fn test_gaming() {
        assert_eq!(classify_activity("Counter-Strike 2 — Steam", "steam.exe"), "gaming");
    }

    #[test]
    fn test_music() {
        assert_eq!(classify_activity("Spotify - Web Player", "spotify.exe"), "music");
    }

    #[test]
    fn test_unknown() {
        assert_eq!(classify_activity("Calculator", "calc.exe"), "unknown");
    }
}
