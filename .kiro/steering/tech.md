---
inclusion: always
---

# Tech stack

## Frontend

### Kept from v0
- Next.js 16 App Router, `output: "export"` (static export — Tauri bundles the `out/` directory).
- React 19, TypeScript 5.7.
- Tailwind CSS v4 + `tw-animate-css`.
- shadcn/ui (Radix primitives) under `components/ui/*`.

### Adding for V1
- **three.js** — WebGL renderer for the VRM character.
- **`@pixiv/three-vrm`** — VRM 0.x and 1.0 runtime: model loading, humanoid rig, blendshape (expression) control, look-at, spring bones, mouth visemes.
- **`@pixiv/three-vrm-animation`** — VRMA animation file support, when we want to ship pre-baked motion clips.
- (Optional, decide during V1 spec) `three-stdlib` for `OrbitControls`/`GLTFLoader` extras, `three-mesh-bvh` if we ever need spatial queries.

### Removed from v0
- **PixiJS 7.x** — gone. Was the 2D scene graph for the Live2D cat. No 2D character runtime in V1.
- **`pixi-live2d-display`** — gone.
- **Cubism 4 core CDN script** — must be removed from `app/layout.tsx`. The script tag is dead weight in V1 and confuses anyone reading the code.

### Version constraints to hold
- **three.js** — pin a specific minor compatible with the `@pixiv/three-vrm` version we choose. `three-vrm` lags three.js by a release; do not auto-upgrade three.js without checking compatibility.
- **`@pixiv/three-vrm`** — pin exact. Both v2 (VRM 0.x + 1.0 unified) and v3 exist depending on three.js version.
- **React 19** — keep. No `react-three-fiber` for V1; we use vanilla three.js inside a `useEffect` for predictable lifecycle. R3F is a possibility but adds an opinionated render loop on top of the one we want to control.

## Backend

### Kept from v0 (the part that genuinely worked)
- Tauri 2.11 (Rust 1.77+, edition 2021).
- `tauri-plugin-store` for persistent settings.
- `tauri-plugin-log` (debug builds only).
- `rdev` 0.5 — global keyboard/mouse listener. Must run on its own OS thread; `listen` blocks forever.
- `sysinfo` 0.30 — CPU/RAM.
- `active-win-pos-rs` 0.8 — foreground window.
- `battery` 0.7 — battery state.
- `chrono` 0.4 — time, midnight rollover.

### Adding for V1
- New module: `mood.rs` (mood dimensions, decay, mutators) — pure Rust, no new crates.
- New module: `episodes.rs` (episode evaluator, cooldowns, fired-this-day tracker) — pure Rust, no new crates.
- `KuroContext` and `KuroProfile` evolve to carry mood/episode state. See `backend.md` for the schema rules.

### Reserved for later versions
- V2 (L1 agency): probably `enigo` or `arboard` for clipboard/typing, `opener` for URL launch, platform-specific media-key crates. Locked at V2 design time.
- V3 (LLM): nothing pinned. Likely `reqwest` for cloud, or a llama.cpp binding for local. Decided at V3 design time.
- V3/V4 (TTS/STT): not yet. Local options (`piper-rs`, `whisper-rs`) and cloud (`reqwest` + provider SDKs) both viable.

## Build & run

| Task | Command |
| --- | --- |
| Frontend dev (browser preview only — no Tauri APIs) | `npm run dev` |
| Frontend lint | `npm run lint` |
| Frontend static export | `npm run build` (writes to `out/`) |
| Tauri dev (full app) | `npx tauri dev` |
| Tauri release build | `npx tauri build` |

Shell on this machine is Windows `cmd`. Use `&` (not `&&`) to chain commands.

## Dual-mode runtime

The character component runs in two environments and must keep working in both:

- **Tauri** — detected with `"__TAURI_INTERNALS__" in window`. Drag moves the OS window via `getCurrentWindow().setPosition`. Click-through is managed by the Rust polling thread. Settings open in a second Tauri window.
- **Browser preview** — drag moves a CSS-transformed div. No click-through. No settings window. Useful for fast iteration on character behaviour without the Tauri build cycle.

Every Tauri import is dynamic and wrapped in a feature check. Never assume Tauri is present at module load time.

## CI

`.github/workflows/build.yml` runs on `windows-latest`, builds frontend + Tauri, uploads `.msi` and `.exe` artefacts. No signing key wired yet.

The CI workflow will need to handle two things during V1:
1. Larger asset size (VRM models are 5–30 MB each — keep them out of Git, fetch at build time or distribute alongside the binary).
2. Possibly a longer first-build cache, since three.js + three-vrm pull a meaningful WebGL surface.

## Versions worth holding

- **three.js + @pixiv/three-vrm** — versions move together. Pin exact for both. Do not bump one without the other.
- **rdev 0.5** — newer versions have had Windows hook regressions. Verify before upgrading.
- **Tauri v2** — capabilities live in `src-tauri/capabilities/default.json`. New permissions must be declared there or `invoke` will silently fail with no frontend error.
- **Pixi 7 / pixi-live2d-display 0.4** — *to be removed*. They're still in `package.json` because the cat code still references them on this branch. They get deleted when the cat code stops being imported, which happens during V1 implementation.

## Things deliberately not in the stack

- **react-three-fiber** — usable, but its render loop is opinionated and we want explicit control over the ticker for the same reasons we wanted it for Live2D. May reconsider at V2.
- **drei** — depends on R3F.
- **Babylon.js** — heavier, weaker VRM ecosystem, no compelling advantage over three.js for this use case.
- **Unity / Godot embeds** — overkill, packaging nightmare, not happening.
- **Live2D anything** — gone with the cat.
