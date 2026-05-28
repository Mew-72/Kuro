# Kuro Desktop Companion Instructions

## Architecture & Tech Stack
- **Frontend:** Next.js 15 App Router (TypeScript, Tailwind CSS).
- **Rendering:** PixiJS v7 + pixi-live2d-display@0.4.0.
- **Future Target:** Tauri v2 (transparent, frameless, always-on-top native window).

## CRITICAL: Live2D Animation Mandate
- The model ('LittleCat') **DOES NOT** have built-in .motion3.json or .exp3.json files that can be played via `model.motion()` or `model.expression()`.
- **ALL animations MUST be implemented manually** by driving parameters directly on every frame.
- **Method:** 
  ```typescript
  const coreModel = model.internalModel.coreModel;
  coreModel.setParameterValueById('ParamName', value);
  ```
- **Execution:** This must happen inside a single master `PIXI.Ticker` callback.
- **Transitions:** State changes must animate smoothly. You MUST use a `lerp` function to transition current parameter values toward target values on every frame; do not snap values instantly.

## State Machine
The component uses a `useReducer` or `useState` driven FSM mapping to specific parameter targets: `idle`, `typing_slow`, `typing_fast`, `sleeping`, `judging`, `headpat`, `excited`, `wandering`.

## File Standards
- `components/kuro/kuro-desktop.tsx` is the primary component. It must be dynamically imported with `ssr: false` in `page.tsx` and have `'use client'` at the top.
- Do not inject the Cubism core script inside the component; it is already handled in `app/layout.tsx`.
