"use client";

import React, { useState, useEffect } from "react";
import { KuroSettingsMenu, KuroSettings } from "@/components/kuro/kuro-settings-menu";
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
    getCurrentWebviewWindow: () => any;
  } | null>(null);

  useEffect(() => {
    const loadTauri = async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webview");
        setTauriApi({ emit, getCurrentWebviewWindow });
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
      const win = tauriApi.getCurrentWebviewWindow();
      await win.hide();
    }
  };

  return (
    <main className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <KuroSettingsMenu
        settings={settings}
        onChange={handleChange}
        onTriggerState={handleTriggerState}
        onClose={handleClose}
      />
    </main>
  );
}
