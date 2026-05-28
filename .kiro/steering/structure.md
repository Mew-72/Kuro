---
inclusion: always
---

# Repository structure

The repo is in transition: cat-era code (v0, Live2D) and humanoid-era code (V1, VRM) coexist on this branch until V1 cuts over. New work goes in the V1 layout. Cat code is read-only reference until it's archived.

## Current tree (transitional)

```
KURO/
├── app/
│   ├── layout.tsx                # Loads Cubism core script — REMOVE during V1
│   ├── page.tsx                  # Mounts <KuroDesktop> (cat) — REPLACE during V1
│   └── settings/page.tsx         # Settings window — keep, retarget at V1 character
│
├── components/
│   ├── kuro/                     # v0 cat module — frozen, do not edit
│   │   ├── kuro-desktop.tsx      # Cat character runtime (Live2D + Pixi)
│   │   ├── kuro-settings-menu.tsx# Legacy inline menu (the /settings page is canonical)
│   │   └── kk.tsx                # Sandbox/scratch — never imported
│   ├── lines.tsx                 # v0 cat dialogue — frozen, do not edit
│   ├── theme-provider.tsx
│   └── ui/                       # shadcn/ui primitives — generated, edit sparingly
│
├── hooks/                        # use-mobile, use-toast (shadcn defaults)
├── lib/utils.ts                  # cn() helper
│
├── public/model/                 # v0 LittleCat Live2D assets — frozen, will be replaced
│
├── src-tauri/
│   ├── tauri.conf.json           # Two windows: main (transparent overlay) + settings
│   ├── capabilities/default.json # All required permissions
│   ├── Cargo.toml
│   └── src/                      # Telemetry pipeline — KEEP, EVOLVE for V1
│       ├── lib.rs                # App setup, polling thread, event emission
│       ├── commands.rs           # AppState + #[tauri::command] surface
│       ├── context.rs            # KuroContext + KuroProfile (will gain mood/episode fields)
│       ├── activity.rs           # classify_activity() — keep
│       ├── typing.rs             # rdev listener, WPM — keep
│       ├── idle.rs               # IdleTracker — keep
│       ├── health.rs             # CPU/RAM/battery — keep
│       ├── session.rs            # Daily counters + milestones — keep, refactor for episodes
│       └── profile.rs            # JSON persistence — keep
│
└── .github/workflows/build.yml   # Windows-only Tauri build
```

## Target tree (V1, end-state)

```
KURO/
├── app/
│   ├── layout.tsx                # No Cubism script. Loads global CSS only.
│   ├── page.tsx                  # Mounts <KuroCharacter> with ssr: false
│   └── settings/page.tsx         # Settings — DND toggle, scale, monitor, debug episode trigger
│
├── components/
│   ├── character/                # V1 humanoid module (replaces components/kuro)
│   │   ├── character.tsx         # Top-level <KuroCharacter> — ticker, lifecycle, Tauri events
│   │   ├── renderer.ts           # three.js setup (scene, camera, transparent canvas)
│   │   ├── vrm.ts                # VRM load, rig, blendshape helpers
│   │   ├── animation/
│   │   │   ├── locomotion.ts     # Walk cycle, idle sway, sit/stand
│   │   │   ├── gaze.ts           # Look-at IK (cursor, active-window edge)
│   │   │   ├── expression.ts     # Mood/episode → blendshape mapping
│   │   │   └── ticker.ts         # Single master loop (replaces the cat's pixi ticker)
│   │   ├── dialogue/
│   │   │   ├── provider.ts       # LineProvider interface
│   │   │   ├── scripted.ts       # V1 implementation: scripted bank
│   │   │   └── lines/            # Line bank, organised by episode + event
│   │   └── episodes/
│   │       └── client.ts         # Receives episode/mood from backend, fans into animation+dialogue
│   ├── theme-provider.tsx
│   └── ui/                       # shadcn — unchanged
│
├── hooks/, lib/
│
├── public/character/             # VRM file(s), animation clips, possibly portrait/icon
│
├── src-tauri/
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/
│       ├── lib.rs
│       ├── commands.rs
│       ├── context.rs            # KuroContext now carries mood + current_episode
│       ├── activity.rs, typing.rs, idle.rs, health.rs, session.rs, profile.rs   # unchanged shape
│       ├── mood.rs               # NEW: mood dimensions, decay, mutators
│       └── episodes.rs           # NEW: episode evaluator, cooldowns, history
│
├── legacy/                       # Created when V1 lands on main
│   └── cat-v0/                   # The old kuro-desktop, lines.tsx, model assets
│
└── .github/workflows/build.yml
```

## Where new things go

| Adding... | Goes in... |
| --- | --- |
| A new mood dimension | `src-tauri/src/mood.rs` (definition + decay), `context.rs` (expose), frontend reads via context |
| A new episode | `src-tauri/src/episodes.rs` (trigger condition + duration), line bank under `dialogue/lines/episodes/`, animation overlay in `animation/expression.ts` if it has a distinctive pose |
| A new line | `components/character/dialogue/lines/<category>.ts` as a typed line object, not a raw string |
| A new Rust event | Emit from the polling thread in `lib.rs`, listen in `components/character/character.tsx`'s setup effect |
| A new Tauri command | `commands.rs`, register in `invoke_handler!` in `lib.rs`, list permission in `capabilities/default.json` if required |
| A new setting | Settings page UI + `KuroSettings` interface, consumer in `character.tsx` |
| A new keyboard shortcut | `character.tsx` `onKeyDown` handler |
| A new asset path served from disk | Update `tauri.conf.json` `assetProtocol.scope` and reach the file via `convertFileSrc()` from `@tauri-apps/api/core` |
| A V2 capability (later) | New module under `src-tauri/src/capabilities/`, allowlist in settings, personality hook in `episodes.rs` |

## Files that should NOT be casually edited

- `app/layout.tsx` — global frame; only edit when the V1 character runtime needs a different page-level setup.
- `public/character/*` — VRM and animation files referenced by name; renaming breaks loaders.
- `components/ui/*` — shadcn generated, treat as vendored.
- `next.config.mjs` — `output: "export"` is required for Tauri bundling.

## Files that are frozen (cat-era reference)

- `components/kuro/*` — read-only reference. Do not edit. Do not import from new code. Will move to `legacy/cat-v0/` after V1 lands.
- `components/lines.tsx` — same.
- `public/model/*` — same.
- `GEMINI.md` at repo root — outdated cat-era notes. Not deleted yet because it documents the v0 mandate that taught us what V1 needs to *not* do (no canned motions). Will be archived alongside the cat code.

## Naming conventions

- **`KuroCharacter`** — top-level React component for the V1 humanoid. Lives at `components/character/character.tsx`.
- **`Kuro*` types in Rust** — `KuroContext`, `KuroProfile`, `KuroMood`, `KuroEpisode`. The `Kuro` prefix denotes "framework type", not character name. The character has her own name (TBD).
- **The character's name** — not yet picked. When picked, it does *not* replace `Kuro*` framework prefixes. Keeps the framework/character distinction clean.
- **Episode names in code** — snake_case strings (`withdrawn`, `clingy`, `pouty`, `gleeful`, `huffy`, `jealous`). Same on Rust and TS.
- **Mood dimensions** — lowercase single words where possible (`affection`, `annoyance`, `attention_hunger`, `energy`).

## Branch model

- `main` — currently at the v0 cat. Stays at v0 until V1 ships.
- `humanoid-rebody` — active V1 development. This branch.
- `backend` — old branch from the telemetry refactor era. Already merged in spirit. Kept for reference, do not commit to.

When V1 stabilises: the cat code on `main` moves to `legacy/cat-v0/` in a single commit, then `humanoid-rebody` merges into `main`.
