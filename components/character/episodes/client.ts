/**
 * Episodes client — subscribes to backend episode/mood events and exposes
 * the current state to the rest of the character module.
 *
 * The Tauri event listeners are wired here; the master ticker reads the
 * exposed snapshot via `getSnapshot()`. The component-side code calls the
 * dialogue provider on episode-start to fan out into the speech bubble.
 */

import { isTauri } from "../types";
import type {
    EpisodeEndEvent,
    EpisodeName,
    EpisodeStartEvent,
    KuroContext,
    MoodSnapshot,
} from "../types";

export interface EpisodeSnapshot {
    episode: EpisodeName | null;
    startedAt: number | null;
    expectedDurationSeconds: number | null;
}

export interface EpisodesClient {
    /** Read the current episode + mood + context state. */
    getSnapshot(): {
        episode: EpisodeSnapshot;
        mood: MoodSnapshot;
        context: KuroContext | null;
    };
    /** Hook called when an episode starts. Use for dialogue dispatch. */
    onEpisodeStart(handler: (event: EpisodeStartEvent) => void): void;
    onEpisodeEnd(handler: (event: EpisodeEndEvent) => void): void;
    /** Disconnect all listeners. */
    dispose: () => void;
}

const DEFAULT_MOOD: MoodSnapshot = {
    affection: 0.55,
    annoyance: 0.1,
    attention_hunger: 0.35,
    energy: 0.65,
};

export function createEpisodesClient(): EpisodesClient {
    let episode: EpisodeSnapshot = {
        episode: null,
        startedAt: null,
        expectedDurationSeconds: null,
    };
    let mood: MoodSnapshot = { ...DEFAULT_MOOD };
    let context: KuroContext | null = null;

    const startHandlers: Array<(e: EpisodeStartEvent) => void> = [];
    const endHandlers: Array<(e: EpisodeEndEvent) => void> = [];
    const unlisteners: Array<() => void> = [];

    void wireTauri();

    async function wireTauri() {
        if (!isTauri()) return;
        try {
            const { listen } = await import("@tauri-apps/api/event");

            unlisteners.push(
                await listen<KuroContext>("kuro:context", (e) => {
                    context = e.payload;
                    mood = e.payload.mood;
                    episode = {
                        episode: e.payload.current_episode,
                        startedAt: e.payload.episode_started_at,
                        expectedDurationSeconds: episode.expectedDurationSeconds,
                    };
                }),
            );

            unlisteners.push(
                await listen<MoodSnapshot>("kuro:mood", (e) => {
                    mood = e.payload;
                }),
            );

            unlisteners.push(
                await listen<EpisodeStartEvent>("kuro:episode-start", (e) => {
                    episode = {
                        episode: e.payload.episode,
                        startedAt: e.payload.started_at,
                        expectedDurationSeconds: e.payload.expected_duration_seconds,
                    };
                    for (const h of startHandlers) h(e.payload);
                }),
            );

            unlisteners.push(
                await listen<EpisodeEndEvent>("kuro:episode-end", (e) => {
                    if (episode.episode === e.payload.episode) {
                        episode = {
                            episode: null,
                            startedAt: null,
                            expectedDurationSeconds: null,
                        };
                    }
                    for (const h of endHandlers) h(e.payload);
                }),
            );
        } catch (err) {
            console.debug("[character] Tauri events unavailable:", err);
        }
    }

    return {
        getSnapshot: () => ({ episode, mood, context }),
        onEpisodeStart: (handler) => {
            startHandlers.push(handler);
        },
        onEpisodeEnd: (handler) => {
            endHandlers.push(handler);
        },
        dispose: () => {
            for (const u of unlisteners) {
                try {
                    u();
                } catch {
                    /* swallow */
                }
            }
            unlisteners.length = 0;
            startHandlers.length = 0;
            endHandlers.length = 0;
        },
    };
}
