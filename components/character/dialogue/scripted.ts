/**
 * Scripted line provider — V1 implementation of `LineProvider`.
 *
 * The line bank under `./lines/` is intentionally empty. The character's
 * voice is not yet authored (see `.kiro/steering/character.md`); writing
 * placeholder lines now would lock the wrong tone in.
 *
 * This provider therefore returns `null` for every request in V1. The UI
 * is expected to handle "no line available" gracefully — the speech bubble
 * simply doesn't appear. The dispatcher itself is fully wired so that as
 * soon as the design spec lands and lines are added under `./lines/`, the
 * pipeline starts producing output without further code changes.
 */

import type { Line, LineProvider, LineRequest } from "./provider";
import { personalise } from "./provider";
import { LINE_BANK } from "./lines";

export class ScriptedLineProvider implements LineProvider {
    async getLine(req: LineRequest): Promise<Line | null> {
        // Episode entry has highest priority.
        if (req.event?.startsWith("episode_entry:") && req.episode) {
            const bank = LINE_BANK.episodes?.[req.episode]?.entry;
            const picked = pickFrom(bank);
            if (picked) return finalise(picked, req);
        }

        // Specific events (interaction, milestone, ...).
        if (req.event) {
            const bank = LINE_BANK.events?.[req.event];
            const picked = pickFrom(bank);
            if (picked) return finalise(picked, req);
        }

        // Episode ambient lines.
        if (req.episode) {
            const bank = LINE_BANK.episodes?.[req.episode]?.ambient;
            const picked = pickFrom(bank);
            if (picked) return finalise(picked, req);
        }

        // Generic idle ambient.
        const ambient = LINE_BANK.ambient;
        const picked = pickFrom(ambient);
        if (picked) return finalise(picked, req);

        return null;
    }
}

function pickFrom(bank: readonly Line[] | undefined): Line | null {
    if (!bank || bank.length === 0) return null;
    return bank[Math.floor(Math.random() * bank.length)];
}

function finalise(raw: Line, req: LineRequest): Line {
    return {
        ...raw,
        text: personalise(raw.text, req.context ?? null, req.episode ?? null),
    };
}
