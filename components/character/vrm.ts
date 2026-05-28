/**
 * VRM loading and rig handle helpers.
 *
 * The model URL is resolved at runtime (see `resolveVrmUrl()`):
 *   1. If a user-installed VRM exists in the app data directory, that wins.
 *   2. Otherwise, fall back to a bundled `/character/model.vrm`.
 *   3. If neither exists, the loader fails and the friendly error overlay
 *      shows.
 *
 * The runtime accepts both VRM 0.x and VRM 1.0 — `@pixiv/three-vrm` 3.x
 * handles either through the same loader.
 *
 * Rig requirements are enforced by the design spec, not at runtime. If a
 * required blendshape is missing here, we degrade gracefully: expression
 * setters become no-ops rather than throwing.
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
    /** Per-frame update — must be called from the master ticker. */
    update: (deltaSeconds: number) => void;
    dispose: () => void;
    /** Set an expression (blendshape preset) by name in [0,1]. No-ops if missing. */
    setExpression: (name: VRMExpressionPresetName, value: number) => void;
    /** Read the current set value for an expression, or 0 if missing. */
    getExpression: (name: VRMExpressionPresetName) => number;
    /** Set the look-at target in world space. */
    setLookAt: (target: THREE.Vector3) => void;
}

/**
 * Load a VRM file from a URL and return a handle wrapping it.
 *
 * `onProgress` is forwarded for loading-overlay UX. Throws on network /
 * parse failures — callers must handle to show the friendly error overlay.
 */
export async function loadVrm(
    url: string,
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

    // VRM 0.x models face +Z by default; rotate to face the camera (-Z).
    // VRM 1.0 already faces -Z. Detect and fix.
    const isVrm0 = vrm.meta && (vrm.meta as { metaVersion?: string }).metaVersion === "0";
    if (isVrm0) {
        VRMUtils.rotateVRM0(vrm);
    }

    // Look-at target — a small invisible Object3D in front of the model.
    const lookAtTarget = new THREE.Object3D();
    lookAtTarget.position.set(0, 1.35, 1.5);
    vrm.scene.add(lookAtTarget);
    if (vrm.lookAt) {
        vrm.lookAt.target = lookAtTarget;
    }

    // Tame frustum culling for skinned meshes — VRM bounding boxes are often
    // too tight and clip the model when it animates outside its rest pose.
    vrm.scene.traverse((obj) => {
        obj.frustumCulled = false;
    });

    const update = (deltaSeconds: number) => {
        vrm.update(deltaSeconds);
    };

    const dispose = () => {
        VRMUtils.deepDispose(vrm.scene);
    };

    const setExpression = (name: VRMExpressionPresetName, value: number) => {
        if (!vrm.expressionManager) return;
        const expr = vrm.expressionManager.getExpression(name);
        if (!expr) return;
        vrm.expressionManager.setValue(name, Math.max(0, Math.min(1, value)));
    };

    const getExpression = (name: VRMExpressionPresetName): number => {
        if (!vrm.expressionManager) return 0;
        return vrm.expressionManager.getValue(name) ?? 0;
    };

    const setLookAt = (target: THREE.Vector3) => {
        lookAtTarget.position.copy(target);
    };

    return { vrm, update, dispose, setExpression, getExpression, setLookAt };
}
