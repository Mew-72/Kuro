//! VRM model installation.
//!
//! Lets the user pick a `.vrm` file from disk; we copy it into the app
//! data directory so the frontend can load it via the asset protocol.
//! Hot-reload is achieved by emitting `kuro:vrm-installed` after a
//! successful install — the frontend disposes the current VRM and loads
//! the new one without tearing the renderer down.

use std::path::PathBuf;

use serde::Serialize;

/// Subdirectory inside `app_data_dir` where installed VRM files live.
const CHARACTER_DIR: &str = "character";
/// The single, canonical filename. We don't try to support multiple
/// installed models in V1 — picking a new file overwrites the old.
const MODEL_FILENAME: &str = "model.vrm";

#[derive(Debug, Clone, Serialize)]
pub struct VrmInstalled {
    /// Absolute path on disk to the installed file.
    pub path: String,
    /// File size in bytes — handy for the settings UI to show.
    pub size_bytes: u64,
    /// Original filename the user picked, for display.
    pub original_name: String,
}

/// Path the installed VRM lives at, regardless of whether it exists.
pub fn installed_vrm_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join(CHARACTER_DIR).join(MODEL_FILENAME)
}

/// Returns the installed VRM info if a file is present, otherwise `None`.
pub fn read_installed(app_data_dir: &PathBuf) -> Option<VrmInstalled> {
    let path = installed_vrm_path(app_data_dir);
    if !path.exists() {
        return None;
    }
    let size_bytes = std::fs::metadata(&path).ok()?.len();
    Some(VrmInstalled {
        path: path.to_string_lossy().to_string(),
        size_bytes,
        original_name: MODEL_FILENAME.to_string(),
    })
}

/// Copy a source file to the installed location, replacing any prior file.
/// Validates that the source has a `.vrm` extension and is non-empty.
pub fn install_from_path(
    app_data_dir: &PathBuf,
    source: &PathBuf,
) -> Result<VrmInstalled, String> {
    if !source.exists() {
        return Err(format!("source file not found: {}", source.display()));
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    if ext.as_deref() != Some("vrm") {
        return Err("file does not have a .vrm extension".to_string());
    }
    let metadata =
        std::fs::metadata(source).map_err(|e| format!("could not read source: {e}"))?;
    if metadata.len() == 0 {
        return Err("file is empty".to_string());
    }

    let dest_dir = app_data_dir.join(CHARACTER_DIR);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("could not create character dir: {e}"))?;
    let dest = dest_dir.join(MODEL_FILENAME);
    std::fs::copy(source, &dest).map_err(|e| format!("copy failed: {e}"))?;

    let original_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(MODEL_FILENAME)
        .to_string();

    Ok(VrmInstalled {
        path: dest.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        original_name,
    })
}
