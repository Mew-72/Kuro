/**
 * Settings type for V1 (replaces the cat-era KuroSettings shape).
 *
 * Settings live in the second Tauri window (`/settings`) and are mirrored
 * into the main character window via the `kuro:settings-updated` event.
 */

export interface KuroSettings {
    scale: number;        // 0.5 .. 2.0
    opacity: number;      // 0.3 .. 1.0
    movement: boolean;    // wandering / locomotion enabled
    dialogue: boolean;    // speech bubble overlay enabled
    dialogueIntervalSec: 15 | 30 | 60 | 300;
    lateNightMode: boolean;
    /**
     * Manual DND flag. Mirrors the backend's `withdrawn` episode state —
     * toggle changes invoke `set_dnd` on the Rust side.
     */
    dnd: boolean;
}

export const DEFAULT_SETTINGS: KuroSettings = {
    scale: 1.0,
    opacity: 1.0,
    movement: true,
    dialogue: true,
    dialogueIntervalSec: 30,
    lateNightMode: true,
    dnd: false,
};
