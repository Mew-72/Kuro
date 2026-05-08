"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import { KuroSettingsMenu, KuroSettings } from "./kuro-settings-menu";
import {
  headpatLines,
  idleLines,
  judgingLines,
  typingFastLines,
  wakeUpLines,
  excitedLines,
  batteryLines,
  lateNightLines,
  draggingLines,
  shakeLines,
  annoyedLines,
  curiousLines,
  returnLines,
  firstLaunchLines,
  anniversaryLines,
  headpatMilestoneLines,
  peakWpmLines,
  streakLines,
  systemLines,
  distractedMajorityLines,
} from "../lines";

// --- KuroContext from backend ---
interface KuroContext {
  user_name: string;
  device_name: string;
  days_since_first_met: number;
  current_app: string;
  current_window_title: string;
  activity_type: string;
  current_wpm: number;
  peak_wpm_today: number;
  session_coding_minutes: number;
  session_distracted_minutes: number;
  session_idle_minutes: number;
  focus_streak_minutes: number;
  longest_streak_today: number;
  battery_percent: number;
  is_charging: boolean;
  cpu_percent: number;
  ram_percent: number;
  open_window_count: number;
  hour: number;
  is_weekend: boolean;
  time_of_day: string;
  total_days_active: number;
  total_coding_hours: number;
  total_headpats: number;
}

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function personalise(line: string, ctx: KuroContext | null): string {
  if (!ctx) return line;
  return line
    .replace(/\{name\}/g, ctx.user_name)
    .replace(/\{device\}/g, ctx.device_name)
    .replace(/\{app\}/g, ctx.current_app)
    .replace(/\{streak\}/g, String(ctx.focus_streak_minutes))
    .replace(/\{wpm\}/g, String(ctx.current_wpm))
    .replace(/\{headpats\}/g, String(ctx.total_headpats));
}

// --- Types ---
export type KuroState =
  | "idle"
  | "typing_slow"
  | "typing_fast"
  | "sleeping"
  | "judging"
  | "headpat"
  | "excited"
  | "wandering";

export interface KuroDesktopHandle {
  triggerState: (name: KuroState) => void;
  getState: () => KuroState;
}

// --- Constants ---
const CANVAS_W = 350;
const CANVAS_H = 500;

// --- Helpers ---
function lerp(current: number, target: number, speed: number): number {
  return current + (target - current) * speed;
}

function perimeterToXY(t: number, w: number, h: number) {
  const perimeter = 2 * w + 2 * h;
  let dist = (t % 1) * perimeter;

  if (dist <= w) {
    return { x: w - dist, y: h, dir: -1 };
  }
  dist -= w;
  if (dist <= h) {
    return { x: 0, y: h - dist, dir: 1 };
  }
  dist -= h;
  if (dist <= w) {
    return { x: dist, y: 0, dir: 1 };
  }
  dist -= w;
  return { x: w, y: dist, dir: -1 };
}

// Tauri-only: move the OS window. No-op in browser.
const moveWindow = async (x: number, y: number) => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalPosition } = await import("@tauri-apps/api/dpi");
    await getCurrentWindow().setPosition(new LogicalPosition(x, y));
  } catch {}
};

const KuroDesktop = forwardRef<KuroDesktopHandle, {}>((_, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<KuroState>("idle");
  const stateRef = useRef<KuroState>("idle");
  const [ready, setReady] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  // ---- Settings & Overlays ----
  const [settings, setSettings] = useState<KuroSettings>({
    skin: "calico",
    scale: 1.0,
    opacity: 1.0,
    wandering: true,
    dialogue: true,
    dialogueInterval: 30,
    lateNightMode: true,
  });

  const openSettings = async () => {
    try {
      const { Window } = await import("@tauri-apps/api/window");
      const settingsWin = await Window.getByLabel("settings");
      if (settingsWin) {
        await settingsWin.show();
        await settingsWin.setFocus();
      }
    } catch (e) {
      console.debug("[Kuro] Failed to open settings window:", e);
    }
  };

  const [currentDialogue, setCurrentDialogue] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  // Backend context
  const contextRef = useRef<KuroContext | null>(null);
  const lastDialogueTimeRef = useRef(0);
  const dialogueCooldownMs = 180_000; // 3 minutes between random lines

  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);

  // ---- Dragging & Position (Hydration Safe) ----
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragInfo = useRef({
    active: false,
    offX: 0,
    offY: 0,
    // Screen-space drag tracking (for Tauri window movement)
    screenStartX: 0,
    screenStartY: 0,
    windowStartX: 0,
    windowStartY: 0,
    moved: false,
  });
  const lastClickTimeRef = useRef(0);

  // Wandering refs
  const wanderTRef = useRef(0);
  const targetPosRef = useRef({ x: 0, y: 0 });
  const mousePosRef = useRef({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  });

  // State timers
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCountRef = useRef(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef(0);
  const currentAbsolutePosRef = useRef({
    x: typeof window !== "undefined"
      ? ("__TAURI_INTERNALS__" in window
          ? window.screen.availWidth - CANVAS_W - 24
          : window.innerWidth - CANVAS_W - 24)
      : 0,
    y: typeof window !== "undefined"
      ? ("__TAURI_INTERNALS__" in window
          ? window.screen.availHeight - CANVAS_H - 24
          : window.innerHeight - CANVAS_H - 24)
      : 0,
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Expose Imperative API
  const triggerState = useCallback((next: KuroState, customLine?: string) => {
    const prevState = stateRef.current;
    setState(next);
    stateRef.current = next;

    // Clear auto-revert timers on manual trigger
    if (stateTimerRef.current) clearTimeout(stateTimerRef.current);

    if (next === "judging") {
      stateTimerRef.current = setTimeout(() => triggerState("idle"), 4000);
    } else if (next === "headpat") {
      stateTimerRef.current = setTimeout(() => triggerState("idle"), 2000);
    } else if (next === "excited") {
      stateTimerRef.current = setTimeout(() => triggerState("idle"), 3000);
    }

    // Handle immediate explicit dialogues
    if (settingsRef.current.dialogue) {
      const ctx = contextRef.current;
      const p = (line: string) => personalise(line, ctx);
      if (customLine) {
        setCurrentDialogue(p(customLine));
      } else if (next === "judging") {
        setCurrentDialogue(p(pickRandom(judgingLines)));
      } else if (next === "headpat") {
        setCurrentDialogue(p(pickRandom(headpatLines)));
      } else if (next === "excited") {
        setCurrentDialogue(p(pickRandom(excitedLines)));
      } else if (next === "idle" && prevState === "sleeping") {
        setCurrentDialogue(p(pickRandom(wakeUpLines)));
      }
      if (
        ["judging", "headpat", "excited", "idle"].includes(next) ||
        customLine
      ) {
        setTimeout(() => setCurrentDialogue(null), 5000);
      }
    }
  }, []);

  useImperativeHandle(ref, () => ({
    triggerState,
    getState: () => stateRef.current,
  }));

  // Context-aware Dialogue System
  useEffect(() => {
    if (!settings.dialogue) {
      setCurrentDialogue(null);
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastDialogueTimeRef.current < dialogueCooldownMs) return;

      const ctx = contextRef.current;
      const p = (line: string) => personalise(line, ctx);
      let chosen: string | null = null;

      // Priority-based dialogue selection
      if (ctx) {
        // P1: Battery critical
        if (!ctx.is_charging && ctx.battery_percent < 5) {
          chosen = p(pickRandom(batteryLines));
        }
        // P2: Battery low
        else if (!ctx.is_charging && ctx.battery_percent < 15) {
          chosen = p(pickRandom(batteryLines));
        }
        // P3: CPU high
        else if (ctx.cpu_percent > 90) {
          chosen = p(pickRandom(systemLines.slice(0, 2)));
        }
        // P4: RAM high
        else if (ctx.ram_percent > 85) {
          chosen = p(pickRandom(systemLines.slice(2, 4)));
        }
        // P5: Distracted activity
        else if (ctx.activity_type === "distracted" && stateRef.current !== "judging") {
          triggerState("judging");
          return; // triggerState handles its own dialogue
        }
        // P8: Late night + long session
        else if (settings.lateNightMode && (ctx.hour >= 0 && ctx.hour < 5) && ctx.session_coding_minutes > 30) {
          chosen = p(pickRandom(lateNightLines));
        }
      }

      // P10: Random idle chatter (fallback)
      if (!chosen) {
        const linesMap: Partial<Record<KuroState, string[]>> = {
          idle: idleLines,
          judging: judgingLines,
          typing_fast: typingFastLines,
          wandering: idleLines,
        };
        const lines = linesMap[stateRef.current] || [];
        // Weighted toward silence — 60% chance of saying nothing
        if (lines.length > 0 && Math.random() > 0.6) {
          chosen = p(pickRandom(lines));
        }
      }

      if (chosen) {
        lastDialogueTimeRef.current = now;
        setCurrentDialogue(chosen);
        setTimeout(() => setCurrentDialogue(null), 4000);
      }
    }, settings.dialogueInterval * 1000);

    return () => clearInterval(interval);
  }, [settings.dialogue, settings.dialogueInterval, settings.lateNightMode, triggerState]);

  // ---- Click-through control (Tauri) ----
  //
  // The Rust backend polls the global cursor position every ~50ms and
  // automatically toggles setIgnoreCursorEvents based on whether the
  // cursor is inside the window bounds. This means:
  //   - When the cursor is outside: window is click-through.
  //   - When the cursor hovers over the character: window becomes
  //     interactive (left-click, right-click, drag all work).
  //
  // No JS-side click-through management or global-shortcut plugin needed.
  // Browser: no Tauri, window is naturally interactive.

  // Hover handlers for browser preview / cursor visuals.
  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
  }, []);


  // Tauri event listener system
  useEffect(() => {
    let unlisten: (() => void)[] = [];

    const setup = async () => {
      try {
        if (!("__TAURI_INTERNALS__" in window)) {
          return;
        }

        const { listen } = await import("@tauri-apps/api/event");

        unlisten.push(
          await listen<{ state: KuroState }>("kuro:trigger-state", (e) => {
            triggerState(e.payload.state);
          }),
        );

        unlisten.push(
          await listen<KuroSettings>("kuro:settings-updated", (e) => {
            setSettings(e.payload);
          }),
        );

        // Context event — full state from backend every 3s
        unlisten.push(
          await listen<KuroContext>("kuro:context", (e) => {
            contextRef.current = e.payload;
          }),
        );

        // Typing speed — drives animation state
        unlisten.push(
          await listen<{ wpm: number }>("kuro:typing-speed", (e) => {
            const wpm = e.payload.wpm;
            const cur = stateRef.current;
            // Don't override special states
            if (["headpat", "excited", "judging", "sleeping", "wandering"].includes(cur)) return;
            if (wpm === 0) triggerState("idle");
            else if (wpm < 40) triggerState("typing_slow");
            else if (wpm < 80) triggerState("typing_fast");
            else triggerState("excited"); // typing_frantic → use excited anim
          }),
        );

        // Active window — trigger judging for distracted activity
        unlisten.push(
          await listen<{ title: string; activity: string }>("kuro:active-window", (e) => {
            if (e.payload.activity === "distracted") {
              triggerState("judging");
            }
          }),
        );

        // Idle events
        unlisten.push(
          await listen<{ type: string; seconds?: number; was_gone_minutes?: number }>("kuro:idle", (e) => {
            const ctx = contextRef.current;
            const p = (line: string) => personalise(line, ctx);
            if (e.payload.type === "Sleeping") {
              triggerState("sleeping");
            } else if (e.payload.type === "Wandering") {
              if (settingsRef.current.wandering) triggerState("wandering");
            } else if (e.payload.type === "Returned") {
              triggerState("idle", p(pickRandom(returnLines)));
            }
          }),
        );

        // System health alerts
        unlisten.push(
          await listen<{ alert_type: string; value: number }>("kuro:system-health", (e) => {
            const ctx = contextRef.current;
            const p = (line: string) => personalise(line, ctx);
            if (e.payload.alert_type === "battery_critical") {
              triggerState("judging", p(pickRandom(batteryLines)));
            } else if (e.payload.alert_type === "battery_low") {
              triggerState("judging", p(pickRandom(batteryLines)));
            } else if (e.payload.alert_type === "cpu_high") {
              triggerState("idle", p(pickRandom(systemLines.slice(0, 2))));
            } else if (e.payload.alert_type === "ram_high") {
              triggerState("idle", p(pickRandom(systemLines.slice(2, 4))));
            }
          }),
        );

        // Milestone events
        unlisten.push(
          await listen<{ milestone_type: string; value?: number }>("kuro:milestone", (e) => {
            const ctx = contextRef.current;
            const p = (line: string) => personalise(line, ctx);
            const mt = e.payload.milestone_type;
            if (mt === "focus_25") {
              triggerState("idle", p(streakLines[0]));
            } else if (mt === "focus_60") {
              triggerState("idle", p(streakLines[1]));
            } else if (mt === "focus_120") {
              triggerState("excited", p(streakLines[2]));
            } else if (mt === "new_peak_wpm") {
              triggerState("excited", p(pickRandom(peakWpmLines)));
            } else if (mt === "distracted_majority") {
              triggerState("judging", p(pickRandom(distractedMajorityLines)));
            }
          }),
        );
      } catch (e) {
        console.debug("[Kuro] Tauri events unavailable:", e);
      }
    };

    setup();
    return () => unlisten.forEach((fn) => fn());
  }, [triggerState]);

  // Initial Mount & Resize bounds
  useEffect(() => {
    const isTauri = "__TAURI_INTERNALS__" in window;

    if (isTauri) {
      const screenW = window.screen.availWidth;
      const screenH = window.screen.availHeight;
      const initX = screenW - CANVAS_W - 24;
      const initY = screenH - CANVAS_H - 24;
      currentAbsolutePosRef.current = { x: initX, y: initY };
      targetPosRef.current = { x: initX, y: initY };
      moveWindow(initX, initY);
      setPos({ x: 0, y: 0 });
    } else {
      const initX = window.innerWidth - CANVAS_W - 24;
      const initY = window.innerHeight - CANVAS_H - 24;
      setPos({ x: initX, y: initY });
      currentAbsolutePosRef.current = { x: initX, y: initY };
      targetPosRef.current = { x: initX, y: initY };
    }
    setMounted(true);

    const onPointerMove = (e: PointerEvent) => {
      mousePosRef.current = { x: e.screenX, y: e.screenY };

      if (!dragInfo.current.active) return;

      if (isTauri) {
        const screenW = window.screen.availWidth;
        const screenH = window.screen.availHeight;
        const maxX = screenW - CANVAS_W;
        const maxY = screenH - CANVAS_H;
        const nextX = Math.max(0, Math.min(
          dragInfo.current.windowStartX + (e.screenX - dragInfo.current.screenStartX),
          maxX,
        ));
        const nextY = Math.max(0, Math.min(
          dragInfo.current.windowStartY + (e.screenY - dragInfo.current.screenStartY),
          maxY,
        ));

        // Shake detection
        const dist = Math.hypot(
          nextX - lastPosRef.current.x,
          nextY - lastPosRef.current.y,
        );
        velocityRef.current = dist;
        if (dist > 80 && stateRef.current !== "excited") {
          triggerState(
            "excited",
            shakeLines[Math.floor(Math.random() * shakeLines.length)],
          );
        }

        // Drag pickup detection
        if (!dragInfo.current.moved) {
          if (Math.random() < 0.3) {
            triggerState(
              "idle",
              draggingLines[Math.floor(Math.random() * draggingLines.length)],
            );
          }
        }

        lastPosRef.current = { x: nextX, y: nextY };
        currentAbsolutePosRef.current = { x: nextX, y: nextY };
        targetPosRef.current = { x: nextX, y: nextY };
        dragInfo.current.moved = true;
        moveWindow(nextX, nextY);
      } else {
        // Browser: drag moves the cat within the viewport.
        const dx = e.clientX - dragInfo.current.offX;
        const dy = e.clientY - dragInfo.current.offY;
        const maxX = window.innerWidth - CANVAS_W;
        const maxY = window.innerHeight - CANVAS_H;
        const nextX = Math.max(0, Math.min(dx, maxX));
        const nextY = Math.max(-200, Math.min(dy, maxY));

        // Shake detection
        const dist = Math.hypot(
          nextX - lastPosRef.current.x,
          nextY - lastPosRef.current.y,
        );
        velocityRef.current = dist;
        if (dist > 80 && stateRef.current !== "excited") {
          triggerState(
            "excited",
            shakeLines[Math.floor(Math.random() * shakeLines.length)],
          );
        }

        // Drag pickup detection
        if (!dragInfo.current.moved) {
          if (Math.random() < 0.3) {
            triggerState(
              "idle",
              draggingLines[Math.floor(Math.random() * draggingLines.length)],
            );
          }
        }

        // Edge bump detection
        if (
          (nextX <= 0 || nextX >= maxX || nextY <= -200 || nextY >= maxY) &&
          !dragInfo.current.moved
        ) {
          if (Math.random() < 0.1) {
            triggerState("judging", "Watch the walls!");
          }
        }

        lastPosRef.current = { x: nextX, y: nextY };
        currentAbsolutePosRef.current = { x: nextX, y: nextY };
        dragInfo.current.moved = true;
        setPos({ x: nextX, y: nextY });
        targetPosRef.current = { x: nextX, y: nextY };
      }

      // Stop wandering if dragged
      if (stateRef.current === "wandering") {
        triggerState("idle");
      }
    };

    const onPointerUp = () => {
      dragInfo.current.active = false;
      setIsDragging(false);
      velocityRef.current = 0;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const closeSettings = async () => {
          try {
            const { Window } = await import("@tauri-apps/api/window");
            const settingsWin = await Window.getByLabel("settings");
            await settingsWin?.hide();
          } catch (e) {
            console.debug("[Kuro] Failed to close settings window:", e);
          }
        };
        closeSettings();
        return;
      }

      const shortcuts: Record<string, KuroState> = {
        "1": "idle",
        "2": "typing_slow",
        "3": "typing_fast",
        "4": "sleeping",
        "5": "judging",
        "6": "excited",
        "7": "wandering",
      };

      const nextState = shortcuts[e.key];
      if (nextState) {
        e.preventDefault();

        // When leaving wandering/sleeping, return to home position.
        if (
          (stateRef.current === "wandering" ||
            stateRef.current === "sleeping") &&
          nextState !== "wandering" &&
          nextState !== "sleeping"
        ) {
          const homeX = isTauri
            ? window.screen.availWidth - CANVAS_W - 24
            : window.innerWidth - CANVAS_W - 24;
          const homeY = isTauri
            ? window.screen.availHeight - CANVAS_H - 24
            : window.innerHeight - CANVAS_H - 24;
          targetPosRef.current = { x: homeX, y: homeY };
        }

        triggerState(nextState);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [triggerState]);

  // Single unified pointerdown handler: clicks (left/right/double) + dragging.
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const isTauri = "__TAURI_INTERNALS__" in window;

    // Right-click → judging + open settings.
    if (e.button === 2) {
      triggerState("judging");
      openSettings();
      return;
    }

    // Left-click → headpat / excited (double).
    if (e.button === 0) {
      // Manual double-click detection (e.detail is unreliable after
      // preventDefault on pointerdown in some browsers / Tauri webview).
      const now = Date.now();
      if (now - lastClickTimeRef.current < 350) {
        triggerState("excited");
      } else {
        triggerState("headpat");
        // Record headpat in backend
        if ("__TAURI_INTERNALS__" in window) {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke<number>("record_headpat").then((count) => {
              const ctx = contextRef.current;
              const p = (line: string) => personalise(line, ctx);
              if (count === 10) triggerState("idle", p(headpatMilestoneLines[0]));
              else if (count === 50) triggerState("idle", p(headpatMilestoneLines[1]));
              else if (count === 100) triggerState("excited", p(headpatMilestoneLines[2]));
              else if (count === 500) triggerState("excited", p(headpatMilestoneLines[3]));
            }).catch(() => {});
          }).catch(() => {});
        }
      }
      lastClickTimeRef.current = now;

      // Begin dragging.
      dragInfo.current.active = true;
      dragInfo.current.moved = false;

      if (isTauri) {
        // Track screen-space start for window dragging.
        dragInfo.current.screenStartX = e.screenX;
        dragInfo.current.screenStartY = e.screenY;
        dragInfo.current.windowStartX = currentAbsolutePosRef.current.x;
        dragInfo.current.windowStartY = currentAbsolutePosRef.current.y;
      } else {
        dragInfo.current.offX = e.clientX - pos.x;
        dragInfo.current.offY = e.clientY - pos.y;
      }
      setIsDragging(true);

      // Click spam detection
      clickCountRef.current += 1;
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 2000);

      if (clickCountRef.current > 5) {
        triggerState(
          "judging",
          annoyedLines[Math.floor(Math.random() * annoyedLines.length)],
        );
        clickCountRef.current = 0;
      }
    }
  };

  // Autonomous behavior loop
  useEffect(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);

    if (!settings.wandering) {
      if (state === "idle") {
        sleepTimerRef.current = setTimeout(() => {
          triggerState("sleeping");
        }, 30000);
      }
      return;
    }

    const randomStates: KuroState[] = [
      "idle",
      "wandering",
      "typing_slow",
      "typing_fast",
      "judging",
      "excited",
    ];

    if (state !== "headpat") {
      const nextActionTime = 10000 + Math.random() * 15000;

      sleepTimerRef.current = setTimeout(() => {
        if (
          (state === "idle" || state === "wandering") &&
          Math.random() < 0.15
        ) {
          triggerState("sleeping");
        } else {
          const nextState =
            randomStates[Math.floor(Math.random() * randomStates.length)];

          let line: string | undefined = undefined;
          if (nextState === "idle" && Math.random() < 0.2) {
            line =
              curiousLines[Math.floor(Math.random() * curiousLines.length)];
          }

          triggerState(nextState, line);
        }
      }, nextActionTime);
    }
  }, [state, triggerState, settings.wandering]);

  // ---- PixiJS & Live2D Master Ticker ----
  // PIXI app + Live2D model are created ONCE on mount and only destroyed
  // on final unmount. No timers in this component touch app.destroy().
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (typeof window === "undefined" || !canvasRef.current) return;

      const start = Date.now();
      while (!window.Live2DCubismCore && Date.now() - start < 8000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (cancelled) return;
      if (!window.Live2DCubismCore) {
        setModelError("Cubism core failed to load");
        return;
      }

      const PIXI = await import("pixi.js");
      (window as any).PIXI = PIXI;

      if (
        PIXI.DisplayObject &&
        !(PIXI.DisplayObject.prototype as any).isInteractive
      ) {
        (PIXI.DisplayObject.prototype as any).isInteractive = function () {
          return false;
        };
      }

      const { Live2DModel } = await import("pixi-live2d-display/cubism4");
      Live2DModel.registerTicker(PIXI.Ticker);

      if (cancelled) return;

      const app = new PIXI.Application({
        view: canvasRef.current,
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });

      app.stage.eventMode = "none";
      app.stage.interactiveChildren = false;
      appRef.current = app;

      try {
        const model = await Live2DModel.from("/model/LittleCat.model3.json", {
          autoInteract: false,
        });

        if (cancelled) {
          try {
            model.destroy();
          } catch {}
          return;
        }

        model.scale.set(0.17);
        if (model.anchor) {
          model.anchor.set(0.5, 1.0);
        }
        model.x = 175;
        model.y = 490;

        model.eventMode = "static";
        app.stage.addChild(model as any);
        modelRef.current = model;

        // ---- Master Animation Ticker ----
        let time = 0;
        let lastBlinkTime = 0;
        let nextBlinkInterval = 3 + Math.random() * 2;
        let isBlinking = false;

        let wanderPauseTime = 0;
        let isWanderPaused = false;
        let currentScaleX = 0.17;

        const currentParams: Record<string, number> = {
          ParamAngleX: 0,
          ParamAngleY: 0,
          ParamAngleZ: 0,
          ParamBodyAngleX: 0,
          ParamBodyAngleY: 0,
          ParamBodyAngleZ: 0,
          ParamEyeLOpen: 1,
          ParamEyeROpen: 1,
          ParamEyeBallX: 0,
          ParamEyeBallY: 0,
          ParamBrowLY: 0,
          ParamBrowRY: 0,
          ParamMouthForm: 0,
          ParamMouthOpenY: 0,
          ParamArms: 0,
          Param_Angle_Rotation2: 0,
        };

        const targetParams: Record<string, number> = { ...currentParams };

        app.ticker.add((delta: number) => {
          const dt = delta * (1 / 60);
          time += dt;
          const s = stateRef.current;
          const coreModel = model.internalModel?.coreModel;
          if (!coreModel) return;

          Object.keys(targetParams).forEach((k) => (targetParams[k] = 0));
          targetParams.ParamEyeLOpen = 1;
          targetParams.ParamEyeROpen = 1;
          targetParams.ParamMouthForm = 0;
          let lerpSpeed = 0.1;
          let jumpY = 0;

          // Random Blinking Logic
          if (time - lastBlinkTime > nextBlinkInterval) {
            isBlinking = true;
            lastBlinkTime = time;
            nextBlinkInterval = 3 + Math.random() * 2;
          }
          if (isBlinking) {
            targetParams.ParamEyeLOpen = 0;
            targetParams.ParamEyeROpen = 0;
            if (time - lastBlinkTime > 0.15) isBlinking = false;
          }

          switch (s) {
            case "idle":
              targetParams.ParamAngleY = Math.sin(time * 2) * 3;
              targetParams.ParamBodyAngleX = Math.sin(time * 1.5) * 2;
              targetParams.ParamMouthForm = 0.5;
              targetParams.Param_Angle_Rotation2 = Math.sin(time * 1) * -5;
              break;

            case "typing_slow":
              targetParams.ParamAngleY = Math.sin(time * 2) * 2;
              targetParams.ParamAngleX = Math.sin(time * 1.5) * 1;
              targetParams.ParamEyeLOpen = isBlinking ? 0 : 0.8;
              targetParams.ParamEyeROpen = isBlinking ? 0 : 0.8;
              targetParams.ParamBodyAngleY = -2;
              targetParams.ParamBodyAngleX = Math.sin(time * 1) * 1;
              targetParams.ParamMouthForm = Math.sin(time * 2) * 0.3;
              targetParams.ParamArms = Math.sin(time * 6) * 4 + 3;
              targetParams.Param_Angle_Rotation2 = Math.sin(time * 1.5) * -2;
              break;

            case "typing_fast":
              lerpSpeed = 0.2;
              targetParams.ParamAngleY = Math.sin(time * 12) * 8;
              targetParams.ParamAngleX =
                Math.sin(time * 14) * 5 + Math.sin(time * 7) * 3;
              targetParams.ParamEyeLOpen = isBlinking ? 0 : 1.0;
              targetParams.ParamEyeROpen = isBlinking ? 0 : 1.0;
              targetParams.ParamBrowLY = Math.sin(time * 10) * 0.6;
              targetParams.ParamBrowRY = Math.sin(time * 10) * 0.6;
              targetParams.ParamBodyAngleY = -6 + Math.sin(time * 8) * 2;
              targetParams.ParamBodyAngleX = Math.sin(time * 11) * 4;
              targetParams.ParamMouthForm = Math.sin(time * 9) * 0.5 + 0.3;
              targetParams.ParamMouthOpenY = Math.abs(Math.sin(time * 9)) * 0.6;
              targetParams.ParamArms = Math.sin(time * 22) * 15 + 10;
              targetParams.Param_Angle_Rotation2 = Math.sin(time * 25) * 20;
              break;

            case "sleeping":
              lerpSpeed = 0.02;
              targetParams.ParamEyeLOpen = 0;
              targetParams.ParamEyeROpen = 0;
              targetParams.ParamAngleY = -8;
              targetParams.ParamBodyAngleY = Math.sin(time * 1) * -2 - 2;
              targetParams.ParamBodyAngleX = Math.sin(time * 0.5) * 1;
              targetParams.Param_Angle_Rotation2 = 15;
              break;

            case "judging":
              targetParams.ParamAngleZ = Math.sin(time * 3) * 15;
              targetParams.ParamAngleY = -5;
              targetParams.ParamEyeLOpen = 0.5;
              targetParams.ParamEyeROpen = 0.5;
              targetParams.ParamBrowLY = -0.5;
              targetParams.ParamBrowRY = -0.5;
              targetParams.ParamMouthForm = -0.5;
              targetParams.ParamArms = 5;
              targetParams.Param_Angle_Rotation2 = Math.sin(time * 5) * -10;
              break;

            case "headpat":
              lerpSpeed = 0.2;
              targetParams.ParamAngleY = Math.sin(time * 10) * 10 - 5;
              targetParams.ParamEyeLOpen = Math.sin(time * 5) > 0 ? 0 : 0.2;
              targetParams.ParamEyeROpen = Math.sin(time * 5) > 0 ? 0 : 0.2;
              targetParams.ParamMouthForm = 1.0;
              targetParams.ParamMouthOpenY = 0.5;
              targetParams.ParamAngleX = Math.sin(time * 8) * 15;
              targetParams.Param_Angle_Rotation2 = Math.sin(time * 20) * 20;
              break;

            case "excited":
              lerpSpeed = 0.35;
              targetParams.ParamAngleY =
                Math.sin(time * 15) * 12 + Math.sin(time * 7) * 5;
              targetParams.ParamAngleX = Math.sin(time * 13) * 8;
              targetParams.ParamEyeLOpen = 1.0;
              targetParams.ParamEyeROpen = 1.0;
              targetParams.ParamBrowLY = Math.sin(time * 12) * 1.0 + 0.8;
              targetParams.ParamBrowRY = Math.sin(time * 12) * 1.0 + 0.8;
              targetParams.ParamMouthOpenY =
                Math.abs(Math.sin(time * 11)) * 0.8 + 0.4;
              targetParams.ParamMouthForm = 1.0;
              targetParams.ParamBodyAngleY = Math.sin(time * 10) * 3;
              targetParams.ParamBodyAngleX = Math.sin(time * 14) * 4;
              targetParams.ParamArms = Math.sin(time * 24) * 18 + 12;
              targetParams.Param_Angle_Rotation2 = Math.sin(time * 28) * 25;
              jumpY = Math.abs(Math.sin(time * 8)) * -30;
              break;

            case "wandering":
              if (!isWanderPaused) {
                wanderTRef.current += dt * 0.02;
                const screenW =
                  "__TAURI_INTERNALS__" in window
                    ? window.screen.availWidth
                    : window.innerWidth;
                const screenH =
                  "__TAURI_INTERNALS__" in window
                    ? window.screen.availHeight
                    : window.innerHeight;
                const maxW = screenW - CANVAS_W;
                const maxH = screenH - CANVAS_H;
                const targetLoc = perimeterToXY(wanderTRef.current, maxW, maxH);

                targetPosRef.current = { x: targetLoc.x, y: targetLoc.y };

                currentScaleX = lerp(currentScaleX, targetLoc.dir * 0.17, 0.1);
                model.scale.x = currentScaleX;

                const walkCycle = time * 12;

                targetParams.ParamBodyAngleX = Math.sin(walkCycle / 2) * 5;
                targetParams.ParamBodyAngleZ = Math.cos(walkCycle / 2) * 5;

                targetParams.ParamAngleY = Math.sin(walkCycle) * 3 - 2;
                targetParams.ParamAngleZ = Math.sin(walkCycle / 2) * 3;

                targetParams.ParamArms = Math.abs(Math.sin(walkCycle / 2)) * 8;

                jumpY = Math.abs(Math.sin(walkCycle)) * -8;

                const center = {
                  x: currentAbsolutePosRef.current.x + CANVAS_W / 2,
                  y: currentAbsolutePosRef.current.y + CANVAS_H / 2,
                };
                const mPos = mousePosRef.current;
                const dist = Math.hypot(mPos.x - center.x, mPos.y - center.y);
                if (dist < 300) {
                  targetParams.ParamEyeBallX = Math.max(
                    -1,
                    Math.min(1, (mPos.x - center.x) / 100),
                  );
                  targetParams.ParamEyeBallY = Math.max(
                    -1,
                    Math.min(1, (center.y - mPos.y) / 100),
                  );
                }

                if (Math.random() < 0.005) {
                  isWanderPaused = true;
                  wanderPauseTime = time;
                }
              } else {
                targetParams.ParamAngleY = Math.sin(time * 2) * 3;
                targetParams.ParamAngleX = Math.sin(time * 1) * 10;
                if (time - wanderPauseTime > 5) {
                  isWanderPaused = false;
                }
              }
              break;
          }

          if (s !== "wandering") {
            currentScaleX = lerp(currentScaleX, 0.17, 0.1);
            model.scale.x = currentScaleX;
          }

          for (const key of Object.keys(targetParams)) {
            currentParams[key] = lerp(
              currentParams[key],
              targetParams[key],
              lerpSpeed,
            );
            coreModel.setParameterValueById(key, currentParams[key]);
          }

          // Position handling
          // - Tauri (ALL states): cat is always at (0,0) inside the window;
          //   the OS window moves via moveWindow() to position on screen.
          // - Browser: cat moves inside the page via CSS transform.
          const isTauri = "__TAURI_INTERNALS__" in window;

          if (!dragInfo.current.active) {
            const baseY =
              s === "excited"
                ? targetPosRef.current.y
                : currentAbsolutePosRef.current.y;

            const nextX = lerp(
              currentAbsolutePosRef.current.x,
              targetPosRef.current.x,
              0.05,
            );
            const nextYBase = lerp(baseY, targetPosRef.current.y, 0.05);

            currentAbsolutePosRef.current = { x: nextX, y: nextYBase };

            if (isTauri) {
              // Move the OS window; cat stays at (0,0) inside it.
              moveWindow(Math.round(nextX), Math.round(nextYBase + jumpY));
            } else {
              setPos({ x: nextX, y: nextYBase + jumpY });
            }
          } else if (!isTauri) {
            // Browser-only: update CSS position while dragging.
            setPos({
              x: currentAbsolutePosRef.current.x,
              y: targetPosRef.current.y + jumpY,
            });
          }
          // Tauri drag is handled in onPointerMove via moveWindow().
        });

        setReady(true);
      } catch (err) {
        console.error("[v0] Live2D model load failed:", err);
        setModelError(
          err instanceof Error ? err.message : "Failed to load model",
        );
      }
    }

    boot();

    // ONLY destroy on final unmount. Nothing else in this component
    // calls app.destroy() — no timers, no state-change effects.
    return () => {
      cancelled = true;
      try {
        if (modelRef.current) modelRef.current.destroy();
      } catch {}
      try {
        if (appRef.current) appRef.current.destroy(true, { children: true });
      } catch {}
      modelRef.current = null;
      appRef.current = null;
    };
  }, []);

  return (
    <div
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
        opacity: !mounted
          ? 0
          : state === "sleeping"
            ? 0.6 * settings.opacity
            : settings.opacity,
        transition: "opacity 1s",
        willChange: "transform",
        userSelect: "none",
      }}
      ref={wrapperRef}
    >
      {/* Speech bubble / dialogue overlays — pointer-events: none */}
      {currentDialogue && (
        <div
          className="absolute left-1/2 bottom-[195px] -translate-x-1/2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in duration-300 max-w-[220px] whitespace-normal break-words text-center"
          style={{ pointerEvents: "none" }}
        >
          {currentDialogue}
          <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white border-b border-r border-black/5" />
        </div>
      )}

      {!currentDialogue && state === "judging" && (
        <div
          className="absolute left-1/2 bottom-[195px] -translate-x-1/2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in duration-300 max-w-[220px] whitespace-normal break-words text-center"
          style={{ pointerEvents: "none" }}
        >
          baka, stop scrolling Twitter 🐾
          <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white border-b border-r border-black/5" />
        </div>
      )}

      {!ready && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ pointerEvents: "none" }}
        >
          <div className="rounded-xl bg-white/85 px-3 py-2 text-xs text-neutral-700 shadow ring-1 ring-black/5">
            {modelError ? `Error: ${modelError}` : "Waking up..."}
          </div>
        </div>
      )}



      {/* The ONLY interactive element — hover toggles click-through, */}
      {/* pointerdown handles clicks + drag. */}
      <div
        className="w-full h-full"
        style={{
          pointerEvents: "auto",
          cursor: isDragging ? "grabbing" : "pointer",
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
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

KuroDesktop.displayName = "KuroDesktop";

export default KuroDesktop;
