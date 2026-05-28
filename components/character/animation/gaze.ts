/**
 * Gaze layer — drives the VRM look-at target.
 *
 * Inputs:
 *   - cursor position in screen space (from window pointer events)
 *   - episode override ("look pointedly away" for pouty/withdrawn)
 *
 * Output:
 *   - a world-space Vector3 the VRM should look at, lerped toward target
 *     by the master ticker.
 */

import * as THREE from "three";

import type { EpisodeName } from "../types";

export interface GazeState {
    /** Current world-space target the VRM head/eyes are tracking. */
    current: THREE.Vector3;
    /** Where we want it to be this frame. */
    target: THREE.Vector3;
}

export function createGazeState(): GazeState {
    return {
        current: new THREE.Vector3(0, 1.35, 1.5),
        target: new THREE.Vector3(0, 1.35, 1.5),
    };
}

export interface GazeInputs {
    /** Cursor position in window-local pixels, or null if outside. */
    cursor: { x: number; y: number } | null;
    windowSize: { width: number; height: number };
    episode: EpisodeName | null;
}

/**
 * Update the gaze target. Caller lerps `current` toward `target` each frame.
 *
 * Cursor is mapped from screen space into a small forward-facing arc near
 * the character's head so the look stays subtle and natural.
 */
export function updateGazeTarget(state: GazeState, inputs: GazeInputs): void {
    // Episode overrides — pointedly away, no cursor tracking.
    if (inputs.episode === "withdrawn" || inputs.episode === "pouty") {
        state.target.set(-1.5, 1.0, 1.0);
        return;
    }

    if (!inputs.cursor) {
        // Resting gaze — slightly forward, slightly down.
        state.target.set(0, 1.3, 1.5);
        return;
    }

    // Map cursor into a normalised [-1, 1] range and project to a small
    // arc in front of the character.
    const nx = (inputs.cursor.x / inputs.windowSize.width) * 2 - 1;
    const ny = (inputs.cursor.y / inputs.windowSize.height) * 2 - 1;

    const x = nx * 0.8;
    const y = 1.35 - ny * 0.5;
    const z = 1.5;
    state.target.set(x, y, z);
}

export function lerpGaze(state: GazeState, rate: number): void {
    state.current.lerp(state.target, rate);
}
