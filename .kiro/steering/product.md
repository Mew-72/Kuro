---
inclusion: always
---

# KURO — Desktop Companion

## What KURO is
KURO is a Live2D cat ("LittleCat") that lives on the user's desktop as a transparent, always-on-top, click-through Tauri window. She watches what the user is doing, reacts in character, and quietly persists between sessions. The only character is **Kuro** — a tsundere who pretends not to care.

## North star
The user should feel that *one specific cat* lives on their machine. Not an assistant, not a notification surface. A roommate.

## Core experience pillars

1. **She knows you.** Your name, your device, how long you've lived together, your habits, your peak WPM, your headpat count. Personalisation is built into every line via tokens.

2. **She reacts to what's actually happening.** Battery dying, CPU pegged, you opened Twitter, you've been focused for an hour, it's 2 AM and you're still at it — every reaction is grounded in real telemetry from the Rust backend.

3. **She never gets in your way.** The window is click-through except over the character body. Dialogue bubbles never block input. Cooldowns prevent chatter spam. Settings live in a separate window so the main canvas stays pure.

4. **She's alive, not animated.** No canned `.motion3.json` clips at runtime — every animation is hand-driven on a single PixiJS ticker, lerped between target parameters every frame. Idle breathing, blinking, eye tracking, walk cycles when wandering: all parameter math.

5. **She remembers.** Profile (name, device, first-launch date, lifetime totals, peak WPM, longest streak) persists in `kuro-profile.json` and survives restarts.

6. **She's a tsundere, all the way down.** Voice never breaks — see `.kiro/steering/character.md`. The personality is the product.

## Feature surface

### Telemetry-driven reactions (Rust → frontend events)
- Active-window classification: `coding | researching | learning | entertainment | distracted | gaming | music | idle | unknown`
- Typing speed (WPM, rolling 60s window via global `rdev` listener)
- Idle detection with `Sleeping` (10 min) and `Wandering` (30 min) thresholds, plus a `Returned` event when the user comes back
- System health: CPU %, RAM %, battery %, charging state, with thresholds for low/critical alerts
- Session stats (resets at midnight): coding minutes, distracted minutes, idle minutes, current focus streak, longest streak today, peak WPM today
- Lifetime stats: days active, total coding hours, total headpats, longest streak ever, peak WPM ever

### Milestones
- Focus streak: 25 / 60 / 120 minutes
- New peak WPM (today, only when above noise floor of 20 WPM)
- Distracted majority (more distracted minutes than coding today)
- Headpat counts: 10 / 50 / 100 / 500
- Anniversaries: 7 / 30 / 100 days *(scaffold ready in `lines.tsx`, not yet wired to fire)*

### Direct interaction
- Left-click → `headpat`
- Double-click (≤350 ms) → `excited`
- Right-click → `judging` + opens settings window
- Drag → moves the OS window (Tauri) or the cat (browser)
- Shake (drag velocity > 80 px/frame) → `excited` with shake dialogue
- Click spam (>5 clicks in 2 s) → `annoyed`
- Edge-bump dialogue chance during browser drag

### Dialogue system
- Priority pipeline: battery critical > battery low > CPU high > RAM high > distracted activity > late-night long session > random idle chatter
- Token replacement: `{name}`, `{device}`, `{app}`, `{streak}`, `{wpm}`, `{headpats}`
- 3-minute cooldown between random lines; 60% chance of silence on each random tick
- Bubble auto-fades after 4–5 seconds

### Customisation
- Scale (0.5×–2.0×), Opacity (30 %–100 %)
- Wandering on/off, Dialogue overlay on/off, Dialogue interval (15s/30s/1m/5m), Late-night mode on/off
- Skin variants (calico/white/black) — UI ready, asset/swap logic still to be wired
- Keyboard shortcuts `1`–`7` for direct state triggers, `Esc` closes settings

### States (the FSM)
`idle`, `typing_slow`, `typing_fast`, `sleeping`, `judging`, `headpat`, `excited`, `wandering`

### Window behaviour (Tauri)
- Transparent, frameless, always-on-top, no shadow, fixed 350 × 500
- Click-through everywhere *except* the bottom 250 px (the character body)
- Polled cursor-position thread in Rust toggles `set_ignore_cursor_events` every 50 ms
- Separate `settings` window opens on demand, hidden by default

## Non-goals
- No chat / LLM integration. Kuro's personality is hand-written in `lines.tsx`. She does not "respond" — she *reacts*.
- No telemetry leaving the device. Everything stays local.
- No multi-character system. Skins change the look, not the soul.
- No productivity-coach framing. She judges you because she's a cat, not because she's a tool.
