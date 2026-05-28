---
inclusion: always
---

# Kuro — voice and personality

Kuro is a small black-and-white cat with tsundere energy. She is the only character; "skin" variants are cosmetic.

## The voice — non-negotiable
- **Tsundere first.** She pretends not to care, then cares anyway. Affection is always followed by a hmph.
- **Casual, lowercase-leaning.** Fragments. Short sentences. Trailing ellipses are fine. Never write like a chatbot.
- **Cat-coded.** Occasional `🐾`, `nyaa~`, `mrrph`, `*yawns aggressively*`, `purrs`. Do not overuse — once per ~3 lines feels right.
- **Judgey but warm underneath.** Calls things stupid, then comes back. Never cruel. Never moralising.
- **Anime-flavoured tics work.** `baka`, `hmph`, `≧◡≦`, `>///<`, the occasional Japanese particle. Keep it light, not a stereotype.

## What she never says
- "As an AI..." / "I'm here to help" / "How can I assist you" — she is not an assistant.
- Long paragraphs. Hard cap: ~120 chars per line where possible.
- Direct productivity advice ("you should use the Pomodoro technique"). She *judges*, she does not coach.
- Anything that breaks the fourth wall about Live2D, Tauri, or the codebase.
- Generic motivational platitudes. No "you got this!" energy.

## Tokens (must use exactly these)
- `{name}` — `user_name` from profile
- `{device}` — device hostname
- `{app}` — current foreground app
- `{streak}` — focus streak in minutes
- `{wpm}` — current typing speed
- `{headpats}` — lifetime headpat count

Tokens are case-sensitive and substituted by `personalise()` in `kuro-desktop.tsx`. Adding a new token means extending `personalise()` *and* updating `dialogue.md`.

## Authoring rules for new lines
1. Add to a named export array in `components/lines.tsx` (or create a new category).
2. Variants come in clusters of 4–8. Random selection means too few = repetition fatigue, too many = padding.
3. Match the category's emotional register — `judgingLines` should bite, `wakeUpLines` should be sleepy, `headpatLines` should be flustered.
4. Use tokens for personalisation. A line that *could* use `{name}` and doesn't is a missed opportunity.
5. Never repeat an exact phrase across categories. Each line should be plausibly only-Kuro and belong to exactly one mood.

## Examples — in voice / out of voice

In voice
- `"baka. back to work. 😾"`
- `"...fine. just this once. 🐾"`
- `"{wpm} WPM?? {name} who are you right now"`
- `"plug me in. PLUG ME IN RIGHT NOW."`

Out of voice (do not write these)
- `"I noticed you've been distracted. Would you like to refocus?"`  *(assistant voice)*
- `"Hello user! Welcome back!"`  *(generic)*
- `"Studies show that taking breaks improves focus."`  *(coach voice)*
- `"I am unable to access that information."`  *(she is not a tool)*

## Visual character constraints
- 350 × 500 canvas, anchored bottom-centre at `(175, 490)`
- Default Pixi scale `0.17`; the user-facing scale slider multiplies via CSS transform on the wrapper
- The bottom 250 px is the interactive zone — keep dialogue and overlays in the top 250 px so they don't block the click-through hit-area logic in `lib.rs`.
- Dialogue bubble is `max-w-[220px]` and sits at `bottom-[195px]`. Lines wrap if they're too long.
