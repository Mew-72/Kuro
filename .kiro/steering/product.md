---
inclusion: always
---

# KURO — Desktop Companion

## What KURO is
KURO is a framework for a 3D humanoid desktop companion: a transparent, always-on-top, click-through Tauri window with a VRM character living on the user's screen. She watches what the user is doing, has *moods* and *episodes* (not just reactions), occasionally moves around the screen on her own, and quietly persists between sessions.

The project name is **KURO**. The character is a separate concept — a humanoid VRM with her own name, personality, and voice. The character is not yet named or fully designed; she is the subject of the V1 spec. Until then, this codebase has *no canonical character voice* — see `.kiro/steering/character.md` for the guardrail.

## Lineage
A previous iteration shipped a 2D Live2D cat ("LittleCat", also called Kuro). That cat is now treated as the **v0 prototype** — it taught us what the platform needs to be (telemetry pipeline, transparent click-through window, settings architecture). The rebody to a 3D humanoid lives on `humanoid-rebody` and is in active development. Cat code still exists on this branch but is not imported into the new runtime path; it will be archived to `legacy/` after V1 lands on `main`.

## North star
The user should feel that *one specific person* lives on their machine. Not a notification surface. Not an assistant. A roommate with feelings, who has good and bad days, who sometimes sulks, who comes back.

## Locked decisions

These were settled in vision conversation and are the architectural constraints for everything downstream. They are not up for debate inside individual implementation tasks; they are revisited explicitly when the staging plan moves to the next version.

| Decision | Locked answer |
| --- | --- |
| Identity | New humanoid character. Project name stays KURO. Cat archived as v0. |
| Agency ceiling — V1 | Observer only. No outbound effects on the system besides her own window. |
| Agency ceiling — V2 | L1 capability allowlist (typed Rust commands, opt-in per capability, audit log). Designed during V1, built in V2. |
| Agency ceiling — V3+ | L2/L3 deferred. Plan toward, do not build. Gated on personality engine maturity. |
| Emotional model | **M3** — mood dimensions (continuous floats) as substrate, named *episodes* as storytelling layer. DND is a manual-but-in-character `withdrawn` episode. |
| Personality engine — V1 | Scripted via a `LineProvider` interface. Single implementation: scripted bank, indexed by `(episode, mood, event)` with token substitution. |
| Personality engine — V3 | LLM colour layer slots into the same interface. Cloud vs local decided at V3 design time, interface designed open from V1. |
| Voice — V1 | Text-only. No audio output. No microphone. |
| Voice — V2/V3 | TTS lands by V3 at the latest. Local vs cloud designed open. |
| Voice — V3/V4 | STT lands by V4 at the latest, gated on LLM. Trigger model (PTT vs wake word vs always-listening) decided when it ships. |
| Movement | **P2 roommate-mode**. Walks across the screen, has favourite spots, episodes drive locomotion. |
| Telemetry | Stays local. No data leaves the device unless an explicit V3+ cloud feature requires it, and only with user consent. |

## Deferred decisions

Decisions intentionally pushed to the design phase of the relevant version. Listed here so future work knows to ask before guessing.

- Character name and personality. Not authored yet. Belongs in V1 design spec.
- Mood dimension set (4 / 5 / Russell's 2D / custom). Will be reverse-engineered from the desired episode list during V1 design.
- Concrete episode list (jealous, pouty, gleeful, clingy, huffy, withdrawn, etc.) — names sketched, behaviours not specified.
- Multi-monitor behaviour: primary-by-default, follow-active, or user-pinned. V1 design call.
- Perches: virtual floor (V1) vs taskbar/window-aware perches (V2 likely). V1 design decides V1 scope.
- TTS exact version (V2 or V3) and direction (local / cloud).
- STT exact version (V3 or V4), trigger model.
- LLM target (cloud / local) — locked at "designed open" for now, decided at V3.
- L1 capability allowlist contents — designed during V1, built V2.
- VRM model selection (which character, which rig). Constraint: must support full mouth blendshapes (visemes ≥ 5, ARKit 52 if available) so V2/V3 TTS lip-sync is cheap.

## Core experience pillars (V1)

1. **A character, not a system.** She has a name, a personality, and a voice. Authored, deliberate, in-character. No "I'm here to help" language.
2. **She has moods.** Persistent emotional state (mood dimensions) decays over time and shifts based on what you do. Same event lands differently depending on context.
3. **She has episodes.** Narrative emotional states (jealous, pouty, clingy, withdrawn, gleeful, huffy) triggered by event patterns. DND is one of them. Episodes drive behaviour: dialogue, movement, expression.
4. **She has presence.** Roommate-mode: she walks, sits, turns away, leaves the room. Spatial behaviour is part of personality.
5. **She reacts to what's actually happening.** Telemetry-grounded — typing speed, foreground app, idle state, system health, time of day, session totals. The episode triggers reach into all of it.
6. **She remembers.** Profile persists across restarts. Lifetime stats, mood baseline, episode history (so she doesn't repeat the same trick on the same day).
7. **She never gets in your way.** Click-through everywhere except over her body. Cooldowns prevent chatter spam. DND works.

## Feature surface — V1

### Telemetry-driven inputs (carried over from v0, kept)
Active-window classification (`coding | researching | learning | entertainment | distracted | gaming | music | idle | unknown`), typing speed (rolling-window WPM via global `rdev`), idle detection (`Sleeping` 10 min / `Wandering` 30 min / `Returned`), system health (CPU / RAM / battery), session stats (resets at midnight), lifetime stats, time-of-day labels.

### Emotional system (new, V1)
- Mood dimensions module on the Rust side: continuous floats, decay over time, mutated by telemetry events.
- Episode evaluator: pattern-matches on recent events + mood vector, fires episodes with bounded duration, manages exit conditions and per-day cooldowns.
- `KuroContext` (the frontend payload) gains a `mood` block and a `current_episode` field.

### Character runtime (new, V1)
- VRM-based humanoid rendered in three.js inside the Tauri window.
- Layered animation: locomotion + idle pose + gaze IK + expression blendshapes + speech-bubble overlay. Layered, not switched — multiple layers run simultaneously.
- Spatial behaviour: virtual floor along screen bottom, walk cycle, sit/stand poses, look-at the cursor / active window edge.
- Click-through hit-area follows the character's bounding box (replaces the v0 fixed bottom-250-px region).

### Dialogue system (new, V1)
- `LineProvider` interface — single V1 implementation reads from a structured scripted bank.
- Lines are objects (`{text, tone?, emphasis?, pause?, duration_ms_override?}`), not raw strings, so V2/V3 TTS lands cheap.
- Token substitution carries forward and grows: `{name}`, `{device}`, `{app}`, `{streak}`, `{wpm}`, plus episode-relevant tokens (`{ignored_minutes}`, `{episode}`, `{last_app}`).
- Priority pipeline: episodes override defaults; mood biases random sampling; cooldowns prevent chatter spam.

### Direct interaction (V1)
- Cursor proximity → gaze.
- Click → headpat-equivalent (body language reaction, tunes affection up).
- Drag → physically move the character / window.
- Right-click → in-character settings open.
- Manual DND toggle → triggers the `withdrawn` episode with a personality-appropriate exit line and reentry line.

### Settings (V1)
- Scale, opacity, character placement (monitor, side).
- Movement on/off (parks her if you want her stationary).
- Dialogue overlay on/off, dialogue interval / cooldown.
- DND toggle (manual entry to `withdrawn` episode).
- Late-night mode.
- Debug: force-trigger an episode for development.

## Staging plan

| Version | Theme | Headline scope |
| --- | --- | --- |
| **V1** | Rebody + emotional model | VRM character, M3 mood/episode system, scripted dialogue, roommate-mode movement, manual DND. Observer-only. |
| **V2** | Agency tier | L1 capability allowlist (media control, app launch, URL open, screenshots, clipboard, reminders). Each capability is a personality hook. *TTS may land here.* |
| **V3** | Voice + intelligence | LLM colour layer behind `LineProvider`. TTS definite. STT may land here. Conversational moments. |
| **V4** | Refinement | STT definite if not already shipped. Wake word / PTT trigger. Long-term relationship arc considerations. |

Versions are scope envelopes, not deadlines. A version ships when the locked decisions in its column are credible in daily use, not on a date.

## Non-goals

- **No multi-character framework.** One character. Skins are cosmetic if/when they exist. Not "pluggable personalities" — that's a different product.
- **No telemetry leaving the device.** Local-only by default. V3+ cloud features require explicit consent and never ship-on-by-default.
- **No productivity-coach framing.** She has feelings about your behaviour. She does not coach, lecture, or moralise.
- **No agentic tier in V1.** No tool use, no shell commands, no typing into windows. Even if the V3 LLM is plumbed in, it does not get tools until L2/L3 ships in a later version under the L1 permission model.
- **No always-listening microphone.** Even in V4 with STT, default trigger is push-to-talk or wake word. Always-listening is opt-in and explicit.
- **No assistant voice.** "I noticed you've been distracted, would you like to refocus?" is out of scope, out of voice, and out of product.
