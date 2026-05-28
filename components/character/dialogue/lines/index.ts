/**
 * Line bank — empty in V1.
 *
 * The character's voice is not yet authored. Per
 * `.kiro/steering/character.md`, no placeholder lines are written here:
 * the empty-bank state is the *correct* state until the design spec lands.
 *
 * When the design spec ships, lines get added by category:
 *
 *   ambient: Line[]                                  // generic idle chatter
 *   events: Record<string, Line[]>                   // by event tag
 *   episodes: Record<EpisodeName, {                  // per-episode banks
 *     entry?: Line[]                                 //   one-shot on entry
 *     ambient?: Line[]                               //   said while inside
 *     exit?: Line[]                                  //   on natural exit
 *   }>
 *
 * Each Line is an object with at minimum `text`, optionally TTS metadata
 * (tone, emphasis, pause, duration_ms_override).
 *
 * Tonal anchors (the 2–3 sentence voice description per category) get
 * added as comments inside each file so they survive into V3 as few-shot
 * prompt material for the LLM provider.
 *
 * TODO: line bank — pending design spec
 */

import type { Line } from "../provider";
import type { EpisodeName } from "../../types";

interface EpisodeBank {
    entry?: readonly Line[];
    ambient?: readonly Line[];
    exit?: readonly Line[];
}

export interface LineBank {
    ambient?: readonly Line[];
    events?: Record<string, readonly Line[]>;
    episodes?: Partial<Record<EpisodeName, EpisodeBank>>;
}

export const LINE_BANK: LineBank = {
    // TODO: line bank — pending design spec
};
