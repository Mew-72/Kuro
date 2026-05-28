/**
 * VRM loading and rig handle helpers.
 *
 * Architecture
 * ------------
 * The loaded VRM scene is wrapped in a plain `THREE.Object3D` we call
 * `root`. The wrapper is what gets added to the renderer scene. The VRM
 * scene itself sits inside the wrapper.
 *
 * Why: VRM 0.x models export facing +Z and need a 180° Y-rotation to
 * face the camera. If we apply that rotation directly to the VRM scene,
 * any further yaw we want to add (e.g. "turn 30° left while pouty") has
 * to be carefully composed on top. By keeping the corrective rotation
 * *inside* the wrapper and animating yaw / position on the wrapper, the
 * two concerns stay independent. VRM 1.0 models already face -Z, so the
 * corrective rotation is a no-op for them — `VRMUtils.rotateVRM0`
 * self-checks the metaVersion and only acts on VRM 0.
 *
 * The look-at target is owned by the renderer (in world space) so head
 * tracking maths is independent of character rotation.
 *
 * The runtime accepts both VRM 0.x and VRM 1.0 — `@pixiv/three-vrm` 3.x
 * handles either through the same loader.
 *
 * Rig requirements are enforced by the design spec, not at runtime. If a
 * required blendshape is missing here, expression setters become no-ops
 * rather than throwing.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
    VRM,
    VRMLoaderPlugin,
    VRMUtils,
    VRMExpressionPresetName,
} from "@pixiv/three-vrm";

import { isTauri } from "./types";

/** Bundled fallback location, used if no installed model exists. */
export const VRM_BUNDLED_PATH = "/character/model.vrm";

/**
 * Resolve the URL the renderer should fetch for the VRM file.
 *
 * In Tauri: prefer an installed file under the app data dir, served via
 * the asset protocol. In browser preview: always use the bundled path.
 */
export async function resolveVrmUrl(): Promise<string> {
    if (!isTauri()) return VRM_BUNDLED_PATH;
    try {
        const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
        const installed = await invoke<{ path: string } | null>(
            "get_installed_vrm",
        );
        if (installed?.path) {
            return convertFileSrc(installed.path);
        }
    } catch (e) {
        console.debug("[vrm] resolve installed path failed:", e);
    }
    return VRM_BUNDLED_PATH;
}

export interface VrmHandle {
    vrm: VRM;
    /**
     * Wrapper Object3D added to the renderer scene. Locomotion (yaw,
     * position offset) is applied here, not on `vrm.scene`.
     */
    root: THREE.Object3D;
    /** Per-frame update — must be called from the master ticker. */
    update: (deltaSeconds: number) => void;
    dispose: () => void;
    /** Set an expression (blendshape preset) by name in [0,1]. No-ops if missing. */
    setExpression: (name: VRMExpressionPresetName, value: number) => void;
    /** Read the current set value for an expression, or 0 if missing. */
    getExpression: (name: VRMExpressionPresetName) => number;
}

/**
 * Load a VRM file from a URL and return a handle wrapping it.
 *
 * `onProgress` is forwarded for loading-overlay UX. Throws on network /
 * parse failures — callers must handle to show the friendly error overlay.
 *
 * The caller must provide the world-space `lookAtTarget` (owned by the
 * renderer); the loader binds it to the VRM's lookAt component so head
 * tracking works without further wiring.
 */
export async function loadVrm(
    url: string,
    lookAtTarget: THREE.Object3D,
    onProgress?: (loaded: number, total: number) => void,
): Promise<VrmHandle> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url, (event) => {
        if (onProgress && event.total > 0) {
            onProgress(event.loaded, event.total);
        }
    });
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
        throw new Error(
            "loaded GLTF does not contain a VRM payload — check the file is a valid .vrm",
        );
    }

    // Performance: drop unused vertex attributes, combine skeletons where possible.
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);

    // VRM 0.x models face +Z; this rotates them to face -Z (the camera).
    // The helper self-checks `meta.metaVersion === "0"`, so it's a no-op
    // for VRM 1.0 models — safe to call unconditionally.
    VRMUtils.rotateVRM0(vrm);

    // Bind the world-space gaze target so head tracking works without
    // having to push values through three-vrm each frame.
    if (vrm.lookAt) {
        vrm.lookAt.target = lookAtTarget;
    }

    // Tame frustum culling for skinned meshes — VRM bounding boxes are
    // often too tight and clip the model when it animates outside its
    // rest pose.
    vrm.scene.traverse((obj) => {
        obj.frustumCulled = false;
    });

    // Wrapper pivot — locomotion goes on this, not on the VRM scene.
    const root = new THREE.Object3D();
    root.name = "kuro-character-root";
    root.add(vrm.scene);

    const update = (deltaSeconds: number) => {
        vrm.update(deltaSeconds);
    };

    const dispose = () => {
        VRMUtils.deepDispose(vrm.scene);
    };

    const setExpression = (
        name: VRMExpressionPresetName,
        value: number,
    ) => {
        if (!vrm.expressionManager) return;
        const expr = vrm.expressionManager.getExpression(name);
        if (!expr) return;
        vrm.expressionManager.setValue(name, Math.max(0, Math.min(1, value)));
    };

    const getExpression = (name: VRMExpressionPresetName): number => {
        if (!vrm.expressionManager) return 0;
        return vrm.expressionManager.getValue(name) ?? 0;
    };

    return { vrm, root, update, dispose, setExpression, getExpression };
}
