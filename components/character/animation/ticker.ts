/**
 * The single master animation loop.
 *
 * Per `.kiro/steering/frontend.md`: there is exactly one ticker callback in
 * the character module. Every per-frame concern branches inside it.
 *
 * Layered, not switched:
 *   - Locomotion (target offset, yaw)
 *   - Gaze (look-at target)
 *   - Expression (blendshape weights)
 *   - VRM update (spring bones, look-at, expression apply)
 *   - Renderer draw
 */

import { VRMExpressionPresetName } from "@pixiv/three-vrm";

import type { RendererBundle } from "../renderer";
import type { VrmHandle } from "../vrm";
import type { EpisodeName, MoodSnapshot } from "../types";
import {
    emptyExpressionState,
    ExpressionTargets,
    lerpExpression,
    targetExpression,
    EXPRESSION_KEYS,
} from "./expression";
import {
    createGazeState,
    GazeState,
    lerpGaze,
    updateGazeTarget,
} from "./gaze";
import {
    applyLocomotion,
    createLocomotionState,
    LocomotionState,
    lerpLocomotion,
    updateLocomotionTarget,
} from "./locomotion";

/**
 * Mutable inputs the ticker reads each frame. The component owns the box
 * and updates fields in response to events; the ticker reads them. This
 * lets a single closure stay alive across React re-renders without
 * re-binding to fresh state.
 */
export interface TickerInputs {
    mood: MoodSnapshot;
    episode: EpisodeName | null;
    cursor: { x: number; y: number } | null;
    windowSize: { width: number; height: number };
    /** Set to true while the user is dragging the character window. */
    dragging: boolean;
}

export interface TickerHandle {
    start: () => void;
    stop: () => void;
}

export function startTicker(
    bundle: RendererBundle,
    vrm: VrmHandle,
    inputs: TickerInputs,
): TickerHandle {
    const locomotion: LocomotionState = createLocomotionState();
    const gaze: GazeState = createGazeState();
    const currentExpr: ExpressionTargets = emptyExpressionState();

    bundle.scene.add(vrm.vrm.scene);

    let raf = 0;
    let running = false;

    const loop = () => {
        if (!running) return;
        const dt = bundle.clock.getDelta();

        // --- Locomotion ---
        updateLocomotionTarget(locomotion, inputs.episode);
        lerpLocomotion(locomotion, dt);
        applyLocomotion(vrm.vrm.scene, locomotion);

        // --- Gaze ---
        updateGazeTarget(gaze, {
            cursor: inputs.cursor,
            windowSize: inputs.windowSize,
            episode: inputs.episode,
        });
        lerpGaze(gaze, 0.15);
        vrm.setLookAt(gaze.current);

        // --- Expression ---
        const exprTarget = targetExpression(inputs.mood, inputs.episode);
        lerpExpression(currentExpr, exprTarget, 0.12);
        for (const key of EXPRESSION_KEYS) {
            vrm.setExpression(key as VRMExpressionPresetName, currentExpr[key]);
        }

        // --- VRM internal update (spring bones, expression apply, look-at) ---
        vrm.update(dt);

        // --- Render ---
        bundle.renderer.render(bundle.scene, bundle.camera);

        raf = requestAnimationFrame(loop);
    };

    return {
        start: () => {
            if (running) return;
            running = true;
            bundle.clock.start();
            raf = requestAnimationFrame(loop);
        },
        stop: () => {
            running = false;
            cancelAnimationFrame(raf);
        },
    };
}
