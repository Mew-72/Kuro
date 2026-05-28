/**
 * Gaze layer — drives the world-space look-at target the VRM head and
 * eyes track.
 *
 * The look-at target lives in the renderer scene (top-level), not under
 * the character wrapper. That way gaze maths is in world coordinates and
 * doesn't need to compensate for character rotation.
 *
 * Inputs:
 *   - cursor position in screen space (from window pointer events)
 *   - episode override ("look pointedly away" for pouty/withdrawn)
 *
 * Output:
 *   - the renderer's `lookAtTarget` `Object3D` is mutated in-place each
 *     frame; the master ticker calls `lerpGaze` to interpolate.
 */

import * as THREE from "three";

import type { EpisodeName } from "../types";

export interface GazeState {
    /** Current world-space target the VRM head/eyes are tracking. */
    current: THREE.Vector3;
    /** Where we want it to be this frame. */
    target: THREE.Vector3;
}

/** Resting gaze position — slightly forward, near the character's head. */
const RESTING = new THREE.Vector3(0, 1.0, 1.5);
/** "Pointedly away" gaze position used for withdrawn/pouty. */
const AWAY = new THREE.Vector3(-1.5, 0.6, 1.0);

export function createGazeState(): GazeState {
    return {
        current: RESTING.clone(),
        target: RESTING.clone(),
    };
}

export interface GazeInputs {
    /** Cursor position in window-local pixels, or null if outside. */
    cursor: { x: number; y: number } | null;
    windowSize: { width: number; height: number };
    episode: EpisodeName | null;
}

/**
 * Update the gaze target. Caller lerps `current` toward `target`
 * each frame and writes `current` into the renderer's lookAtTarget.
 */
export function updateGazeTarget(state: GazeState, inputs: GazeInputs): void {
    if (inputs.episode === "withdrawn" || inputs.episode === "pouty") {
        state.target.copy(AWAY);
        return;
    }

    if (!inputs.cursor) {
        state.target.copy(RESTING);
        return;
    }

    // Map cursor into a normalised [-1, 1] range and project to a small
    // arc in front of the character's face.
    const nx = (inputs.cursor.x / inputs.windowSize.width) * 2 - 1;
    const ny = (inputs.cursor.y / inputs.windowSize.height) * 2 - 1;

    const x = nx * 0.6;
    const y = 1.0 - ny * 0.4;
    const z = 1.5;
    state.target.set(x, y, z);
}

export function lerpGaze(state: GazeState, rate: number): void {
    state.current.lerp(state.target, rate);
}
