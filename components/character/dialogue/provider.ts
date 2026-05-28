/**
 * LineProvider interface.
 *
 * V1 ships a single `ScriptedLineProvider` implementation. V3 will add an
 * `LlmLineProvider` and possibly a router. Same shape, swappable inside.
 *
 * Per `.kiro/steering/character.md`: the V1 character is not yet authored.
 * The line bank is intentionally empty until the design spec lands. Code
 * that calls `getLine` MUST handle a `null` return by saying nothing —
 * never substitute a placeholder string.
 */

import type { EpisodeName, KuroContext, MoodSnapshot } from "../types";

export interface LineRequest {
    /**
     * Optional event tag, e.g. "interaction:click" | "milestone:focus_60"
     * | "episode_entry:withdrawn" | "active_window_change".
     */
    event?: string;
    episode?: EpisodeName | null;
    mood?: MoodSnapshot;
    context?: KuroContext | null;
}

export interface Line {
    text: string;
    /**
     * Optional metadata. V1's text bubble ignores these. V2/V3 TTS reads them.
     */
    tone?: string;
    emphasis?: number;
    pause?: number;
    duration_ms_override?: number;
}

export interface LineProvider {
    getLine(req: LineRequest): Promise<Line | null>;
}

/**
 * Apply token substitution to a raw line.
 *
 * Token vocabulary (V1):
 *   {name}     — context.user_name
 *   {device}   — context.device_name
 *   {app}      — context.current_app
 *   {streak}   — context.focus_streak_minutes
 *   {wpm}      — context.current_wpm
 *   {episode}  — current episode or empty
 *
 * Unknown tokens are left in place rather than silently stripped — that
 * way bad token usage shows up in the bubble during dev rather than
 * disappearing into the void.
 */
export function personalise(text: string, ctx: KuroContext | null, episode: EpisodeName | null): string {
    if (!ctx) return text;
    return text
        .replace(/\{name\}/g, ctx.user_name)
        .replace(/\{device\}/g, ctx.device_name)
        .replace(/\{app\}/g, ctx.current_app || "something")
        .replace(/\{streak\}/g, String(ctx.focus_streak_minutes))
        .replace(/\{wpm\}/g, String(ctx.current_wpm))
        .replace(/\{episode\}/g, episode ?? "");
}
