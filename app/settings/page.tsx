"use client";

import React, { useState, useEffect } from "react";
import { KuroSettings } from "@/components/kuro/kuro-settings-menu";
import { KuroState } from "@/components/kuro/kuro-desktop";

export default function SettingsPage() {
  const [settings, setSettings] = useState<KuroSettings>({
    skin: "calico",
    scale: 1.0,
    opacity: 1.0,
    wandering: true,
    dialogue: true,
    dialogueInterval: 30,
    lateNightMode: true,
  });

  const [tauriApi, setTauriApi] = useState<{
    emit: (event: string, payload?: any) => Promise<void>;
    hideWindow: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    const loadTauri = async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");

        setTauriApi({
          emit,
          hideWindow: async () => {
            await getCurrentWindow().hide();
          },
        });
      } catch (e) {
        console.error("Failed to load Tauri API", e);
      }
    };
    loadTauri();
  }, []);

  const handleChange = (newSettings: Partial<KuroSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    if (tauriApi) {
      tauriApi.emit("kuro:settings-updated", updated);
    }
  };

  const handleTriggerState = (state: KuroState) => {
    if (tauriApi) {
      tauriApi.emit("kuro:trigger-state", { state });
    }
  };

  const handleClose = async () => {
    if (tauriApi) {
      await tauriApi.hideWindow();
    }
  };

  const states: KuroState[] = [
    "idle",
    "typing_slow",
    "typing_fast",
    "sleeping",
    "judging",
    "headpat",
    "excited",
    "wandering",
  ];

  const [selectedState, setSelectedState] = React.useState<KuroState>("idle");

  return (
    <main className="min-h-screen bg-zinc-900 text-zinc-200">
      {/* Character Section */}
      <div className="p-4 border-b border-zinc-700">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Scale</span>
              <span className="text-zinc-400">
                {settings.scale.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={settings.scale}
              onChange={(e) =>
                handleChange({ scale: parseFloat(e.target.value) })
              }
              className="w-full accent-zinc-500"
            />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Opacity</span>
              <span className="text-zinc-400">
                {Math.round(settings.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.3"
              max="1.0"
              step="0.1"
              value={settings.opacity}
              onChange={(e) =>
                handleChange({ opacity: parseFloat(e.target.value) })
              }
              className="w-full accent-zinc-500"
            />
          </div>
        </div>
      </div>

      {/* Behavior Section */}
      <div className="p-4 border-b border-zinc-700">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Behavior
        </h2>
        <div className="space-y-3">
          <label className="flex items-center justify-between text-sm cursor-pointer">
            <span>Wandering</span>
            <input
              type="checkbox"
              checked={settings.wandering}
              onChange={(e) =>
                handleChange({ wandering: e.target.checked })
              }
              className="accent-zinc-500 w-4 h-4"
            />
          </label>
          <label className="flex items-center justify-between text-sm cursor-pointer">
            <span>Dialogue Overlay</span>
            <input
              type="checkbox"
              checked={settings.dialogue}
              onChange={(e) =>
                handleChange({ dialogue: e.target.checked })
              }
              className="accent-zinc-500 w-4 h-4"
            />
          </label>
          <div className="flex justify-between items-center text-sm">
            <span className={!settings.dialogue ? "text-zinc-600" : ""}>
              Interval
            </span>
            <select
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm outline-none focus:border-zinc-500 disabled:opacity-50"
              value={settings.dialogueInterval}
              disabled={!settings.dialogue}
              onChange={(e) =>
                handleChange({
                  dialogueInterval: parseInt(e.target.value, 10),
                })
              }
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>1m</option>
              <option value={300}>5m</option>
            </select>
          </div>
          <label className="flex items-center justify-between text-sm cursor-pointer">
            <span>Late Night Mode</span>
            <input
              type="checkbox"
              checked={settings.lateNightMode}
              onChange={(e) =>
                handleChange({ lateNightMode: e.target.checked })
              }
              className="accent-zinc-500 w-4 h-4"
            />
          </label>
        </div>
      </div>

      {/* Debug Section */}
      <div className="p-4 border-b border-zinc-700">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Debug
        </h2>
        <div className="flex gap-2">
          <select
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm outline-none focus:border-zinc-500 flex-1"
            value={selectedState}
            onChange={(e) =>
              setSelectedState(e.target.value as KuroState)
            }
          >
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            className="bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 px-3 py-1 rounded text-sm transition-colors"
            onClick={() => handleTriggerState(selectedState)}
          >
            Play
          </button>
        </div>
      </div>

      {/* Close */}
      <div className="p-2">
        <button
          className="w-full py-2 text-sm text-zinc-400 hover:text-white transition-colors"
          onClick={handleClose}
        >
          Close
        </button>
      </div>
    </main>
  );
}
