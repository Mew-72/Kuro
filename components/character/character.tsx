"use client";

import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";

import { CANVAS_H, CANVAS_W, createRenderer } from "./renderer";
import { loadVrm, VRM_MODEL_PATH } from "./vrm";
import { startTicker, type TickerInputs } from "./animation/ticker";
import { createEpisodesClient } from "./episodes/client";
import { ScriptedLineProvider } from "./dialogue/scripted";
import type { Line } from "./dialogue/provider";
import type {
    ActiveWindowEvent,
    EpisodeName,
    EpisodeStartEvent,
    IdleEvent,
    KuroContext,
    MilestoneEvent,
    MoodSnapshot,
    SystemHealthAlert,
    TypingSpeedEvent,
} from "./types";
import { isTauri } from "./types";
import { DEFAULT_SETTINGS, type KuroSettings } from "./settings";

export interface KuroCharacterHandle {
    /** Force-trigger an episode (debug). Mirrors backend `force_episode` command. */
    forceEpisode: (name: EpisodeName) => void;
    /** Toggle DND. Mirrors backend `set_dnd` command. */
    setDnd: (enabled: boolean) => void;
}

const DIALOGUE_VISIBLE_MS = 4500;

/**
 * Move the OS window (Tauri) to absolute screen coordinates.
 * Browser preview falls back to a no-op; the wrapper div uses CSS transform
 * for in-page dragging instead.
 */
async function moveWindow(x: number, y: number): Promise<void> {
    if (!isTauri()) return;
    try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { LogicalPosition } = await import("@tauri-apps/api/dpi");
        await getCurrentWindow().setPosition(new LogicalPosition(x, y));
    } catch {
        /* swallow — window operations are best-effort */
    }
}

const KuroCharacter = forwardRef<KuroCharacterHandle, {}>((_props, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadProgress, setLoadProgress] = useState(0);
    const [dialogue, setDialogue] = useState<string | null>(null);
    const [settings, setSettings] = useState<KuroSettings>(DEFAULT_SETTINGS);

    // Mutable inputs the ticker reads each frame.
    const tickerInputsRef = useRef<TickerInputs>({
        mood: { affection: 0.55, annoyance: 0.1, attention_hunger: 0.35, energy: 0.65 },
        episode: null,
        cursor: null,
        windowSize: { width: CANVAS_W, height: CANVAS_H },
        dragging: false,
    });

    const contextRef = useRef<KuroContext | null>(null);
    const dialogueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ---- Browser-mode position state (CSS transform). Tauri uses moveWindow. ----
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [mounted, setMounted] = useState(false);
    const dragInfo = useRef({
        active: false,
        offX: 0,
        offY: 0,
        screenStartX: 0,
        screenStartY: 0,
        windowStartX: 0,
        windowStartY: 0,
    });
    const currentAbsolutePosRef = useRef({ x: 0, y: 0 });

    // ---- Imperative API ----
    const forceEpisode = useCallback((name: EpisodeName) => {
        if (!isTauri()) return;
        void import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("force_episode", { name }).catch(() => { });
        });
    }, []);

    const setDnd = useCallback((enabled: boolean) => {
        if (!isTauri()) return;
        void import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("set_dnd", { enabled }).catch(() => { });
        });
    }, []);

    useImperativeHandle(ref, () => ({ forceEpisode, setDnd }), [forceEpisode, setDnd]);

    // ---- Speech bubble dispatcher ----
    const showLine = useCallback((line: Line) => {
        if (!settings.dialogue) return;
        if (dialogueTimerRef.current) clearTimeout(dialogueTimerRef.current);
        setDialogue(line.text);
        const visibleMs = line.duration_ms_override ?? DIALOGUE_VISIBLE_MS;
        dialogueTimerRef.current = setTimeout(() => setDialogue(null), visibleMs);
    }, [settings.dialogue]);

    // ---- Boot: renderer + VRM + ticker. Single useEffect, [] deps. ----
    useEffect(() => {
        let cancelled = false;
        const cleanup: Array<() => void> = [];

        async function boot() {
            if (!canvasRef.current) return;
            try {
                const bundle = createRenderer(canvasRef.current);
                cleanup.push(() => bundle.dispose());

                const vrm = await loadVrm(VRM_MODEL_PATH, (loaded, total) => {
                    if (!cancelled) setLoadProgress(loaded / total);
                });
                if (cancelled) {
                    vrm.dispose();
                    return;
                }
                cleanup.push(() => vrm.dispose());

                const ticker = startTicker(bundle, vrm, tickerInputsRef.current);
                ticker.start();
                cleanup.push(() => ticker.stop());

                setReady(true);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error("[character] boot failed:", e);
                if (!cancelled) setError(msg);
            }
        }
        void boot();

        return () => {
            cancelled = true;
            for (const fn of cleanup.reverse()) {
                try {
                    fn();
                } catch {
                    /* swallow */
                }
            }
        };
        // Deps intentionally empty — renderer/VRM lifecycle must outlive React updates.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Episodes client + dialogue dispatch ----
    useEffect(() => {
        const provider = new ScriptedLineProvider();
        const client = createEpisodesClient();

        const tickInputs = tickerInputsRef.current;

        // Pump backend snapshots into the ticker inputs every animation frame.
        let raf = 0;
        const pump = () => {
            const snap = client.getSnapshot();
            tickInputs.mood = snap.mood;
            tickInputs.episode = snap.episode.episode;
            contextRef.current = snap.context;
            raf = requestAnimationFrame(pump);
        };
        raf = requestAnimationFrame(pump);

        client.onEpisodeStart(async (e: EpisodeStartEvent) => {
            const line = await provider.getLine({
                event: `episode_entry:${e.episode}`,
                episode: e.episode,
                mood: tickInputs.mood,
                context: contextRef.current,
            });
            if (line) showLine(line);
        });

        return () => {
            cancelAnimationFrame(raf);
            client.dispose();
        };
    }, [showLine]);

    // ---- Backend events that drive dialogue (non-episode) ----
    useEffect(() => {
        if (!isTauri()) return;
        const unlisteners: Array<() => void> = [];
        const provider = new ScriptedLineProvider();

        void (async () => {
            try {
                const { listen } = await import("@tauri-apps/api/event");

                unlisteners.push(
                    await listen<TypingSpeedEvent>("kuro:typing-speed", () => {
                        // V1: typing speed feeds animation indirectly via mood deltas;
                        // we don't dispatch dialogue here.
                    }),
                );

                unlisteners.push(
                    await listen<ActiveWindowEvent>("kuro:active-window", async () => {
                        const line = await provider.getLine({
                            event: "active_window_change",
                            episode: tickerInputsRef.current.episode,
                            mood: tickerInputsRef.current.mood,
                            context: contextRef.current,
                        });
                        if (line) showLine(line);
                    }),
                );

                unlisteners.push(
                    await listen<IdleEvent>("kuro:idle", async (e) => {
                        const tag = `idle:${e.payload.type.toLowerCase()}`;
                        const line = await provider.getLine({
                            event: tag,
                            episode: tickerInputsRef.current.episode,
                            mood: tickerInputsRef.current.mood,
                            context: contextRef.current,
                        });
                        if (line) showLine(line);
                    }),
                );

                unlisteners.push(
                    await listen<SystemHealthAlert>("kuro:system-health", async (e) => {
                        const line = await provider.getLine({
                            event: `health:${e.payload.alert_type}`,
                            episode: tickerInputsRef.current.episode,
                            mood: tickerInputsRef.current.mood,
                            context: contextRef.current,
                        });
                        if (line) showLine(line);
                    }),
                );

                unlisteners.push(
                    await listen<MilestoneEvent>("kuro:milestone", async (e) => {
                        const line = await provider.getLine({
                            event: `milestone:${e.payload.milestone_type}`,
                            episode: tickerInputsRef.current.episode,
                            mood: tickerInputsRef.current.mood,
                            context: contextRef.current,
                        });
                        if (line) showLine(line);
                    }),
                );

                unlisteners.push(
                    await listen<KuroSettings>("kuro:settings-updated", (e) => {
                        setSettings(e.payload);
                        // Mirror DND flag onto the backend
                        if (e.payload.dnd !== settings.dnd) setDnd(e.payload.dnd);
                    }),
                );
            } catch (err) {
                console.debug("[character] event wiring failed:", err);
            }
        })();

        return () => {
            for (const u of unlisteners) {
                try {
                    u();
                } catch {
                    /* swallow */
                }
            }
        };
    }, [showLine, setDnd, settings.dnd]);

    // ---- Initial position + window-size + cursor tracking ----
    useEffect(() => {
        const tauri = isTauri();
        if (tauri) {
            const screenW = window.screen.availWidth;
            const screenH = window.screen.availHeight;
            const initX = screenW - CANVAS_W - 24;
            const initY = screenH - CANVAS_H - 24;
            currentAbsolutePosRef.current = { x: initX, y: initY };
            void moveWindow(initX, initY);
            setPos({ x: 0, y: 0 });
        } else {
            const initX = window.innerWidth - CANVAS_W - 24;
            const initY = window.innerHeight - CANVAS_H - 24;
            setPos({ x: initX, y: initY });
            currentAbsolutePosRef.current = { x: initX, y: initY };
        }
        setMounted(true);

        const onPointerMove = (e: PointerEvent) => {
            tickerInputsRef.current.windowSize = {
                width: CANVAS_W,
                height: CANVAS_H,
            };

            // Cursor relative to the wrapper, for gaze tracking.
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (rect) {
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
                    tickerInputsRef.current.cursor = { x, y };
                } else {
                    tickerInputsRef.current.cursor = null;
                }
            }

            // Drag handling
            if (!dragInfo.current.active) return;
            if (tauri) {
                const screenW = window.screen.availWidth;
                const screenH = window.screen.availHeight;
                const maxX = screenW - CANVAS_W;
                const maxY = screenH - CANVAS_H;
                const nx = Math.max(0, Math.min(
                    dragInfo.current.windowStartX + (e.screenX - dragInfo.current.screenStartX),
                    maxX,
                ));
                const ny = Math.max(0, Math.min(
                    dragInfo.current.windowStartY + (e.screenY - dragInfo.current.screenStartY),
                    maxY,
                ));
                currentAbsolutePosRef.current = { x: nx, y: ny };
                void moveWindow(nx, ny);
            } else {
                const dx = e.clientX - dragInfo.current.offX;
                const dy = e.clientY - dragInfo.current.offY;
                const maxX = window.innerWidth - CANVAS_W;
                const maxY = window.innerHeight - CANVAS_H;
                const nx = Math.max(0, Math.min(dx, maxX));
                const ny = Math.max(0, Math.min(dy, maxY));
                setPos({ x: nx, y: ny });
                currentAbsolutePosRef.current = { x: nx, y: ny };
            }
        };

        const onPointerUp = () => {
            dragInfo.current.active = false;
            tickerInputsRef.current.dragging = false;
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, []);

    // ---- Pointer down on character: click + drag ----
    const handlePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const tauri = isTauri();

        // Right-click → open settings window (Tauri only).
        if (e.button === 2) {
            if (tauri) {
                void (async () => {
                    try {
                        const { Window } = await import("@tauri-apps/api/window");
                        const settingsWin = await Window.getByLabel("settings");
                        if (settingsWin) {
                            await settingsWin.show();
                            await settingsWin.setFocus();
                        }
                    } catch {
                        /* swallow */
                    }
                })();
            }
            return;
        }

        if (e.button !== 0) return;

        // Record an interaction with the backend (raises affection, drops attention_hunger).
        if (tauri) {
            void import("@tauri-apps/api/core").then(({ invoke }) => {
                invoke("record_interaction", { kind: "click" }).catch(() => { });
            });
        }

        // Start dragging.
        dragInfo.current.active = true;
        tickerInputsRef.current.dragging = true;
        if (tauri) {
            dragInfo.current.screenStartX = e.screenX;
            dragInfo.current.screenStartY = e.screenY;
            dragInfo.current.windowStartX = currentAbsolutePosRef.current.x;
            dragInfo.current.windowStartY = currentAbsolutePosRef.current.y;
        } else {
            dragInfo.current.offX = e.clientX - pos.x;
            dragInfo.current.offY = e.clientY - pos.y;
        }
    };

    return (
        <div
            ref={wrapperRef}
            style={{
                position: "fixed",
                left: 0,
                top: 0,
                pointerEvents: "none",
                zIndex: 9999,
                width: `${CANVAS_W}px`,
                height: `${CANVAS_H}px`,
                transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${settings.scale})`,
                transformOrigin: "bottom center",
                opacity: !mounted ? 0 : settings.opacity,
                transition: "opacity 600ms",
                willChange: "transform",
                userSelect: "none",
            }}
        >
            {dialogue && (
                <div
                    className="absolute left-1/2 top-2 -translate-x-1/2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow-xl ring-1 ring-black/5 max-w-[260px] whitespace-normal wrap-break-word text-center"
                    style={{ pointerEvents: "none" }}
                >
                    {dialogue}
                </div>
            )}

            {!ready && !error && (
                <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ pointerEvents: "none" }}
                >
                    <div className="rounded-xl bg-white/85 px-3 py-2 text-xs text-neutral-700 shadow ring-1 ring-black/5">
                        {loadProgress > 0 && loadProgress < 1
                            ? `loading... ${Math.round(loadProgress * 100)}%`
                            : "loading..."}
                    </div>
                </div>
            )}

            {error && (
                <div
                    className="absolute inset-0 flex items-center justify-center p-4"
                    style={{ pointerEvents: "none" }}
                >
                    <div className="rounded-xl bg-white/95 px-3 py-2 text-xs text-neutral-800 shadow ring-1 ring-black/5 text-center">
                        <div className="font-semibold mb-1">model unavailable</div>
                        <div className="text-neutral-600">{error}</div>
                        <div className="text-neutral-500 mt-1 text-[11px]">
                            place a VRM file at <code>public/character/model.vrm</code>
                        </div>
                    </div>
                </div>
            )}

            {/* The character canvas — only interactive surface. */}
            <div
                className="w-full h-full"
                style={{ pointerEvents: "auto", cursor: "grab" }}
                onPointerDown={handlePointerDown}
                onContextMenu={(e) => e.preventDefault()}
            >
                <canvas
                    ref={canvasRef}
                    width={CANVAS_W}
                    height={CANVAS_H}
                    className="block h-full w-full"
                    style={{ pointerEvents: "none" }}
                />
            </div>
        </div>
    );
});

KuroCharacter.displayName = "KuroCharacter";

export default KuroCharacter;
export { CANVAS_W, CANVAS_H };
