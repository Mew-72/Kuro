# Character assets

V1 expects a VRM file at:

```
public/character/model.vrm
```

This file is **not committed to git** (see `.gitignore`). VRM models are
binary, large, and the choice of model is deferred to the V1 design spec
per `.kiro/steering/character.md`.

## Where to get one (for development)

- VRoid Studio (`https://vroid.com/en/studio`) — free, you can build your own
  and export `.vrm`.
- VRoid Hub — community-uploaded models, check licence per model.

Drop the `.vrm` file into this directory as `model.vrm`. The runtime
loader (`components/character/vrm.ts`) handles VRM 0.x and 1.0; either
works.

## Future structure

When V2 introduces animation clips:

```
public/character/
├── model.vrm
├── animations/
│   ├── idle.vrma
│   ├── walk.vrma
│   └── ...
```
