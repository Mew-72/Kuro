"use client";

import { useEffect, useRef } from "react";
import KuroDesktop, {
  type KuroDesktopHandle,
  type KuroState,
} from "@/components/kuro/kuro-desktop";

const KEY_TO_STATE: Record<string, KuroState> = {
  "1": "idle",
  "2": "typing_slow",
  "3": "typing_fast",
  "4": "sleeping",
  "5": "judging",
};

export default function Page() {
  const ref = useRef<KuroDesktopHandle>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const next = KEY_TO_STATE[e.key];
      if (next) ref.current?.triggerState(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      (window as any).kuro = {
        trigger: (state: string) => ref.current?.triggerState(state as any),
        getState: () => ref.current?.getState(),
      };
      console.log('🐾 Kuro debug ready. Try: kuro.trigger("judging")');
    }
  }, []);

  return (
    <main className="min-h-dvh w-full">
      <KuroDesktop ref={ref} />
    </main>
  );
}
