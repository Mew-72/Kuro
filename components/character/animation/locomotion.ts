/**
 * Locomotion layer — drives whole-body pose intent.
 *
 * V1 keeps locomotion abstract: we publish a `LocomotionTarget` (where the
 * character should "be"), and the master ticker translates that into VRM
 * model rotation, position offset, and a tiny breathing/idle bob. Walk
 * cycles and bone-level locomotion are scaffolded but not driven by IK in
 * V1 — the VRM model rotates and slides, which reads acceptably for a
 * desktop pet at this scale.
 *
 * V2 will swap the slide for a real animation clip via VRMA, or hand-built
 * walk cycle on the humanoid bones.
 */

import * as THREE from "three";

import type { EpisodeName } from "../types";

export type LocomotionMode = "stand" | "walk_off" | "approach" | "turn_away" | "sit";

export interface LocomotionState {
    mode: LocomotionMode;
    /** Anchor X offset in world-space units. -1.0 .. 1.0 of the canvas width. */
    currentOffsetX: number;
    targetOffsetX: number;
    /** Body Y rotation in radians. */
    currentYaw: number;
    targetYaw: number;
    /** Phase accumulator for breathing / walk cycle. */
    phase: number;
}

export function createLocomotionState(): LocomotionState {
    return {
        mode: "stand",
        currentOffsetX: 0,
        targetOffsetX: 0,
        currentYaw: 0,
        targetYaw: 0,
        phase: 0,
    };
}

/**
 * Update the locomotion target based on the current episode.
 * Caller lerps `currentX/currentYaw` toward `targetX/targetYaw` each frame
 * and reads `mode` + `phase` to derive bone-level motion.
 */
export function updateLocomotionTarget(
    state: LocomotionState,
    episode: EpisodeName | null,
): void {
    switch (episode) {
        case "withdrawn":
            state.mode = "walk_off";
            state.targetOffsetX = -1.6; // walk off-screen left
            state.targetYaw = -Math.PI / 6;
            break;
        case "pouty":
            state.mode = "turn_away";
            state.targetOffsetX = 0.4;
            state.targetYaw = Math.PI * 0.65; // back partially turned
            break;
        case "clingy":
            state.mode = "approach";
            state.targetOffsetX = 0;
            state.targetYaw = 0;
            break;
        case "huffy":
            state.mode = "stand";
            state.targetOffsetX = -0.2;
            state.targetYaw = -Math.PI / 12;
            break;
        case "jealous":
            state.mode = "stand";
            state.targetOffsetX = 0.1;
            state.targetYaw = Math.PI / 8;
            break;
        case "gleeful":
            state.mode = "stand";
            state.targetOffsetX = 0;
            state.targetYaw = 0;
            break;
        case null:
        default:
            state.mode = "stand";
            state.targetOffsetX = 0;
            state.targetYaw = 0;
            break;
    }
}

const LERP_POSITION = 0.04;
const LERP_YAW = 0.05;

export function lerpLocomotion(state: LocomotionState, deltaSeconds: number): void {
    state.currentOffsetX += (state.targetOffsetX - state.currentOffsetX) * LERP_POSITION;
    state.currentYaw += (state.targetYaw - state.currentYaw) * LERP_YAW;
    state.phase += deltaSeconds;
}

/** Apply locomotion state to the VRM scene root. */
export function applyLocomotion(scene: THREE.Object3D, state: LocomotionState): void {
    scene.position.x = state.currentOffsetX;
    scene.rotation.y = state.currentYaw;

    // Tiny vertical bob for breathing feel — never stops, regardless of state.
    const breathe = Math.sin(state.phase * 1.6) * 0.005;
    scene.position.y = breathe;
}
