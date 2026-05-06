import React from "react";
import { KuroState } from "./kuro-desktop";

export interface KuroSettings {
  skin: "white" | "black" | "calico";
  scale: number;
  opacity: number;
  wandering: boolean;
  dialogue: boolean;
  dialogueInterval: number; // in seconds
  lateNightMode: boolean;
}

interface KuroSettingsMenuProps {
  settings: KuroSettings;
  onChange: (settings: Partial<KuroSettings>) => void;
  onTriggerState: (state: KuroState) => void;
  onClose: () => void;
}

export function KuroSettingsMenu({
  settings,
  onChange,
  onTriggerState,
  onClose,
}: KuroSettingsMenuProps) {
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
    <div className="fixed right-6 bottom-32 z-[100] w-[320px] rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl text-zinc-200 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="p-4 border-b border-zinc-700">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Character
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span>Skin</span>
              <select
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm outline-none focus:border-zinc-500"
                value={settings.skin}
                onChange={(e) =>
                  onChange({ skin: e.target.value as KuroSettings["skin"] })
                }
              >
                <option value="calico">Calico</option>
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </div>
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
                  onChange({ scale: parseFloat(e.target.value) })
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
                  onChange({ opacity: parseFloat(e.target.value) })
                }
                className="w-full accent-zinc-500"
              />
            </div>
          </div>
        </div>

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
                onChange={(e) => onChange({ wandering: e.target.checked })}
                className="accent-zinc-500 w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between text-sm cursor-pointer">
              <span>Dialogue Overlay</span>
              <input
                type="checkbox"
                checked={settings.dialogue}
                onChange={(e) => onChange({ dialogue: e.target.checked })}
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
                  onChange({
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
                onChange={(e) => onChange({ lateNightMode: e.target.checked })}
                className="accent-zinc-500 w-4 h-4"
              />
            </label>
          </div>
        </div>

        <div className="p-4 border-b border-zinc-700">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Debug
          </h2>
          <div className="flex gap-2">
            <select
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm outline-none focus:border-zinc-500 flex-1"
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value as KuroState)}
            >
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              className="bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 px-3 py-1 rounded text-sm transition-colors"
              onClick={() => onTriggerState(selectedState)}
            >
              Play
            </button>
          </div>
        </div>

        <div className="p-2">
          <button
            className="w-full py-2 text-sm text-zinc-400 hover:text-white transition-colors"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    );
}
