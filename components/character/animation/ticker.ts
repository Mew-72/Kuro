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
 *
 * VRM swap: the active model can be replaced via `swapVrm()` without
 * tearing the ticker or renderer down. Used for hot-reload after the
 * user installs a new VRM through the settings panel.
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
    /**
     * Replace the active VRM. The previous one is removed from the scene
     * and disposed. Animation state (locomotion phase, gaze, expression
     * weights) carries over so the new model picks up smoothly.
     */
    swapVrm: (next: VrmHandle) => void;
}

export function startTicker(
    bundle: RendererBundle,
    initialVrm: VrmHandle,
    inputs: TickerInputs,
): TickerHandle {
    const locomotion: LocomotionState = createLocomotionState();
    const gaze: GazeState = createGazeState();
    const currentExpr: ExpressionTargets = emptyExpressionState();

    let activeVrm: VrmHandle = initialVrm;
    bundle.scene.add(activeVrm.vrm.scene);

    let raf = 0;
    let running = false;

    const loop = () => {
        if (!running) return;
        const dt = bundle.clock.getDelta();

        // --- Locomotion ---
        updateLocomotionTarget(locomotion, inputs.episode);
        lerpLocomotion(locomotion, dt);
        applyLocomotion(activeVrm.vrm.scene, locomotion);

        // --- Gaze ---
        updateGazeTarget(gaze, {
            cursor: inputs.cursor,
            windowSize: inputs.windowSize,
            episode: inputs.episode,
        });
        lerpGaze(gaze, 0.15);
        activeVrm.setLookAt(gaze.current);

        // --- Expression ---
        const exprTarget = targetExpression(inputs.mood, inputs.episode);
        lerpExpression(currentExpr, exprTarget, 0.12);
        for (const key of EXPRESSION_KEYS) {
            activeVrm.setExpression(
                key as VRMExpressionPresetName,
                currentExpr[key],
            );
        }

        // --- VRM internal update (spring bones, expression apply, look-at) ---
        activeVrm.update(dt);

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
        swapVrm: (next: VrmHandle) => {
            // Pull the old model out of the scene and dispose it, then
            // attach the new one. Animation state (locomotion phase, gaze,
            // expression weights) is preserved on purpose so the new model
            // doesn't appear with a snap.
            try {
                bundle.scene.remove(activeVrm.vrm.scene);
                activeVrm.dispose();
            } catch (e) {
                console.debug("[ticker] dispose old VRM failed:", e);
            }
            activeVrm = next;
            bundle.scene.add(activeVrm.vrm.scene);
        },
    };
}
