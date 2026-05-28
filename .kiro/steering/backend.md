---
inclusion: fileMatch
fileMatchPattern: 'src-tauri/**'
---

# Rust backend architecture

## Threads
On `tauri::Builder::default().setup(...)` we spawn three long-lived OS threads plus the main runtime:

1. **Click-through poll thread** (50 ms tick). Reads cursor position via `outer_position` + `inner_size`, toggles `set_ignore_cursor_events`. Only the **bottom 250 px** of the window is treated as the hit area for the character; the top 250 px stays click-through so the dialogue bubble never blocks the desktop. Tied to the `main` window.
2. **`rdev` input listener** (`typing::start_input_listener`). `rdev::listen` blocks forever, so it must own its thread. Updates `current_wpm` (rolling 60 s window of keypresses ÷ 5) and `last_input_epoch_ms` on any input event (key, mouse move, button, wheel).
3. **Polling / emit thread** (500 ms base tick, multiplexed by `tick_counter`).

## Polling cadence (single thread, one sleep, modular ticks)

| Every | Job |
| --- | --- |
| 500 ms | Active window via `active_win_pos_rs::get_active_window`, classify, emit `kuro:active-window` on title change |
| 2 s | Emit `kuro:typing-speed`; if WPM > 20, fire peak-WPM milestone if it beats `peak_wpm_today` |
| 3 s | Build full `KuroContext`, emit `kuro:context` |
| 10 s | `IdleTracker::tick` — emits `Sleeping` (>10 min), `Wandering` (>30 min), `Returned` (>5 min then back) |
| 30 s | Refresh CPU/RAM/battery, emit `kuro:system-health` per threshold alert |
| 60 s | `SessionTracker::tick` (focus_25 / focus_60 / focus_120 / distracted_majority); midnight rollover persists daily totals into the lifetime profile and resets the session |

## State (`AppState` in `commands.rs`)
- `profile: Mutex<KuroProfile>` — persisted to `kuro-profile.json` in `app_data_dir`
- `session: Mutex<SessionTracker>` — daily, resets at midnight
- `typing: Arc<TypingState>` — atomics shared with the rdev thread (`AtomicU32` WPM, `AtomicU64` last-input epoch ms)
- `health: Mutex<SystemHealth>`
- `current_activity / current_app / current_title: Mutex<String>` — last poll snapshot
- `app_data_dir: PathBuf` — for profile saves

## Activity classifier (`activity::classify_activity`)
Inputs: window title + exe name (lowercased). Returns one of: `coding | researching | learning | entertainment | distracted | gaming | music | unknown`. Tested in `#[cfg(test)] mod tests`. **When adding heuristics, add a unit test in the same file.**

Rule order matters — more specific cases (terminal exe names, code file extensions) come before broader URL-based checks. YouTube goes through both `learning` (tutorial/course/learn/how to/explained/crash course in the title) and `entertainment` branches — keep that ordering.

## Frontend contract

### Tauri commands (must stay registered in `invoke_handler!`)
- `get_context() -> KuroContext`
- `get_profile() -> KuroProfile`
- `record_headpat() -> u32` (also persists)

### Events (payload shapes are stable — frontend listens by name)
- `kuro:context` — full `KuroContext`
- `kuro:typing-speed` — `{ wpm: u32 }`
- `kuro:active-window` — `{ title, app, activity }`
- `kuro:idle` — tagged enum: `{ type: "Sleeping" | "Wandering" | "Returned", seconds?, was_gone_minutes? }`
- `kuro:system-health` — `{ alert_type, value }` for `cpu_high | ram_high | battery_low | battery_critical`
- `kuro:milestone` — `{ milestone_type, value? }` for `focus_25 | focus_60 | focus_120 | new_peak_wpm | distracted_majority`

When the shape changes, update `context.rs`, the listener in `kuro-desktop.tsx`, and the relevant entry in this file in the same change.

## Permissions
Every Tauri API the frontend calls must have its permission in `src-tauri/capabilities/default.json`. The current set covers window position/size/cursor/visibility, event listen/emit, and the `store` plugin. Adding `invoke` of a new built-in plugin almost always needs a new entry here, or the call will silently fail with no error in the frontend.

## Persistence
- `KuroProfile` is JSON-serialised to `<app_data_dir>/kuro-profile.json` on every mutation (headpats, peak WPM, midnight rollover).
- First launch creates a profile from `sysinfo::Users` + `System::host_name()`. If those fail, fallbacks are `"you"` and `"this PC"`.
- Format is human-readable (`serde_json::to_string_pretty`) — users *will* read this file. Don't put anything embarrassing in it.

## Adding work to the polling loop
Use the existing `tick_counter` modulo pattern. Don't spawn a new thread for periodic work — it just adds wakeups and complicates teardown. Pick a tick interval that matches the data freshness need:

- Sub-second (UI-feeling) → 500 ms (`tick_counter % 1`)
- Several-second (status) → 2–3 s (`% 4` or `% 6`)
- Heavy refresh (CPU/RAM) → 30 s (`% 60`)
- Bookkeeping (sessions, midnight) → 60 s (`% 120`)
