#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            let window = app.get_webview_window("main").unwrap();

            // Start click-through ON so the desktop pet doesn't block clicks.
            window.set_ignore_cursor_events(true)?;

            // Spawn a background thread that polls the global cursor position
            // every ~50 ms. When the cursor is inside the window bounds we
            // disable click-through so the webview can receive mouse events
            // (left-click, right-click, drag). When the cursor leaves we
            // re-enable click-through.
            //
            // This is necessary because setIgnoreCursorEvents(true) prevents
            // the OS from delivering *any* mouse events to the webview,
            // including mouseenter, so the frontend cannot detect hover on
            // its own.
            let poll_window = window.clone();
            std::thread::spawn(move || {
                let mut cursor_inside = false;

                loop {
                    std::thread::sleep(std::time::Duration::from_millis(50));

                    // Gather window position, size, and cursor position.
                    // All three calls can fail if the window is being
                    // destroyed, so we silently ignore errors.
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
                        Err(_) => continue, // cursor may be unavailable briefly
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

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
