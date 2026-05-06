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
} from "../lines";

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

  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);

  // ---- Dragging & Position (Hydration Safe) ----
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragInfo = useRef({ active: false, offX: 0, offY: 0, moved: false });

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
    x: typeof window !== "undefined" ? window.innerWidth - CANVAS_W - 24 : 0,
    y: typeof window !== "undefined" ? window.innerHeight - CANVAS_H - 24 : 0,
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
      if (customLine) {
        setCurrentDialogue(customLine);
      } else if (next === "judging") {
        setCurrentDialogue(
          judgingLines[Math.floor(Math.random() * judgingLines.length)],
        );
      } else if (next === "headpat") {
        setCurrentDialogue(
          headpatLines[Math.floor(Math.random() * headpatLines.length)],
        );
      } else if (next === "excited") {
        setCurrentDialogue(
          excitedLines[Math.floor(Math.random() * excitedLines.length)],
        );
      } else if (next === "idle" && prevState === "sleeping") {
        setCurrentDialogue(
          wakeUpLines[Math.floor(Math.random() * wakeUpLines.length)],
        );
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

  // Dialogue Interval
  useEffect(() => {
    if (!settings.dialogue) {
      setCurrentDialogue(null);
      return;
    }
    const interval = setInterval(() => {
      const linesMap: Partial<Record<KuroState, string[]>> = {
        idle: idleLines,
        judging: judgingLines,
        headpat: headpatLines,
        typing_fast: typingFastLines,
        excited: excitedLines,
        wandering: idleLines,
      };
      let lines = linesMap[stateRef.current] || [];

      if (settings.lateNightMode && stateRef.current === "idle") {
        const hour = new Date().getHours();
        if (hour >= 0 && hour < 5) {
          lines = lateNightLines;
        }
      }

      if (lines.length > 0) {
        const line = lines[Math.floor(Math.random() * lines.length)];
        setCurrentDialogue(line);
        setTimeout(() => setCurrentDialogue(null), 3000);
      }
    }, settings.dialogueInterval * 1000);

    return () => clearInterval(interval);
  }, [settings.dialogue, settings.dialogueInterval, settings.lateNightMode]);

  // ---- Click-through control (Tauri) ----
  //
  // The hover-based approach (mouseenter -> setIgnoreCursorEvents(false))
  // CANNOT work: once setIgnoreCursorEvents(true) is active, the OS
  // bypasses the webview entirely — including mouseenter — so the window
  // can never re-enter interactive mode by hovering.
  //
  // Reliable approach: window stays click-through by default; user
  // presses Ctrl+Shift+P to toggle "interactive mode". Keyboard shortcuts
  // registered globally fire even while the window is click-through.
  // Browser: no Tauri, window is naturally interactive — toggle is a no-op.
  const [isInteractive, setIsInteractive] = useState(false);
  const isInteractiveRef = useRef(false);

  const setIgnoreCursor = useCallback(async (ignore: boolean) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    try {
      const { getCurrentWebviewWindow } = await import(
        "@tauri-apps/api/webview"
      );
      await getCurrentWebviewWindow().setIgnoreCursorEvents(ignore);
    } catch (e) {
      console.debug("[Kuro] Failed to set click-through:", e);
    }
  }, []);

  const toggleInteractive = useCallback(async () => {
    const next = !isInteractiveRef.current;
    isInteractiveRef.current = next;
    setIsInteractive(next);
    await setIgnoreCursor(!next);
  }, [setIgnoreCursor]);

  // Initialize click-through + register Ctrl+Shift+P toggle.
  useEffect(() => {
    const isTauri = "__TAURI_INTERNALS__" in window;
    let unregisterShortcut: (() => void) | null = null;

    if (isTauri) {
      // Start click-through ON.
      setIgnoreCursor(true);
      isInteractiveRef.current = false;
      setIsInteractive(false);

      // Register the global shortcut for toggling interactive mode.
      (async () => {
        try {
          const gs: any = await import(
            "@tauri-apps/plugin-global-shortcut"
          );
          const combo = "CommandOrControl+Shift+P";

          // Clean any stale registration from prior reloads.
          try {
            await gs.unregister(combo);
          } catch {}

          await gs.register(combo, (event: any) => {
            // Some plugin versions emit on both Pressed + Released;
            // only act on Pressed to avoid double toggles.
            if (
              !event ||
              event.state === undefined ||
              event.state === "Pressed"
            ) {
              toggleInteractive();
            }
          });

          unregisterShortcut = () => {
            gs.unregister(combo).catch(() => {});
          };
        } catch (e) {
          console.debug(
            "[Kuro] @tauri-apps/plugin-global-shortcut not available. " +
              "Install it to enable the Ctrl+Shift+K toggle. " +
              "Falling back to in-window keydown (only works while window has focus).",
            e,
          );
        }
      })();
    } else {
      // Browser preview: always interactive.
      isInteractiveRef.current = true;
      setIsInteractive(true);
    }

    // In-window keydown fallback. Works in browser, and in Tauri while
    // the window currently holds keyboard focus (e.g. just after toggling
    // interactive on, or right after a click on the cat).
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "p"
      ) {
        e.preventDefault();
        toggleInteractive();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      if (unregisterShortcut) unregisterShortcut();
    };
  }, [setIgnoreCursor, toggleInteractive]);

  // Hover handlers are kept for browser preview / cursor visuals only.
  // They intentionally do NOT toggle setIgnoreCursorEvents in Tauri.
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

        unlisten.push(
          await listen<{ wpm: number }>("kuro:typing-speed", (e) => {
            if (e.payload.wpm === 0) triggerState("idle");
            else if (e.payload.wpm < 40) triggerState("typing_slow");
            else triggerState("typing_fast");
          }),
        );

        unlisten.push(
          await listen<{ percent: number }>("kuro:battery", (e) => {
            if (e.payload.percent <= 15) triggerState("judging");
          }),
        );

        unlisten.push(
          await listen<{ title: string }>("kuro:active-window", (e) => {
            const title = e.payload.title.toLowerCase();
            const distractors = [
              "twitter",
              "youtube",
              "instagram",
              "reddit",
              "netflix",
            ];
            if (distractors.some((d) => title.includes(d))) {
              triggerState("judging");
            }
          }),
        );

        unlisten.push(
          await listen("kuro:idle", () => triggerState("sleeping")),
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
    const initX = window.innerWidth - CANVAS_W - 24;
    const initY = window.innerHeight - CANVAS_H - 24;
    setPos({ x: initX, y: initY });
    targetPosRef.current = { x: initX, y: initY };
    setMounted(true);

    const onPointerMove = (e: PointerEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };

      if (!dragInfo.current.active) return;
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
          triggerState("judging", "Watch the walls! 😾");
        }
      }

      lastPosRef.current = { x: nextX, y: nextY };
      currentAbsolutePosRef.current = { x: nextX, y: nextY };
      dragInfo.current.moved = true;
      setPos({ x: nextX, y: nextY });
      targetPosRef.current = { x: nextX, y: nextY };

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

        if (
          (stateRef.current === "wandering" ||
            stateRef.current === "sleeping") &&
          nextState !== "wandering" &&
          nextState !== "sleeping"
        ) {
          targetPosRef.current = {
            x: window.innerWidth - CANVAS_W - 24,
            y: window.innerHeight - CANVAS_H - 24,
          };
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

    // Right-click → judging + open settings.
    if (e.button === 2) {
      triggerState("judging");
      openSettings();
      return;
    }

    // Left-click → headpat / excited (double).
    if (e.button === 0) {
      if (e.detail >= 2) {
        triggerState("excited");
      } else {
        triggerState("headpat");
      }

      // Begin dragging.
      dragInfo.current.active = true;
      dragInfo.current.moved = false;
      dragInfo.current.offX = e.clientX - pos.x;
      dragInfo.current.offY = e.clientY - pos.y;
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
                  x: pos.x + CANVAS_W / 2,
                  y: pos.y + CANVAS_H / 2,
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
          // - Wandering in Tauri: cat stays fixed inside the window at (0,0);
          //   only the OS window moves via moveWindow().
          // - Wandering in Browser: cat moves inside the page normally.
          // - Otherwise: lerp toward target / honor drag position.
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

            if (isTauri && s === "wandering") {
              // Move OS window; keep cat fixed inside its own window.
              moveWindow(nextX, nextYBase + jumpY);
              setPos({ x: 0, y: 0 });
            } else {
              setPos({ x: nextX, y: nextYBase + jumpY });
            }
          } else {
            // Dragging
            if (isTauri && s === "wandering") {
              moveWindow(
                targetPosRef.current.x,
                targetPosRef.current.y + jumpY,
              );
              setPos({ x: 0, y: 0 });
            } else {
              setPos({
                x: currentAbsolutePosRef.current.x,
                y: targetPosRef.current.y + jumpY,
              });
            }
          }
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
        transformOrigin: "center center",
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

      {/* Interactive-mode indicator (Tauri only). Hidden in browser
          where the window is always interactive. */}
      {mounted && isInteractive && "__TAURI_INTERNALS__" in window && (
        <div
          className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white shadow"
          style={{ pointerEvents: "none" }}
        >
          INTERACTIVE — Ctrl+Shift+P to lock
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
