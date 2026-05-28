"use client";

import React, { useEffect, useState } from "react";

import {
  DEFAULT_SETTINGS,
  type KuroSettings,
} from "@/components/character/settings";
import type { EpisodeName } from "@/components/character/types";

const EPISODES: EpisodeName[] = [
  "withdrawn",
  "clingy",
  "pouty",
  "gleeful",
  "huffy",
  "jealous",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<KuroSettings>(DEFAULT_SETTINGS);
  const [tauriApi, setTauriApi] = useState<{
    emit: (event: string, payload?: unknown) => Promise<void>;
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    hideWindow: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        setTauriApi({
          emit,
          invoke: <T,>(cmd: string, args?: Record<string, unknown>) =>
            invoke<T>(cmd, args),
          hideWindow: async () => {
            await getCurrentWindow().hide();
          },
        });
      } catch (e) {
        console.debug("[settings] tauri unavailable:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = (patch: Partial<KuroSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (tauriApi) {
      void tauriApi.emit("kuro:settings-updated", next);
      // DND toggle is mirrored to the backend.
      if ("dnd" in patch && patch.dnd !== settings.dnd) {
        void tauriApi.invoke("set_dnd", { enabled: patch.dnd });
      }
    }
  };

  const triggerEpisode = (name: EpisodeName) => {
    if (!tauriApi) return;
    void tauriApi.invoke("force_episode", { name });
  };

  const close = async () => {
    if (tauriApi) await tauriApi.hideWindow();
  };

  const [selectedEpisode, setSelectedEpisode] = React.useState<EpisodeName>("clingy");

  return (
    <main className="min-h-screen bg-zinc-900 text-zinc-200">
      {/* Presence */}
      <Section title="Presence">
        <Slider
          label="Scale"
          min={0.5}
          max={2.0}
          step={0.1}
          value={settings.scale}
          format={(v) => `${v.toFixed(1)}x`}
          onChange={(v) => updateSettings({ scale: v })}
        />
        <Slider
          label="Opacity"
          min={0.3}
          max={1.0}
          step={0.05}
          value={settings.opacity}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ opacity: v })}
        />
      </Section>

      {/* Behavior */}
      <Section title="Behavior">
        <Toggle
          label="Movement"
          checked={settings.movement}
          onChange={(v) => updateSettings({ movement: v })}
        />
        <Toggle
          label="Dialogue overlay"
          checked={settings.dialogue}
          onChange={(v) => updateSettings({ dialogue: v })}
        />
        <Select
          label="Dialogue interval"
          disabled={!settings.dialogue}
          value={String(settings.dialogueIntervalSec)}
          onChange={(v) =>
            updateSettings({
              dialogueIntervalSec: Number(v) as KuroSettings["dialogueIntervalSec"],
            })
          }
          options={[
            { value: "15", label: "15s" },
            { value: "30", label: "30s" },
            { value: "60", label: "1m" },
            { value: "300", label: "5m" },
          ]}
        />
        <Toggle
          label="Late night mode"
          checked={settings.lateNightMode}
          onChange={(v) => updateSettings({ lateNightMode: v })}
        />
        <Toggle
          label="Do not disturb"
          checked={settings.dnd}
          onChange={(v) => updateSettings({ dnd: v })}
        />
      </Section>

      {/* Debug */}
      <Section title="Debug">
        <div className="flex gap-2">
          <select
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm outline-none focus:border-zinc-500 flex-1"
            value={selectedEpisode}
            onChange={(e) => setSelectedEpisode(e.target.value as EpisodeName)}
          >
            {EPISODES.map((ep) => (
              <option key={ep} value={ep}>
                {ep}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 px-3 py-1 rounded text-sm transition-colors"
            onClick={() => triggerEpisode(selectedEpisode)}
          >
            Force episode
          </button>
        </div>
      </Section>

      <div className="p-2">
        <button
          type="button"
          className="w-full py-2 text-sm text-zinc-400 hover:text-white transition-colors"
          onClick={close}
        >
          Close
        </button>
      </div>
    </main>
  );
}

// --- Tiny presentational helpers ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 border-b border-zinc-700">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{props.label}</span>
        <span className="text-zinc-400">{props.format(props.value)}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        className="w-full accent-zinc-500"
      />
    </div>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-sm cursor-pointer">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="accent-zinc-500 w-4 h-4"
      />
    </label>
  );
}

function Select(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className={props.disabled ? "text-zinc-600" : ""}>{props.label}</span>
      <select
        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm outline-none focus:border-zinc-500 disabled:opacity-50"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
