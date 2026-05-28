/**
 * three.js renderer setup for the character window.
 *
 * Constraints (see `.kiro/steering/frontend.md`):
 * - Transparent canvas
 * - DPR capped at 2
 * - No shadows in V1
 * - Tight perspective FOV — character occupies most of the canvas height
 */

import * as THREE from "three";

export const CANVAS_W = 350;
export const CANVAS_H = 600;

export interface RendererBundle {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    clock: THREE.Clock;
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
    // Output color/tone settings tuned for VRM toon shading
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    const scene = new THREE.Scene();

    // Soft front fill + a directional key. Matches typical VRM display setups.
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(0.5, 1, 1);
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(
        24, // tight FOV so the character doesn't distort at the edges
        CANVAS_W / CANVAS_H,
        0.1,
        50,
    );
    camera.position.set(0, 1.35, 2.6);
    camera.lookAt(0, 1.25, 0);

    const clock = new THREE.Clock();

    const resize = (width: number, height: number) => {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };

    const dispose = () => {
        renderer.dispose();
        scene.traverse((obj) => {
            if ("geometry" in obj && (obj as { geometry?: { dispose?: () => void } }).geometry?.dispose) {
                (obj as { geometry: { dispose: () => void } }).geometry.dispose();
            }
            const maybeMaterial = (obj as { material?: unknown }).material;
            if (Array.isArray(maybeMaterial)) {
                for (const m of maybeMaterial) {
                    if (m && typeof (m as { dispose?: () => void }).dispose === "function") {
                        (m as { dispose: () => void }).dispose();
                    }
                }
            } else if (
                maybeMaterial &&
                typeof (maybeMaterial as { dispose?: () => void }).dispose === "function"
            ) {
                (maybeMaterial as { dispose: () => void }).dispose();
            }
        });
    };

    return { renderer, scene, camera, clock, resize, dispose };
}
