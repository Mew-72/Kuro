---
inclusion: fileMatch
fileMatchPattern: 'src-tauri/**'
---

# Rust backend architecture

## Carry-over from v0

The Rust telemetry pipeline survived the cat-to-humanoid rebody intact. It was the most solid part of v0 and stays in V1 with one *additive* change: a mood/episode layer slots in alongside the existing trackers.

What carries over unchanged:
- Three-thread model (click-through poll + `rdev` listener + main polling loop).
- 500 ms base tick with modular sub-cadences.
- `AppState` with `Mutex`-wrapped trackers and `Arc<TypingState>` for atomics.
- Active-window classifier, idle tracker, system health, session tracker, profile persistence.
- `KuroContext` event emitted on a 3 s cadence, plus event-driven emissions for milestones, idle transitions, and health alerts.
- JSON persistence to `<app_data_dir>/kuro-profile.json`.

## What changes for V1

### `KuroContext` evolves to carry emotional state

Adds:

```rust
pub mood: MoodSnapshot,            // current mood vector (floats)
pub current_episode: Option<String>, // e.g. Some("withdrawn"), or None
pub episode_started_at: Option<u64>, // unix ms, for duration-aware reactions
```

Drops (or makes optional, depending on the V1 design):
- `total_headpats` — cat-specific. May be replaced by `affection_total` or similar; design call.
- Possibly `peak_wpm_today` / `peak_wpm_ever` if the V1 character doesn't react to typing speed peaks. Probably keeps them.

### New modules

- **`mood.rs`** — defines the dimension set, decay rates, mutators. Pure computation, no Tauri or IO. Called from the 60 s session tick to apply event deltas, and from a new fast tick (10 s likely) to apply decay.
- **`episodes.rs`** — episode evaluator. Pattern-matches recent events + mood vector against trigger conditions, fires episode events, manages bounded duration and per-day cooldowns. Same pure-computation shape as `mood.rs`.

### New events

| Event name | Payload shape | When |
| --- | --- | --- |
| `kuro:mood` | `{ affection, annoyance, attention_hunger, energy, ... }` (the locked dimension set) | On change above a threshold; also folded into `kuro:context` |
| `kuro:episode-start` | `{ episode, started_at, expected_duration_seconds, trigger_event? }` | When the evaluator fires an episode |
| `kuro:episode-end` | `{ episode, ended_at, exit_reason }` | When an episode ends naturally or via user action |

### Removed events / commands

- `record_headpat` — cat-specific. Replaced by a generic `record_interaction(kind: String)` or per-interaction commands like `record_headpat`/`record_pet`/`record_hug` once the V1 spec defines the interaction taxonomy.

## Threads (unchanged from v0)

On `tauri::Builder::default().setup(...)` we spawn three long-lived OS threads plus the main runtime:

1. **Click-through poll thread** (50 ms tick). Reads cursor position via `outer_position` + `inner_size`, toggles `set_ignore_cursor_events`. The hit-area shape changes for V1 because the character is no longer in a fixed bottom-250-px region — it's wherever the VRM is rendered. The frontend will have to publish the current character bounding box, or we fall back to "whole window is interactive when cursor is over it" for V1 simplicity.
2. **`rdev` input listener** (`typing::start_input_listener`). Owns its thread because `rdev::listen` blocks forever. Updates `current_wpm` (rolling 60 s window of keypresses ÷ 5) and `last_input_epoch_ms` on any input event.
3. **Polling / emit thread** (500 ms base tick, multiplexed by `tick_counter`).

## Polling cadence

| Every | Job |
| --- | --- |
| 500 ms | Active window via `active_win_pos_rs::get_active_window`, classify, emit `kuro:active-window` on title change |
| 2 s | Emit `kuro:typing-speed`; if WPM > noise floor, fire peak-WPM milestone if applicable |
| 3 s | Build full `KuroContext` (now includes mood + current_episode), emit `kuro:context` |
| 10 s | `IdleTracker::tick`; **NEW: `mood::decay_step()`** to apply decay to all dimensions |
| 30 s | Refresh CPU/RAM/battery, emit `kuro:system-health` per threshold alert |
| 60 s | `SessionTracker::tick`; **NEW: `episodes::evaluate(...)`** to check episode trigger conditions; midnight rollover |

## State (`AppState` in `commands.rs`)

Carries forward from v0 plus the new mood/episode trackers:

```rust
pub struct AppState {
    pub profile: Mutex<KuroProfile>,
    pub session: Mutex<SessionTracker>,
    pub typing: Arc<TypingState>,
    pub health: Mutex<SystemHealth>,
    pub current_activity: Mutex<String>,
    pub current_app: Mutex<String>,
    pub current_title: Mutex<String>,
    pub mood: Mutex<MoodVector>,            // NEW
    pub episodes: Mutex<EpisodeTracker>,    // NEW
    pub app_data_dir: std::path::PathBuf,
}
```

## Activity classifier

`activity::classify_activity` keeps the same shape and contract: title + exe name in, one of the activity strings out. Tested in `#[cfg(test)] mod tests`. **When adding heuristics, add a unit test in the same file.**

V1 may add new categories (`messaging`, `meeting`, `creative`) if the episode design needs them — the trigger conditions for `jealous` likely care about `messaging`, for example. Don't add categories speculatively; add them when an episode requires them.

## Frontend contract — V1

### Tauri commands (must stay registered in `invoke_handler!`)
- `get_context() -> KuroContext`
- `get_profile() -> KuroProfile`
- `record_interaction(kind: String) -> u32` *(replaces v0 `record_headpat`)*
- `force_episode(name: String)` *(debug, V1 settings page uses it)*
- `set_dnd(enabled: bool)` *(triggers `withdrawn` episode entry/exit)*
- `get_installed_vrm() -> Option<VrmInstalled>` *(returns the user-installed VRM file's path/size, or null)*
- `install_vrm_from_path(source_path: String) -> VrmInstalled` *(copies a picked .vrm into app data dir, emits `kuro:vrm-installed` for hot-reload)*
- `clear_installed_vrm()` *(deletes the installed file, emits `kuro:vrm-cleared`)*

### Events (payload shapes are stable — frontend listens by name)

Carried over:
- `kuro:context` — full `KuroContext`
- `kuro:typing-speed` — `{ wpm: u32 }`
- `kuro:active-window` — `{ title, app, activity }`
- `kuro:idle` — tagged enum: `{ type: "Sleeping" | "Wandering" | "Returned", seconds?, was_gone_minutes? }`
- `kuro:system-health` — `{ alert_type, value }` for `cpu_high | ram_high | battery_low | battery_critical`
- `kuro:milestone` — `{ milestone_type, value? }`

New for V1:
- `kuro:mood` — current mood vector (only on significant change)
- `kuro:episode-start` — `{ episode, started_at, expected_duration_seconds, trigger_event? }`
- `kuro:episode-end` — `{ episode, ended_at, exit_reason }`
- `kuro:vrm-installed` — `{ path, size_bytes, original_name }` — the character window listens and hot-reloads the model
- `kuro:vrm-cleared` — `null` payload — the character window goes back to the bundled fallback (or shows the friendly error overlay)

When any payload shape changes, update `context.rs`, the listener in `components/character/character.tsx`, and this file in the same commit.

## Permissions

Every Tauri API the frontend calls must have its permission in `src-tauri/capabilities/default.json`. The current set covers window position/size/cursor/visibility, event listen/emit, the `store` plugin, and the `dialog` plugin (for the VRM file picker). Adding `invoke` of a new built-in plugin almost always needs a new entry here, or the call will silently fail with no error in the frontend.

The asset protocol is enabled in `tauri.conf.json` with scope `$APPDATA/**/*` so the renderer can load user-installed VRM files from the app data directory via `convertFileSrc()`. Widening this scope (e.g. to `$HOME`) is a security decision — don't do it without a reason.

V2 capabilities (L1 agency) will add a *substantial* permission set — clipboard, opener (URL launch), possibly notification, possibly process. Each gets its own settings toggle and audit log entry. Do not pre-register V2 permissions during V1.

## Persistence

- `KuroProfile` is JSON-serialised to `<app_data_dir>/kuro-profile.json` on every mutation.
- V1 adds two persisted fields to the profile: `mood_baseline` (her drift point) and `episode_history` (recent episode firings, capped at N entries, used for cooldown enforcement).
- First launch creates a profile from `sysinfo::Users` + `System::host_name()`. Fallbacks: `"you"` and `"this PC"`.
- Format stays human-readable (`serde_json::to_string_pretty`). Users *will* read this file. Don't put anything embarrassing in it.
- **V1 migration:** if a v0 profile exists with `total_headpats` etc., migrate gracefully — read what's still meaningful, default the new fields. Do not crash on missing fields.

## Adding work to the polling loop

Use the existing `tick_counter` modulo pattern. Don't spawn a new thread for periodic work — it just adds wakeups and complicates teardown. Pick a tick interval that matches the data freshness need:

- Sub-second (UI-feeling) → 500 ms (`tick_counter % 1`)
- Several-second (status) → 2–3 s (`% 4` or `% 6`)
- Mood decay / fast feelings → 10 s (`% 20`)
- Heavy refresh (CPU/RAM) → 30 s (`% 60`)
- Bookkeeping (sessions, episodes, midnight) → 60 s (`% 120`)

## Things that stay out of the backend in V1

- **No LLM calls.** Even if V3 puts the LLM client in Rust, V1 backend has no inference path. The personality engine is fully scripted on the frontend in V1.
- **No outbound effects.** No clipboard writes, no app launches, no URL opens, no typing into windows. V1 is observer-only. These land in V2 under the L1 capability allowlist.
- **No audio.** No TTS synthesis, no STT capture. V2/V3.
- **No network.** Telemetry is local. The only network call in V1 is whatever Cubism core CDN is left over from v0, and that's getting removed during the rebody.
