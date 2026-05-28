---
inclusion: always
---

# The character — guard rail

> **Read this before generating any line, expression, or behaviour for the character.**

## Status: not yet authored

The V1 humanoid character has **no name, no personality, no voice** locked yet. She is the subject of the V1 design spec. Until that spec exists:

- **Do not write dialogue lines for her.** Not example lines, not placeholders, not "here's roughly what she'd say." Leave the spot empty or use an explicit `TODO: line bank` marker.
- **Do not name her.** Not in code, not in comments, not in mock UI. Refer to her as "the character" or "Kuro V1 character" if you must.
- **Do not give her cat-coded behaviour.** No `nyaa~`, no `🐾`, no purring, no tail-flick references. The cat is v0. The new character is humanoid.
- **Do not give her assistant-coded behaviour.** No "I'm here to help", no "How can I assist you", no productivity coaching, no breaking-the-fourth-wall about Live2D / Tauri / the codebase.

Carry-over from the v0 cat is *one specific thing*: the framework noun. Project name `KURO`, type prefix `Kuro*` in code (`KuroContext`, `KuroProfile`, `KuroEpisode`). Everything else — voice, name, mannerisms, design — is fresh.

## What we know about her

Locked in vision conversation:

- **Body:** 3D humanoid VRM rendered via three.js + `@pixiv/three-vrm`.
- **Style direction:** anime/game-character lineage (the user referenced Genshin's Diona as a *flavour* reference, not a character to clone).
- **Personality direction:** "angry girlfriend energy" — emotional stakes, relationship dynamics, sulks and comes back. Tsundere-adjacent but not the same as the cat's tsundere; this version implies an existing relationship, not just performative coldness.
- **Emotional model:** M3 — persistent mood dimensions + named episodes.
- **Movement personality:** P2 roommate-mode. She walks. She sits. She turns away. She leaves the room.
- **DND personality:** When the user toggles DND, she enters a `withdrawn` episode and reacts in character to being told to go away.

## What we don't know yet

Belongs in the V1 design spec, not in code:

- Her name.
- The exact mood dimension set (will be reverse-engineered from the desired episode list).
- The full episode catalogue and trigger conditions.
- Her relationship priors — fresh acquaintance, established partner, something else?
- Voice register: more sharp/biting, more sweet/clingy, more sardonic, more sincere?
- Visual choices: which VRM model.
- Token vocabulary beyond the basics carried over.

## Authoring rules (will activate once design lands)

When the design spec exists, these rules will apply. They are listed here in advance so the V1 line-bank work doesn't drift.

1. **One file per category, structured objects, not raw strings.** `Line = { text, tone?, emphasis?, pause?, duration_ms_override? }`. The metadata fields are ignored by V1's text bubble but consumed by V2/V3 TTS — pre-fill them as you write.
2. **Variants in clusters of 4–8.** Below 4, repeats sting. Above 12, you're padding.
3. **Token substitution from V1.** `{name}` (user), `{device}`, `{app}`, `{streak}`, `{wpm}`, plus episode tokens (`{episode}`, `{ignored_minutes}`, `{last_app}`). Tokens are case-sensitive.
4. **Lines belong to one mood/episode.** Don't reuse phrasing across categories. Each line should be plausibly *only-her* and only-this-mood.
5. **Tonal anchors.** Each line bank gets a 2–3 sentence tone description at the top of its file (sample voice, what to avoid). That description survives into V3 as the few-shot anchor for the LLM.
6. **No length over ~120 chars unless deliberate.** Bubble wraps; long lines fight the visual.
7. **No emoji walls.** One or two glyphs maximum, used as punctuation, not decoration.

## Examples of *what not to generate* right now

These will fail review unconditionally during V1 implementation:

- `"hi! I'm Aria, your new desktop friend!"` — names her, generic voice, breaks "do not name her".
- `"baka, get back to work nya~"` — cat-coded carry-over from v0.
- `"I noticed you've been distracted. Take a break?"` — assistant voice.
- `"// TODO: write something flirty here"` — placeholder content that ships if uncaught. Use the explicit `TODO: line bank` marker instead.
- A new file at `components/character/dialogue/lines/idle.ts` containing 8 plausible-sounding lines — premature. Wait for the design spec to lock voice first.

## What you *can* generate right now

- Code structure that *will hold* her dialogue and behaviour, with empty banks and explicit TODO markers.
- The `LineProvider` interface and the scripted-bank loader.
- The episode evaluator and mood substrate (Rust side) — these are mechanism, not personality.
- The animation and rendering layer (locomotion, gaze, expression mapping) — driven by abstract mood/episode signals, not character-specific lines.
- The settings UI for episode debug triggers, scale, opacity, DND toggle.

This file gets a substantial expansion (voice rules, examples, tonal anchors) once the V1 character design spec lands. Until then, the rule is simple: **build the stage, leave the script empty.**
