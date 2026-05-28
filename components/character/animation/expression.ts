/**
 * Expression layer — maps mood + episode to VRM blendshape presets.
 *
 * V1 mapping is intentionally simple. Every state writes a *target* set of
 * blendshape values; the master ticker lerps current toward target. No
 * snaps, ever (per `.kiro/steering/frontend.md`).
 */

import { VRMExpressionPresetName } from "@pixiv/three-vrm";

import type { EpisodeName, MoodSnapshot } from "../types";

/** Subset of preset names V1 actually drives. */
type ExpressionKey =
    | typeof VRMExpressionPresetName.Happy
    | typeof VRMExpressionPresetName.Sad
    | typeof VRMExpressionPresetName.Angry
    | typeof VRMExpressionPresetName.Surprised
    | typeof VRMExpressionPresetName.Relaxed
    | typeof VRMExpressionPresetName.Neutral;

export type ExpressionTargets = Record<ExpressionKey, number>;

const ZERO: ExpressionTargets = {
    [VRMExpressionPresetName.Happy]: 0,
    [VRMExpressionPresetName.Sad]: 0,
    [VRMExpressionPresetName.Angry]: 0,
    [VRMExpressionPresetName.Surprised]: 0,
    [VRMExpressionPresetName.Relaxed]: 0,
    [VRMExpressionPresetName.Neutral]: 0,
};

/**
 * Compute an expression target from current mood + episode.
 * Episode bias is layered on top of mood baseline.
 */
export function targetExpression(
    mood: MoodSnapshot,
    episode: EpisodeName | null,
): ExpressionTargets {
    const target: ExpressionTargets = { ...ZERO };

    // --- Mood baseline ---
    // Happy track follows affection minus annoyance.
    const cheer = Math.max(0, mood.affection - mood.annoyance * 0.6);
    // Sad track rises when affection is low and energy is low.
    const sad = Math.max(0, (1 - mood.affection) * 0.5 - mood.energy * 0.3);
    // Anger from annoyance directly.
    const anger = mood.annoyance;
    // Relaxed when energy is low but mood isn't bad.
    const relaxed = Math.max(0, (1 - mood.energy) * 0.4 + mood.affection * 0.3 - mood.annoyance);

    target[VRMExpressionPresetName.Happy] = cheer * 0.6;
    target[VRMExpressionPresetName.Sad] = sad * 0.5;
    target[VRMExpressionPresetName.Angry] = anger * 0.4;
    target[VRMExpressionPresetName.Relaxed] = relaxed * 0.5;
    target[VRMExpressionPresetName.Neutral] = 1 - Math.min(1, cheer + sad + anger + relaxed);

    // --- Episode overrides ---
    switch (episode) {
        case "withdrawn":
            target[VRMExpressionPresetName.Sad] = Math.max(target[VRMExpressionPresetName.Sad], 0.3);
            target[VRMExpressionPresetName.Angry] = Math.max(target[VRMExpressionPresetName.Angry], 0.4);
            target[VRMExpressionPresetName.Happy] = 0;
            break;
        case "huffy":
            target[VRMExpressionPresetName.Angry] = Math.max(target[VRMExpressionPresetName.Angry], 0.7);
            target[VRMExpressionPresetName.Happy] = 0;
            break;
        case "pouty":
            target[VRMExpressionPresetName.Sad] = Math.max(target[VRMExpressionPresetName.Sad], 0.4);
            target[VRMExpressionPresetName.Angry] = Math.max(target[VRMExpressionPresetName.Angry], 0.2);
            break;
        case "gleeful":
            target[VRMExpressionPresetName.Happy] = Math.max(target[VRMExpressionPresetName.Happy], 0.85);
            target[VRMExpressionPresetName.Surprised] = 0.3;
            break;
        case "clingy":
            target[VRMExpressionPresetName.Sad] = Math.max(target[VRMExpressionPresetName.Sad], 0.2);
            target[VRMExpressionPresetName.Happy] = Math.max(target[VRMExpressionPresetName.Happy], 0.2);
            break;
        case "jealous":
            target[VRMExpressionPresetName.Angry] = Math.max(target[VRMExpressionPresetName.Angry], 0.5);
            target[VRMExpressionPresetName.Sad] = Math.max(target[VRMExpressionPresetName.Sad], 0.2);
            break;
        case null:
        default:
            break;
    }

    // Renormalise so total never exceeds ~1 — VRM blendshapes blend additively.
    const total =
        target[VRMExpressionPresetName.Happy] +
        target[VRMExpressionPresetName.Sad] +
        target[VRMExpressionPresetName.Angry] +
        target[VRMExpressionPresetName.Surprised] +
        target[VRMExpressionPresetName.Relaxed];
    if (total > 1) {
        const scale = 1 / total;
        target[VRMExpressionPresetName.Happy] *= scale;
        target[VRMExpressionPresetName.Sad] *= scale;
        target[VRMExpressionPresetName.Angry] *= scale;
        target[VRMExpressionPresetName.Surprised] *= scale;
        target[VRMExpressionPresetName.Relaxed] *= scale;
    }

    return target;
}

/** Lerp current toward target in-place. Returns nothing (mutates). */
export function lerpExpression(
    current: ExpressionTargets,
    target: ExpressionTargets,
    rate: number,
): void {
    for (const key of Object.keys(current) as ExpressionKey[]) {
        current[key] += (target[key] - current[key]) * rate;
    }
}

export function emptyExpressionState(): ExpressionTargets {
    return { ...ZERO, [VRMExpressionPresetName.Neutral]: 1 };
}

export const EXPRESSION_KEYS: ExpressionKey[] = [
    VRMExpressionPresetName.Happy,
    VRMExpressionPresetName.Sad,
    VRMExpressionPresetName.Angry,
    VRMExpressionPresetName.Surprised,
    VRMExpressionPresetName.Relaxed,
    VRMExpressionPresetName.Neutral,
];
