/**
 * three.js renderer setup for the character window.
 *
 * Constraints (see `.kiro/steering/frontend.md`):
 * - Transparent canvas
 * - DPR capped at 2
 * - No shadows in V1
 * - Tight perspective FOV — character occupies most of the canvas height
 *
 * Canvas size matches the Tauri window so nothing is clipped.
 */

import * as THREE from "three";

export const CANVAS_W = 350;
export const CANVAS_H = 600;

export interface RendererBundle {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    clock: THREE.Clock;
    /**
     * World-space look-at target the VRM head/eyes track. Lives at the
     * top level of the scene so wrapper pivots on the character don't
     * rotate it. Gaze code writes its position each frame.
     */
    lookAtTarget: THREE.Object3D;
    resize: (width: number, height: number) => void;
    dispose: () => void;
}

export function createRenderer(canvas: HTMLCanvasElement): RendererBundle {
    const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(CANVAS_W, CANVAS_H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    const scene = new THREE.Scene();

    // Soft front fill + a directional key. Matches typical VRM display setups.
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(0.5, 1, 1);
    scene.add(dir);

    // Camera framing: medium shot of a typical anime VRM (~1.5 m tall).
    // For shorter / taller characters the user can tune via the scale
    // setting, which scales the wrapper div around the canvas.
    const camera = new THREE.PerspectiveCamera(
        30,
        CANVAS_W / CANVAS_H,
        0.1,
        50,
    );
    camera.position.set(0, 0.9, 2.5);
    camera.lookAt(0, 0.85, 0);

    // World-space gaze target. Three-vrm reads its world position each
    // frame; keeping it outside the character's wrapper pivots means
    // gaze maths in world coordinates without compensating for character
    // rotation.
    const lookAtTarget = new THREE.Object3D();
    lookAtTarget.position.set(0, 1.0, 1.5);
    scene.add(lookAtTarget);

    const clock = new THREE.Clock();

    const resize = (width: number, height: number) => {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };

    const dispose = () => {
        renderer.dispose();
        scene.traverse((obj) => {
            if (
                "geometry" in obj &&
                (obj as { geometry?: { dispose?: () => void } }).geometry
                    ?.dispose
            ) {
                (
                    obj as { geometry: { dispose: () => void } }
                ).geometry.dispose();
            }
            const maybeMaterial = (obj as { material?: unknown }).material;
            if (Array.isArray(maybeMaterial)) {
                for (const m of maybeMaterial) {
                    if (
                        m &&
                        typeof (m as { dispose?: () => void }).dispose ===
                        "function"
                    ) {
                        (m as { dispose: () => void }).dispose();
                    }
                }
            } else if (
                maybeMaterial &&
                typeof (maybeMaterial as { dispose?: () => void }).dispose ===
                "function"
            ) {
                (maybeMaterial as { dispose: () => void }).dispose();
            }
        });
    };

    return { renderer, scene, camera, clock, lookAtTarget, resize, dispose };
}
