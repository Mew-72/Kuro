"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

import type { KuroCharacterHandle } from "@/components/character/character";
import type { EpisodeName } from "@/components/character/types";

// Per .kiro/steering/frontend.md: character must be dynamically imported
// with ssr: false. three.js + WebGL touch `window` and break SSR otherwise.
const KuroCharacter = dynamic(
  () => import("@/components/character/character"),
  { ssr: false },
);

const KEY_TO_EPISODE: Record<string, EpisodeName> = {
  "1": "withdrawn",
  "2": "clingy",
  "3": "pouty",
  "4": "gleeful",
  "5": "huffy",
  "6": "jealous",
};

export default function Page() {
  const ref = useRef<KuroCharacterHandle>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ep = KEY_TO_EPISODE[e.key];
      if (ep) {
        e.preventDefault();
        ref.current?.forceEpisode(ep);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      (window as unknown as { kuro: unknown }).kuro = {
        episode: (name: EpisodeName) => ref.current?.forceEpisode(name),
        dnd: (enabled: boolean) => ref.current?.setDnd(enabled),
      };
      console.log('🐾 Kuro debug ready. Try: kuro.episode("withdrawn")');
    }
  }, []);

  return (
    <main className="min-h-dvh w-full">
      <KuroCharacter ref={ref} />
    </main>
  );
}
