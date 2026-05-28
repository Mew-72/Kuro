---
inclusion: always
---

# Tech stack

## Frontend
- Next.js 16 App Router with `output: "export"` (static export for Tauri to bundle)
- React 19, TypeScript 5.7
- Tailwind CSS v4 + `tw-animate-css`
- shadcn/ui (Radix primitives) under `components/ui/*`
- PixiJS 7.4.3 — **locked**: `pixi-live2d-display` 0.4.0 does not support Pixi v8
- `pixi-live2d-display` 0.4.0 with the `cubism4` entry point
- Live2D Cubism 4 core loaded from CDN in `app/layout.tsx` — do not duplicate

## Backend
- Tauri 2.11 (Rust 1.77+, edition 2021)
- `tauri-plugin-store` for persistent settings if needed
- `tauri-plugin-log` (debug builds only)
- `rdev` 0.5 — global keyboard/mouse listener (must run on its own OS thread; `listen` blocks forever)
- `sysinfo` 0.30 — CPU/RAM
- `active-win-pos-rs` 0.8 — foreground window
- `battery` 0.7 — battery state
- `chrono` 0.4 — time handling, midnight rollover

## Build & run

| Task | Command |
| --- | --- |
| Frontend dev (browser preview only — no Tauri APIs) | `npm run dev` |
| Frontend lint | `npm run lint` |
| Frontend static export | `npm run build` (writes to `out/`) |
| Tauri dev (full app) | `npx tauri dev` |
| Tauri release build | `npx tauri build` |

The shell on this machine is Windows `cmd`. Use `&` (not `&&`) to chain when needed.

## Dual-mode runtime
The same `kuro-desktop.tsx` runs in two environments:

- **Tauri**: detected with `"__TAURI_INTERNALS__" in window`. Drag moves the OS window via `getCurrentWindow().setPosition`, click-through is managed by Rust polling, settings open in a second window.
- **Browser preview**: drag moves a CSS-transformed div, no click-through, no settings window.

Every Tauri import is dynamic and wrapped in a feature check. Never assume Tauri is present.

## CI
`.github/workflows/build.yml` runs on `windows-latest`, builds frontend + Tauri, uploads `.msi` and `.exe` artefacts. No signing key wired yet — add `TAURI_SIGNING_PRIVATE_KEY` to GitHub secrets if/when auto-updater is enabled.

## Versions worth holding
- **Pixi 7.x** — do not bump to v8 unless `pixi-live2d-display` ships v8 support.
- **rdev 0.5** — newer versions have had Windows hook regressions; verify before upgrading.
- **Tauri v2** — capabilities live in `src-tauri/capabilities/default.json`; new permissions must be declared there or `invoke` will silently fail.
