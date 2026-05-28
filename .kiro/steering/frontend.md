---
inclusion: fileMatch
fileMatchPattern: 'components/**'
---

# Frontend — character runtime rules

## What this file is for

V1 introduces a 3D humanoid character (VRM via three.js + `@pixiv/three-vrm`) that replaces the v0 Live2D cat. This file governs how the character module is built. It's the contract that lets multiple implementation tasks land cleanly without each one redesigning the rendering / animation / dialogue surface.

The cat module under `components/kuro/*` and `components/lines.tsx` is **frozen reference**. Read it for context; do not edit it; do not import from new code.

## Module layout (target)

```
components/character/
├── character.tsx            # <KuroCharacter> — top-level component, lifecycle, Tauri events
├── renderer.ts              # three.js scene, camera, transparent canvas
├── vrm.ts                   # VRM load, rig handles, blendshape helpers
├── animation/
│   ├── ticker.ts            # The single master loop
│   ├── locomotion.ts        # Walk cycle, idle sway, sit/stand transitions
│   ├── gaze.ts              # Look-at IK (cursor, active-window edge, points of interest)
│   └── expression.ts        # Mood + episode → blendshape mapping
├── dialogue/
│   ├── provider.ts          # LineProvider interface — V3 LLM swap point
│   ├── scripted.ts          # V1 implementation — reads from line bank
│   └── lines/               # Empty in V1 until the design spec lands
└── episodes/
    └── client.ts            # Subscribes to kuro:episode-* events, fans into animation+dialogue
```

`components/kuro/*` and `components/lines.tsx` stay in place during V1 development as frozen reference. They migrate to `legacy/cat-v0/` once V1 lands on `main`.

## The single ticker rule

There is **one** animation loop callback in the character module — `animation/ticker.ts`. All per-frame logic branches inside it: locomotion, idle pose, gaze IK, expression blending, position lerping, blendshape application. Do not add a second `requestAnimationFrame` loop. Do not animate from React effects.

This is the same rule that applied to the cat's PixiJS ticker, for the same reasons: predictability, single source of frame time, easy to pause/throttle, no race conditions between layers.

## Layered animation, not switched

The cat had a state machine where each state was a *complete* parameter signature — `idle` overwrote everything, `judging` overwrote everything. With a humanoid, that's wrong. Animation is *layered*:

| Layer | Driven by | Example |
| --- | --- | --- |
| Locomotion | Episode + free-roam timer | walk / stand / sit / lie |
| Pose | Episode + mood | turned away, leaning, arms crossed |
| Idle motion | Always on | breathing, weight shift, micro head turns |
| Gaze | Cursor proximity + active window + episode override | look at cursor / look at app / pointedly look away |
| Expression | Mood + episode + event spike | resting expression blends with reactive blendshapes |
| Speech bubble | Dialogue dispatcher | text overlay, V2/V3 lip-sync |

Layers compose every frame. Episode entry doesn't *replace* the idle motion — it biases the layers above it. `withdrawn` (DND) sets locomotion to "walk off-screen", overrides gaze to "down", and biases expression toward sad/annoyed. Idle breathing keeps running underneath.

## Lerp, never snap

State transitions interpolate every animated value toward its target each frame. Same constraint that applied to the cat's parameters, now extended to humanoid bones, blendshape weights, and gaze targets. Pose changes (e.g. arms unfolding, head turning) take ~0.3–0.8 seconds depending on intensity. Expression changes are faster (~0.15–0.3 s). Position lerps stay around 0.05 per frame as in v0.

When an instant cut is needed (e.g. teleport for DND off-screen exit, then walk on from the other side), do it with a deliberate hidden frame, not a snap during visible time.

## Lifecycle rules

- three.js `WebGLRenderer` and the loaded VRM are created **once** in a single `useEffect` with `[]` deps. Destroyed only on final unmount.
- No state-change effect, timer, or settings change is allowed to dispose the renderer or the VRM. The animation loop must outlive React re-renders.
- The component must be dynamically imported with `ssr: false` and have `"use client"` at the top.
- VRM loading is async; show a non-intrusive "loading" overlay until ready. Never block the page on it.
- Boot waits a bounded time for the VRM to load. On failure, show a friendly error overlay — do not crash, do not throw.

## Renderer setup constraints

- Canvas is **transparent**: `WebGLRenderer({ alpha: true, premultipliedAlpha: false })` and `setClearColor(0x000000, 0)`.
- `antialias: true`, `powerPreference: "high-performance"` (we run on whatever GPU is available, not always great).
- Resolution: device pixel ratio capped at 2 to avoid murdering retina laptops on integrated GPUs.
- Camera: orthographic or perspective with a tight FOV — VRM character occupies most of the canvas height, no perspective distortion at the edges.
- No shadows in V1. Optional in V2 if performance allows (most desktop pets ship without shadows; the cost-to-benefit is poor).

## Click-through hit-area

The Rust polling thread toggles `set_ignore_cursor_events` based on cursor position. In v0 the hit-area was a fixed bottom 250 px. In V1 the character moves and may not be in a fixed location.

V1 simplification: the *entire window* is the hit-area when the cursor is over it, but the dialogue bubble is drawn outside the window or as a separate non-interactive layer. Re-evaluate at V2 if it feels wrong; sub-window hit-area requires the frontend to publish character bounding box to Rust each frame, which is doable but more plumbing than V1 needs.

## Dual-mode runtime (Tauri + browser)

The `KuroCharacter` component must continue to run in both:

- **Tauri** — drag moves the OS window via `getCurrentWindow().setPosition`. Click-through managed by Rust. Settings open in a second Tauri window.
- **Browser preview** — drag moves the wrapper div via CSS transform. No click-through. No settings window.

Every Tauri import is dynamic and feature-checked. `"__TAURI_INTERNALS__" in window` is the test. Browser preview is the development fast-path; do not break it.

## VRM rig requirements

The chosen VRM model must support:

- **Humanoid bones** — full set, especially head, neck, spine, shoulders, hands. Required for pose and gaze.
- **Mouth blendshapes** — visemes (`A`, `I`, `U`, `E`, `O`) at minimum. ARKit-style 52 blendshapes preferred. Required for V2/V3 lip-sync.
- **Expression blendshapes** — `happy`, `sad`, `angry`, `surprised`, `relaxed`, `neutral` at minimum. Episode expression mapping reads from these.
- **Spring bones** — for hair/clothing. Look-at-controller compatibility (or driven manually).

If a chosen model is missing required blendshapes, that's a design-spec problem, not a runtime workaround. Pick a different model.

## Dialogue dispatcher contract

The frontend asks for a line via a single function:

```ts
interface LineRequest {
  event?: string;            // "headpat" | "milestone:focus_60" | "episode_entry:withdrawn" | ...
  episode?: string | null;   // current episode if any
  mood?: MoodSnapshot;       // current mood vector
  context?: KuroContextSnapshot;  // for token substitution
}

interface Line {
  text: string;
  tone?: string;
  emphasis?: number;
  pause?: number;
  duration_ms_override?: number;
  // ... metadata fields ignored by V1, consumed by V2/V3 TTS
}

interface LineProvider {
  getLine(req: LineRequest): Promise<Line | null>;
}
```

V1 ships `ScriptedLineProvider implements LineProvider`. V3 will add `LlmLineProvider` and possibly a `RouterLineProvider` that picks per-request. Same shape, swappable inside.

The line bank under `dialogue/lines/` stays empty in V1 until the design spec lands the character voice. See `.kiro/steering/character.md` for the guard rail.

## Things deliberately not done in V1 frontend

- **No LLM calls.** Scripted only. The interface is shaped for it; the implementation isn't there.
- **No audio.** No TTS playback, no microphone. V2/V3.
- **No outbound system effects.** No clipboard writes, no URL opens, no app launches. V2 under L1 agency.
- **No `react-three-fiber`.** Vanilla three.js inside a `useEffect`. R3F is reconsiderable at V2 if its benefits start outweighing the loss of explicit lifecycle control.
- **No physics engine.** Spring bones from `@pixiv/three-vrm` only. No `rapier`, no `cannon`. The character doesn't fall, doesn't collide with windows, doesn't simulate cloth beyond what the VRM rig provides natively.
